import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { auditLogs } from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildPurchasedPolicy, buildQuoteRequest } from './builders.js';
import { openTestDatabase, startApp, type TestApp, until } from './helpers.js';
import { signIn } from './sessions.js';

/**
 * US-VEN-001 asks that reaching another insurer's record, or a function the
 * role does not carry, is denied *and audited*. Denial was already true; the
 * audit is what these checks hold, together with what the row must not say.
 */
describe('a refused attempt is recorded', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  /** The refusal commits on its own connection, so it lands just after the response. */
  const refusalFor = async (actorId: string) => {
    let rows: { entityType: string; entityId: string; actorType: string; note: string | null }[] = [];
    await until(async () => {
      rows = await side.db
        .select({
          entityType: auditLogs.entityType,
          entityId: auditLogs.entityId,
          actorType: auditLogs.actorType,
          note: auditLogs.note,
        })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.refused'), eq(auditLogs.actorId, actorId)))
        .orderBy(desc(auditLogs.createdAt));
      return rows.length > 0;
    }, `a refusal recorded for ${actorId}`);
    return rows[0];
  };

  const noRefusalFor = async (actorId: string) =>
    side.db
      .select({ id: auditLogs.id })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.refused'), eq(auditLogs.actorId, actorId)));

  it('records an insurer reaching for another insurer’s quote request, and still answers as absent', async () => {
    const mine = await buildInsurer(testApp.db);
    const theirs = await buildInsurer(testApp.db);
    const customer = await buildCustomer(testApp.db);
    const { quoteRequest } = await buildQuoteRequest(testApp.db, {
      customerId: customer.id,
      insurerIds: [theirs.insurer.id],
    });

    const response = await testApp.http
      .post(`/api/v1/insurer/quote-requests/${quoteRequest.id}/quote`)
      .set(await signIn(testApp.http, mine.staff))
      .send({ premium: 100, documentId: randomUUID() });

    expect(response.status, 'the record answers as though it does not exist').toBe(404);
    const refusal = await refusalFor(mine.staff.id);
    expect(refusal).toMatchObject({
      entityType: 'QUOTE_REQUEST',
      entityId: quoteRequest.id,
      actorType: 'INSURER',
    });
    expect(refusal.note).toBe("Reached for another insurer's record.");
  });

  it('records nothing about the record itself, only that somebody reached for it', async () => {
    const mine = await buildInsurer(testApp.db);
    const theirs = await buildInsurer(testApp.db);
    const { policy } = await buildPurchasedPolicy(testApp.db, { insurer: theirs });

    await testApp.http
      .post(`/api/v1/insurer/policies/${policy.policyNumber}/certificate`)
      .set(await signIn(testApp.http, mine.staff))
      .send({ certificateDocumentId: randomUUID() })
      .expect(404);

    const [row] = await side.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.refused'), eq(auditLogs.actorId, mine.staff.id)));
    expect(row.entityId, 'what was reached for').toBe(policy.policyNumber);
    expect(row.before, 'never what it holds').toBeNull();
    expect(row.after).toBeNull();
  });

  it('leaves a mistyped reference unrecorded, because nobody reached across anything', async () => {
    const mine = await buildInsurer(testApp.db);

    await testApp.http
      .post('/api/v1/insurer/quote-requests/QR-DOES-NOT-EXIST/quote')
      .set(await signIn(testApp.http, mine.staff))
      .send({ premium: 100, documentId: randomUUID() })
      .expect(404);

    expect(await noRefusalFor(mine.staff.id), 'a typo is not an attempt on anybody').toEqual([]);
  });

  it('records a role reaching a function it does not carry', async () => {
    const insurer = await buildInsurer(testApp.db, { staff: { role: 'FINANCE' } });
    const customer = await buildCustomer(testApp.db);
    const { quoteRequest } = await buildQuoteRequest(testApp.db, {
      customerId: customer.id,
      insurerIds: [insurer.insurer.id],
    });

    // Finance holds no quoting permission, so the guard refuses before the service.
    await testApp.http
      .post(`/api/v1/insurer/quote-requests/${quoteRequest.id}/quote`)
      .set(await signIn(testApp.http, insurer.staff))
      .send({ premium: 100, documentId: randomUUID() })
      .expect(403);

    const refusal = await refusalFor(insurer.staff.id);
    expect(refusal).toMatchObject({
      entityType: 'PERMISSION',
      entityId: 'portal:quote:send',
      actorType: 'INSURER',
    });
  });

  it('does not record a customer meeting a staff route, which is not a role reaching past itself', async () => {
    const customer = await buildCustomer(testApp.db);

    await testApp.http.get('/api/v1/insurer/quote-requests').set(await signIn(testApp.http, customer)).expect(403);

    expect(await noRefusalFor(customer.id)).toEqual([]);
  });
});
