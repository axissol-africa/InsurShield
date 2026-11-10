import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { jobs, notificationTemplates, notifications } from '../src/db/schema.js';
import { JobRunner } from '../src/jobs/job-runner.service.js';
import { MAIL_SENDER, type MailResult } from '../src/mail/mail.port.js';
import { NOTIFICATION_EMAIL, NotificationsService } from '../src/notifications/notifications.service.js';
import { NotificationsRepository } from '../src/notifications/notifications.repository.js';
import { buildCustomer } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';

describe('notifications', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let service: NotificationsService;
  let repository: NotificationsRepository;
  let runner: JobRunner;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    service = testApp.app.get(NotificationsService);
    repository = testApp.app.get(NotificationsRepository);
    runner = testApp.app.get(JobRunner);
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  /** A key of its own per test, so published versions cannot collide. */
  const keyFor = (name: string) => `test.${name}.${randomUUID().slice(0, 8)}`;

  async function publish(
    key: string,
    channel: 'IN_APP' | 'EMAIL',
    version: number,
    { subject = 'Quote ready', body = 'Your quote from {{insurer}} is ready', activeFrom = new Date('2020-01-01') } = {},
  ) {
    await side.db.insert(notificationTemplates).values({ key, channel, version, subject, body, activeFrom });
  }

  const rows = (key: string) =>
    side.db.select().from(notifications).where(eq(notifications.templateKey, key));

  const notify = (customerId: string, key: string, values?: Record<string, string>) =>
    repository.transaction((tx) =>
      service.notify(tx, { customerId, key, entity: { type: 'QUOTE_REQUEST', id: 'QR-1' }, values }),
    );

  it('writes the message and its job with the change it announces, or neither', async () => {
    const customer = await buildCustomer(testApp.db);
    const key = keyFor('atomic');
    await publish(key, 'EMAIL', 1);
    const boom = new Error('the business write failed');

    await expect(
      repository.transaction(async (tx) => {
        await service.notify(tx, { customerId: customer.id, key, entity: { type: 'QUOTE_REQUEST', id: 'QR-1' } });
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(await rows(key)).toEqual([]);
    expect(await side.db.select().from(jobs).where(eq(jobs.kind, NOTIFICATION_EMAIL)).then((all) =>
      all.filter((job) => (job.payload as { notificationId?: string }).notificationId === key))).toEqual([]);
  });

  it('renders from the version in use when the message was generated', async () => {
    const customer = await buildCustomer(testApp.db);
    const key = keyFor('versioned');
    await publish(key, 'IN_APP', 1, { subject: 'Old wording' });
    await publish(key, 'IN_APP', 2, { subject: 'New wording' });
    // Published for next year: in use later, not now.
    await publish(key, 'IN_APP', 3, { subject: 'Future wording', activeFrom: new Date('2099-01-01') });

    await notify(customer.id, key, { insurer: 'Prestige Assurance' });

    const [written] = await rows(key);
    expect(written.templateVersion).toBe(2);
    expect(written.subject).toBe('New wording');
    expect(written.body).toBe('Your quote from Prestige Assurance is ready');
  });

  it('writes one message per channel, and only the external one waits on delivery', async () => {
    const customer = await buildCustomer(testApp.db);
    const key = keyFor('channels');
    await publish(key, 'IN_APP', 1);
    await publish(key, 'EMAIL', 1);

    await notify(customer.id, key, { insurer: 'Metro Safe' });

    const written = await rows(key);
    expect(written).toHaveLength(2);
    const inApp = written.find((row) => row.channel === 'IN_APP');
    const email = written.find((row) => row.channel === 'EMAIL');
    expect(inApp?.deliveryStatus, 'an in-app message is delivered by existing').toBe('SENT');
    expect(email?.deliveryStatus).toBe('PENDING');

    const queued = await side.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, NOTIFICATION_EMAIL), eq(jobs.key, email?.id ?? '')));
    expect(queued, 'only the email channel is queued for delivery').toHaveLength(1);
  });

  it('records the provider reference once the runner has sent it', async () => {
    const customer = await buildCustomer(testApp.db);
    const key = keyFor('delivered');
    await publish(key, 'EMAIL', 1);
    await notify(customer.id, key, { insurer: 'Global Guard' });

    await runner.runOnce();

    const [email] = await rows(key);
    expect(email.deliveryStatus).toBe('SENT');
    expect(email.providerReference).toMatch(/^log:/);
    expect(email.deliveredAt).not.toBeNull();
  });

  it('does not retry a message the provider refused, and says so on the record', async () => {
    const customer = await buildCustomer(testApp.db);
    const key = keyFor('refused');
    await publish(key, 'EMAIL', 1);
    await notify(customer.id, key, { insurer: 'Madison' });
    const sender = testApp.app.get(MAIL_SENDER) as { send: unknown };
    const original = sender.send;
    const refusal: MailResult = { result: 'failed', retryable: false, reason: 'provider answered 422' };
    sender.send = () => Promise.resolve(refusal);

    try {
      await runner.runOnce();
    } finally {
      sender.send = original;
    }

    const [email] = await rows(key);
    expect(email.deliveryStatus, 'a refusal is final').toBe('FAILED');
    const [job] = await side.db.select().from(jobs).where(eq(jobs.key, email.id));
    expect(job.status, 'and the job is finished rather than retried').toBe('DONE');
  });

  it('shows the centre newest first with unread state, and marks one read for its owner only', async () => {
    const customer = await buildCustomer(testApp.db);
    const other = await buildCustomer(testApp.db);
    const key = keyFor('centre');
    await publish(key, 'IN_APP', 1);
    await notify(customer.id, key, { insurer: 'First' });
    await notify(customer.id, key, { insurer: 'Second' });

    const listed = await repository.listFor(customer.id, { limit: 10 });
    expect(listed).toHaveLength(2);
    expect(listed[0].createdAt >= listed[1].createdAt, 'newest first').toBe(true);
    expect(await repository.unreadCount(customer.id)).toBe(2);

    expect(await repository.markRead(other.id, listed[0].id, new Date()), 'not this customer’s to read').toBe(false);
    expect(await repository.markRead(customer.id, listed[0].id, new Date())).toBe(true);
    expect(await repository.unreadCount(customer.id)).toBe(1);
    expect(await repository.markRead(customer.id, listed[0].id, new Date()), 'already read').toBe(false);
  });

  it('writes nothing when no version of the key is in use', async () => {
    const customer = await buildCustomer(testApp.db);
    const key = keyFor('unpublished');
    await publish(key, 'EMAIL', 1, { activeFrom: null as unknown as Date });

    await notify(customer.id, key);

    expect(await rows(key)).toEqual([]);
  });
});
