import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { notificationTemplates, notifications } from '../src/db/schema.js';
import { NotificationsRepository } from '../src/notifications/notifications.repository.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { buildCustomer, buildStaffUser } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

describe('the notification routes', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let service: NotificationsService;
  let repository: NotificationsRepository;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    service = testApp.app.get(NotificationsService);
    repository = testApp.app.get(NotificationsRepository);
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const key = `api.${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    await side.db.insert(notificationTemplates).values({
      key,
      channel: 'IN_APP',
      category: 'QUOTE',
      version: 1,
      subject: 'A quote is ready',
      body: '{{insurer}} has quoted.',
      mandatory: true,
      activeFrom: new Date('2020-01-01'),
    });
  });

  const notify = (customerId: string, insurer = 'Prestige Assurance') =>
    repository.transaction((tx) =>
      service.notify(tx, { customerId, key, entity: { type: 'QUOTE_REQUEST', id: 'QR-1' }, values: { insurer } }),
    );

  it('lists the customer’s own messages with their unread count and a cursor', async () => {
    const customer = await buildCustomer(testApp.db);
    await notify(customer.id, 'First');
    await notify(customer.id, 'Second');
    const session = await signIn(testApp.http, customer);

    const { body } = await testApp.http.get('/api/v1/notifications').set(session).expect(200);

    expect(body.items).toHaveLength(2);
    expect(body.unread).toBe(2);
    expect(body.nextCursor).toEqual(expect.any(String));
    // The template key and version are the platform's business, not the reader's.
    expect(Object.keys(body.items[0]).sort()).toEqual(
      ['body', 'category', 'createdAt', 'entityId', 'entityType', 'id', 'read', 'subject'].sort(),
    );
  });

  it('leaves another customer’s messages out of the list entirely', async () => {
    const mine = await buildCustomer(testApp.db);
    const theirs = await buildCustomer(testApp.db);
    await notify(theirs.id);

    const { body } = await testApp.http.get('/api/v1/notifications').set(await signIn(testApp.http, mine)).expect(200);

    expect(body.items).toEqual([]);
    expect(body.unread).toBe(0);
  });

  it('marks one read, and says nothing when asked twice', async () => {
    const customer = await buildCustomer(testApp.db);
    await notify(customer.id);
    const session = await signIn(testApp.http, customer);
    const { body } = await testApp.http.get('/api/v1/notifications').set(session).expect(200);
    const [message] = body.items;

    await testApp.http.post(`/api/v1/notifications/${message.id}/read`).set(session).expect(204);
    await testApp.http.post(`/api/v1/notifications/${message.id}/read`).set(session).expect(204);

    const [row] = await side.db.select().from(notifications).where(eq(notifications.id, message.id));
    expect(row.readAt, 'the first time is kept').not.toBeNull();
    const after = await testApp.http.get('/api/v1/notifications').set(session).expect(200);
    expect(after.body.unread).toBe(0);
  });

  it('answers 404 for another customer’s message, revealing nothing about it', async () => {
    const mine = await buildCustomer(testApp.db);
    const theirs = await buildCustomer(testApp.db);
    await notify(theirs.id);
    const [message] = await side.db.select().from(notifications).where(eq(notifications.customerId, theirs.id));

    const response = await testApp.http
      .post(`/api/v1/notifications/${message.id}/read`)
      .set(await signIn(testApp.http, mine))
      .expect(404);

    expect(response.body.message).not.toContain(theirs.email);
    const [unchanged] = await side.db.select().from(notifications).where(eq(notifications.id, message.id));
    expect(unchanged.readAt, 'and leaves it unread').toBeNull();
  });

  it('saves a contact preference and reads it back with the marketing answer', async () => {
    const customer = await buildCustomer(testApp.db);
    const session = await signIn(testApp.http, customer);

    await testApp.http
      .put('/api/v1/contact-preferences')
      .set(session)
      .send({ category: 'MARKETING', channel: 'EMAIL', enabled: false })
      .expect(204);

    const { body } = await testApp.http.get('/api/v1/contact-preferences').set(session).expect(200);
    expect(body.preferences).toContainEqual({ category: 'MARKETING', channel: 'EMAIL', enabled: false });
    expect(body.marketingConsent, 'never asked is not consent').toBe(false);
  });

  it('refuses a category or channel it does not define', async () => {
    const customer = await buildCustomer(testApp.db);
    const session = await signIn(testApp.http, customer);

    await testApp.http
      .put('/api/v1/contact-preferences')
      .set(session)
      .send({ category: 'EVERYTHING', channel: 'EMAIL', enabled: false })
      .expect(400);
    await testApp.http
      .put('/api/v1/contact-preferences')
      .set(session)
      .send({ category: 'MARKETING', channel: 'CARRIER_PIGEON', enabled: false })
      .expect(400);
  });

  it('gives staff no centre, because a message belongs to the customer it is about', async () => {
    const staff = await buildStaffUser(testApp.db, { role: 'ADMIN' });

    await testApp.http.get('/api/v1/notifications').set(await signIn(testApp.http, staff)).expect(403);
  });
});
