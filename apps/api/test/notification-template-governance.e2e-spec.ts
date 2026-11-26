import { and, desc, eq, inArray } from 'drizzle-orm';
import { vi } from 'vitest';
import { AuditService } from '../src/common/audit/audit.service.js';
import {
  auditLogs,
  jobs,
  notifications,
  notificationTemplates,
} from '../src/db/schema.js';
import { NotificationsRepository } from '../src/notifications/notifications.repository.js';
import { NotificationsService } from '../src/notifications/notifications.service.js';
import { TemplateGovernanceRepository } from '../src/notifications/template-governance.repository.js';
import { buildCustomer, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { MailFake } from './mail-fake.js';
import { signIn } from './sessions.js';

const root = '/api/v1/admin/notification-templates';
describe('notification template governance', () => {
  let app: TestApp;
  let author: Awaited<ReturnType<typeof signIn>>;
  let reviewer: Awaited<ReturnType<typeof signIn>>;
  const mail = new MailFake();
  const createdIds: string[] = [];
  beforeAll(async () => {
    app = await startApp({ mail });
    author = await signIn(
      app.http,
      await buildStaffUser(app.db, { role: 'ADMIN' }),
    );
    reviewer = await signIn(
      app.http,
      await buildStaffUser(app.db, { role: 'SUPER_ADMIN' }),
    );
  });
  afterAll(async () => {
    if (createdIds.length)
      await app.db
        .delete(notificationTemplates)
        .where(inArray(notificationTemplates.id, createdIds));
    await app.close();
  });
  async function source() {
    const [row] = await app.db
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.key, 'quote.ready'),
          eq(notificationTemplates.channel, 'EMAIL'),
        ),
      )
      .orderBy(desc(notificationTemplates.version))
      .limit(1);
    return row;
  }
  const input = (version: number) => ({
    expectedVersion: version,
    subject: 'An updated quote is ready',
    body: '{{insurer}} has quoted. Sign in to see it.',
    owner: 'Communications',
    effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 86400_000).toISOString(),
  });
  async function draft() {
    const base = await source();
    const response = await app.http
      .post(`${root}/${base.id}/versions`)
      .set(author)
      .send(input(base.version))
      .expect(201);
    createdIds.push(response.body.id);
    return response.body as { id: string; version: number; body: string };
  }
  it('protects all five paths against customers and insurer staff, and allows both administrator roles', async () => {
    const customer = await signIn(app.http, await buildCustomer(app.db));
    const insurer = await signIn(
      app.http,
      await buildStaffUser(app.db, { role: 'INSURER_ADMIN' }),
    );
    const base = await source();
    for (const session of [customer, insurer]) {
      await app.http.get(root).set(session).expect(403);
      await app.http
        .get('/api/v1/admin/notification-delivery-exceptions')
        .set(session)
        .expect(403);
      for (const action of ['versions', 'approve', 'withdraw'])
        await app.http
          .post(`${root}/${base.id}/${action}`)
          .set(session)
          .send({})
          .expect(403);
    }
    for (const session of [author, reviewer])
      await app.http.get(root).set(session).expect(200);
    await app.http.get(root).expect(401);
  });
  it('rejects policy mutation, unknown placeholders, malformed dates and non-plaintext copy', async () => {
    const base = await source();
    for (const changes of [
      { key: 'new.event' },
      { mandatory: false },
      { channel: 'IN_APP' },
      { body: '{{recipient}}' },
      { body: '<a href="https://example.test">Link</a>' },
      { body: 'https://example.test' },
      { subject: 'Subject\nBcc: hidden' },
      { effectiveFrom: '2026-02-30T10:00:00Z' },
      { expiresAt: '2000-01-01T00:00:00Z' },
    ]) {
      await app.http
        .post(`${root}/${base.id}/versions`)
        .set(author)
        .send({ ...input(base.version), ...changes })
        .expect(400);
    }
  });
  it('requires independent approval, preserves seeded/historical copy, and audits withdrawal', async () => {
    const customer = await buildCustomer(app.db);
    const repository = app.app.get(NotificationsRepository);
    const service = app.app.get(NotificationsService);
    const notify = () =>
      repository.transaction((tx) =>
        service.notify(tx, {
          customerId: customer.id,
          key: 'quote.ready',
          entity: { type: 'QUOTE_REQUEST', id: 'governance-test' },
          values: { insurer: 'Example insurer' },
        }),
      );
    await notify();
    const [historical] = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customer.id),
          eq(notifications.channel, 'EMAIL'),
        ),
      );
    const created = await draft();
    await notify();
    let rows = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customer.id),
          eq(notifications.channel, 'EMAIL'),
        ),
      );
    expect(rows.every((row) => row.templateVersion !== created.version)).toBe(
      true,
    );
    const decision = {
      expectedVersion: created.version,
      reason: 'Verified wording and mapping',
    };
    const self = await app.http
      .post(`${root}/${created.id}/approve`)
      .set(author)
      .send(decision)
      .expect(409);
    expect(self.body.code).toBe('NOTIFICATION_TEMPLATE_REVIEW');
    await app.http
      .post(`${root}/${created.id}/approve`)
      .set(reviewer)
      .send(decision)
      .expect(200);
    await notify();
    rows = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customer.id),
          eq(notifications.channel, 'EMAIL'),
        ),
      );
    const queued = rows.find((row) => row.templateVersion === created.version);
    expect(queued?.body).toBe('Example insurer has quoted. Sign in to see it.');
    const countBefore = mail.sent.length;
    await app.http
      .post(`${root}/${created.id}/withdraw`)
      .set(author)
      .send(decision)
      .expect(200);
    if (!queued) throw new Error('Expected governed notification');
    await service.deliver(queued.id);
    expect(mail.sent).toHaveLength(countBefore);
    const [failed] = await app.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, queued.id));
    expect(failed.deliveryStatus).toBe('FAILED');
    const [unchanged] = await app.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, historical.id));
    expect(unchanged).toEqual(historical);
    const audit = await app.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, created.id));
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'notification_template.created',
        'notification_template.approved',
        'notification_template.withdrawn',
      ]),
    );
    await app.http
      .post(`${root}/${created.id}/approve`)
      .set(reviewer)
      .send(decision)
      .expect(409);
    await notify();
    const after = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customer.id),
          eq(notifications.templateVersion, created.version),
          eq(notifications.channel, 'EMAIL'),
        ),
      );
    expect(after).toHaveLength(1);
  });
  it('rolls back version creation if its audit cannot be written', async () => {
    const base = await source();
    const spy = vi
      .spyOn(app.app.get(AuditService), 'write')
      .mockRejectedValueOnce(new Error('Audit unavailable'));
    try {
      await app.http
        .post(`${root}/${base.id}/versions`)
        .set(author)
        .send(input(base.version))
        .expect(500);
      expect((await source()).version).toBe(base.version);
    } finally {
      spy.mockRestore();
    }
  });
  it('does not deliver an approved queued message after expiry', async () => {
    const created = await draft();
    await app.http
      .post(`${root}/${created.id}/approve`)
      .set(reviewer)
      .send({ expectedVersion: created.version, reason: 'Expiry test review' })
      .expect(200);
    const customer = await buildCustomer(app.db);
    const service = app.app.get(NotificationsService);
    await app.app
      .get(NotificationsRepository)
      .transaction((tx) =>
        service.notify(tx, {
          customerId: customer.id,
          key: 'quote.ready',
          entity: { type: 'QUOTE_REQUEST', id: 'expired-test' },
          values: { insurer: 'Example' },
        }),
      );
    const [message] = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customer.id),
          eq(notifications.channel, 'EMAIL'),
        ),
      );
    expect(message.templateVersion).toBe(created.version);
    const before = mail.sent.length;
    await service.deliver(message.id, new Date(Date.now() + 2 * 86400_000));
    expect(mail.sent).toHaveLength(before);
    await app.http
      .post(`${root}/${created.id}/withdraw`)
      .set(author)
      .send({ expectedVersion: created.version, reason: 'End expiry test' })
      .expect(200);
  });
  it('serializes concurrent version creation against the same expected version', async () => {
    const base = await source();
    const repository = app.app.get(TemplateGovernanceRepository);
    const original = repository.lockSeries.bind(repository);
    let releaseFirst!: () => void;
    let signalSecond!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondEntered = new Promise<void>((resolve) => {
      signalSecond = resolve;
    });
    let calls = 0;
    const spy = vi
      .spyOn(repository, 'lockSeries')
      .mockImplementation(async (...args) => {
        const call = ++calls;
        if (call === 2) signalSecond();
        const rows = await original(...args);
        if (call === 1) await gate;
        return rows;
      });
    try {
      const first = app.http
        .post(`${root}/${base.id}/versions`)
        .set(author)
        .send(input(base.version))
        .then((response) => response);
      const second = app.http
        .post(`${root}/${base.id}/versions`)
        .set(reviewer)
        .send(input(base.version))
        .then((response) => response);
      await secondEntered;
      releaseFirst();
      const responses = await Promise.all([first, second]);
      expect(
        responses.map((response) => response.status).sort((a, b) => a - b),
      ).toEqual([201, 409]);
      for (const response of responses)
        if (response.status === 201) createdIds.push(response.body.id);
    } finally {
      releaseFirst();
      spy.mockRestore();
    }
  });
  it('returns safe delivery exceptions with existing job attempt/state and no recipient or provider text', async () => {
    const customer = await buildCustomer(app.db);
    const repository = app.app.get(NotificationsRepository);
    await repository.transaction((tx) =>
      app.app
        .get(NotificationsService)
        .notify(tx, {
          customerId: customer.id,
          key: 'quote.ready',
          entity: { type: 'QUOTE_REQUEST', id: 'exception-test' },
          values: { insurer: 'Example' },
        }),
    );
    const [message] = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customer.id),
          eq(notifications.channel, 'EMAIL'),
        ),
      );
    await app.db
      .update(jobs)
      .set({
        attempt: 5,
        status: 'FAILED',
        lastError: `Provider secret ${customer.email}`,
      })
      .where(
        and(eq(jobs.kind, 'notification.email'), eq(jobs.key, message.id)),
      );
    const response = await app.http
      .get('/api/v1/admin/notification-delivery-exceptions?limit=100')
      .set(author)
      .expect(200);
    const exception = response.body.items.find(
      (row: { id: string }) => row.id === message.id,
    );
    expect(exception).toMatchObject({
      event: 'quote.ready',
      version: message.templateVersion,
      attempt: 5,
      retryState: 'FAILED',
      reason: 'RETRY_EXHAUSTED',
    });
    expect(JSON.stringify(response.body)).not.toContain(customer.email);
    expect(JSON.stringify(response.body)).not.toContain('Provider secret');
  });
});
