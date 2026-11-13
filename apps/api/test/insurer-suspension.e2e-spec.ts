import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  claimNotifications,
  insurerQuotes,
  insurers,
  notifications,
  policies,
  quoteRequestRecipients,
} from '../src/db/schema.js';
import {
  buildClaim,
  buildCustomer,
  buildDocument,
  buildInsurer,
  buildPurchasedPolicy,
  buildQuoteRequest,
  buildStaffUser,
} from './builders.js';
import { buildPayableQuote } from './builders/payments.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

describe('insurer suspension', () => {
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

  it('cancels only unanswered deliveries, makes unpaid quotes unpayable and leaves paid business serviceable', async () => {
    const admin = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
    const checker = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
    const insurer = await buildInsurer(testApp.db);
    const awaitingCustomer = await buildCustomer(testApp.db);
    const { quoteRequest: awaitingRequest } = await buildQuoteRequest(testApp.db, {
      customerId: awaitingCustomer.id,
      insurerIds: [insurer.insurer.id],
    });
    const payable = await buildPayableQuote(testApp.db, { insurer });
    const purchased = await buildPurchasedPolicy(testApp.db, { insurer });
    const claim = await buildClaim(testApp.db, {
      insurerId: insurer.insurer.id,
      customerId: purchased.customer.id,
      policyNumber: purchased.policy.policyNumber,
    });

    const suspended = await testApp.http
      .post(`/api/v1/insurers/${insurer.insurer.id}/suspend`)
      .set(await signIn(testApp.http, admin))
      .send({ reason: 'The insurer is under regulatory review.' })
      .expect(200);
    expect(suspended.body).toMatchObject({ action: 'INSURER_SUSPEND', status: 'PENDING', targetId: insurer.insurer.id });
    expect((await side.db.select().from(insurers).where(eq(insurers.id, insurer.insurer.id)))[0].status).toBe('ACTIVE');

    // A timed-out maker request is never executed twice: the same action and
    // target may have only one pending decision.
    await testApp.http
      .post(`/api/v1/insurers/${insurer.insurer.id}/suspend`)
      .set(await signIn(testApp.http, admin))
      .send({ reason: 'Retry after a timed-out admin request.' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('APPROVAL_ALREADY_PENDING'));

    await testApp.http
      .post(`/api/v1/admin/approvals/${suspended.body.id}/approve`)
      .set(await signIn(testApp.http, checker))
      .send({ reason: 'Regulatory review confirmed.' })
      .expect(201)
      .expect(({ body }) => expect(body.status).toBe('EXECUTED'));

    const [cancelled] = await side.db
      .select()
      .from(quoteRequestRecipients)
      .where(
        and(
          eq(quoteRequestRecipients.quoteRequestId, awaitingRequest.id),
          eq(quoteRequestRecipients.insurerId, insurer.insurer.id),
        ),
      );
    expect(cancelled).toMatchObject({ cancelledReason: 'INSURER_SUSPENDED', cancelledAt: expect.any(Date) });

    const [unpayable] = await side.db.select().from(insurerQuotes).where(eq(insurerQuotes.id, payable.quote.id));
    expect(unpayable).toMatchObject({ unpayableReason: 'INSURER_SUSPENDED', unpayableAt: expect.any(Date) });

    const [paidQuote] = await side.db.select().from(insurerQuotes).where(eq(insurerQuotes.id, purchased.quote.id));
    expect(paidQuote.unpayableAt).toBeNull();
    expect((await side.db.select().from(policies).where(eq(policies.policyNumber, purchased.policy.policyNumber)))[0]).toMatchObject({
      insurerId: insurer.insurer.id,
    });
    expect((await side.db.select().from(claimNotifications).where(eq(claimNotifications.claimNumber, claim.claimNumber)))[0]).toMatchObject({
      insurerId: insurer.insurer.id,
      status: claim.status,
    });

    const notices = await side.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.customerId, awaitingCustomer.id), eq(notifications.templateKey, 'quote.cancelled')));
    expect(notices).toHaveLength(2);
    expect(notices.map((notice) => notice.channel).sort()).toEqual(['EMAIL', 'IN_APP']);

    // A later reinstatement must not revive work that was cancelled while the
    // insurer was suspended. The API reads this mark inside its own payment
    // transaction, not only in the earlier quote lookup.
    await side.db.update(insurers).set({ status: 'ACTIVE' }).where(eq(insurers.id, insurer.insurer.id));

    await testApp.http
      .post(`/api/v1/insurer/quote-requests/${awaitingRequest.id}/quote`)
      .set(await signIn(testApp.http, insurer.staff))
      .send({ premium: 1234.56, documentId: (await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'QUOTATION' })).id })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('REQUEST_UNAVAILABLE'));

    await testApp.http
      .post(`/api/v1/insurer/quote-requests/${payable.quoteRequest.id}/extend`)
      .set(await signIn(testApp.http, insurer.staff))
      .send({ extraDays: 3 })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('QUOTE_UNAVAILABLE'));

    await testApp.http
      .post('/api/v1/payments')
      .set(await signIn(testApp.http, payable.customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        quoteRequestId: payable.quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
      })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('QUOTE_UNAVAILABLE'));
  });
});
