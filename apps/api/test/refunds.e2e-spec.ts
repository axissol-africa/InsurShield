import { and, eq } from 'drizzle-orm';
import { notifications, paymentRefunds, payments, policies, reconciliationItems } from '../src/db/schema.js';
import { PaymentJobs } from '../src/payments/payment-jobs.js';
import { StandInPaymentProvider } from '../src/payments/provider/stand-in-payment-provider.js';
import { PaymentEventsService } from '../src/payments/payment-events.service.js';
import { RefundsService } from '../src/payments/refunds.service.js';
import { buildCustomer, buildInsurer, buildNcdCode, buildPayment, buildPurchasedPolicy, buildStaffUser } from './builders.js';
import { buildPayableQuote } from './builders/payments.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

type Session = Awaited<ReturnType<typeof signIn>>;

describe('refunds and the reconciliation queue', () => {
  let testApp: TestApp;
  let maker: Session;
  let checker: Session;
  let makerId: string;

  beforeAll(async () => {
    testApp = await startApp();
    const makerStaff = await buildStaffUser(testApp.db, { role: 'ADMIN', fullName: 'Mutinta Maker' });
    const checkerStaff = await buildStaffUser(testApp.db, { role: 'ADMIN', fullName: 'Chanda Checker' });
    makerId = makerStaff.id;
    maker = await signIn(testApp.http, makerStaff);
    checker = await signIn(testApp.http, checkerStaff);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const admin = (session: Session) => ({
    get: (path: string) => testApp.http.get(`/api/v1/admin/${path}`).set(session),
    post: (path: string, body: Record<string, unknown> = {}) => testApp.http.post(`/api/v1/admin/${path}`).set(session).send(body),
  });
  const refundRow = async (id: string) => (await testApp.db.select().from(paymentRefunds).where(eq(paymentRefunds.id, id)))[0];
  const itemRow = async (id: string) => (await testApp.db.select().from(reconciliationItems).where(eq(reconciliationItems.id, id)))[0];
  const policyRow = async (policyNumber: string) => (await testApp.db.select().from(policies).where(eq(policies.policyNumber, policyNumber)))[0];

  /** A paid policy the insurer could not issue, with its item waiting for the refund. */
  async function failedIssue(policyStatus: 'ISSUANCE_FAILED' | 'ACTIVE' = 'ISSUANCE_FAILED') {
    const insurer = await buildInsurer(testApp.db);
    const bought = await buildPurchasedPolicy(testApp.db, { insurer });
    const providerPaymentId = `SI-C-${bought.payment.amountMinor}-${bought.payment.id}`;
    await testApp.db.update(payments).set({ provider: 'STAND_IN', providerPaymentId }).where(eq(payments.id, bought.payment.id));
    await testApp.db.update(policies).set({ status: policyStatus }).where(eq(policies.policyNumber, bought.policy.policyNumber));
    const [item] = await testApp.db
      .insert(reconciliationItems)
      .values({
        kind: 'ISSUANCE_FAILED',
        paymentId: bought.payment.id,
        policyNumber: bought.policy.policyNumber,
        insurerId: insurer.insurer.id,
        amountMinor: bought.payment.amountMinor,
        reason: 'The insurer could not issue the policy.',
      })
      .returning();
    return { ...bought, providerPaymentId, item };
  }

  const propose = (transactionId: string, body: Record<string, unknown> = {}) =>
    admin(maker).post(`payments/${transactionId}/refunds`, {
      amount: 1234.56,
      reasonCode: 'ISSUANCE_FAILED',
      reason: 'The insurer could not issue the policy, so the customer gets their money back.',
      ...body,
    });

  /** Approved by the second administrator, then sent to the provider as the job would. */
  async function approveAndSend(approvalRequestId: string, refundId: string) {
    const approved = await admin(checker).post(`approvals/${approvalRequestId}/approve`);
    expect(approved.status).toBe(201);
    await testApp.app.get(RefundsService).submit(refundId);
  }

  it('does not dispatch a queued approved refund after a known payment reversal', async () => {
    const { payment, providerPaymentId } = await failedIssue();
    const proposed = await propose(payment.transactionId);
    expect(proposed.status).toBe(201);
    expect((await admin(checker).post(`approvals/${proposed.body.approvalRequestId}/approve`)).status).toBe(201);
    const provider = testApp.app.get(StandInPaymentProvider);
    const signed = provider.sign({ eventId: `reversal-${payment.id}`, type: 'payment.reversed', providerPaymentId,
      paymentId: payment.id, amountMinor: payment.amountMinor, currency: 'ZMW', reference: 'REVERSED', reason: null, occurredAt: new Date() });
    expect((await testApp.app.get(PaymentEventsService).receiveCallback(provider.route, signed.rawBody, signed.headers)).outcome).toBe('REVERSED');
    const dispatch = vi.spyOn(provider, 'refund');
    try {
      await testApp.app.get(RefundsService).submit(proposed.body.id);
      await testApp.app.get(RefundsService).submit(proposed.body.id);
      expect(dispatch).not.toHaveBeenCalled();
      expect(await refundRow(proposed.body.id)).toMatchObject({ status: 'FAILED', providerRefundId: null });
    } finally { dispatch.mockRestore(); }
  });

  it('refunds in full after a second approval: the provider completes it, the failed policy is cancelled and the item resolved', async () => {
    const { payment, policy, item, customer, providerPaymentId } = await failedIssue();
    const proposed = await propose(payment.transactionId, { reconciliationItemId: item.id });
    expect(proposed.status).toBe(201);
    expect(proposed.body).toMatchObject({ status: 'PROPOSED', amount: 1234.56, transactionId: payment.transactionId });
    expect((await itemRow(item.id)).status).toBe('IN_PROGRESS');

    // The maker cannot approve their own refund.
    expect((await admin(maker).post(`approvals/${proposed.body.approvalRequestId}/approve`)).status).toBe(403);
    const inbox = await admin(checker).get('approvals');
    expect(inbox.body.find((entry: { id: string }) => entry.id === proposed.body.approvalRequestId).proposal).toEqual({
      transactionId: payment.transactionId,
      amount: 1234.56,
      paidAmount: 1234.56,
      reasonCode: 'ISSUANCE_FAILED',
      reason: 'The insurer could not issue the policy, so the customer gets their money back.',
    });

    await approveAndSend(proposed.body.approvalRequestId, proposed.body.id);
    const sent = await refundRow(proposed.body.id);
    expect(sent).toMatchObject({ status: 'SUBMITTED', providerRefundId: `SIRF-${proposed.body.id}` });
    // A retried send changes nothing.
    await testApp.app.get(RefundsService).submit(proposed.body.id);
    expect((await refundRow(proposed.body.id)).submittedAt).toEqual(sent.submittedAt);

    const completed = await testApp.http
      .post('/api/v1/dev/payment-provider/events')
      .send({ providerPaymentId, type: 'refund.completed', providerRefundId: sent.providerRefundId });
    expect(completed.body.outcome).toBe('REFUNDED');
    expect((await refundRow(proposed.body.id)).status).toBe('COMPLETED');
    expect(await policyRow(policy.policyNumber)).toMatchObject({ status: 'CANCELLED', cancelledAt: expect.any(Date) });
    expect(await itemRow(item.id)).toMatchObject({ status: 'RESOLVED', outcome: 'REFUNDED' });
    const told = await testApp.db
      .select({ key: notifications.templateKey })
      .from(notifications)
      .where(and(eq(notifications.customerId, customer.id), eq(notifications.channel, 'IN_APP')));
    expect(told.map((row) => row.key)).toContain('payment.refunded');

    // Nothing is left to refund.
    expect((await propose(payment.transactionId, { amount: 1 })).body.code).toBe('REFUND_TOO_LARGE');
  });

  it('keeps the policy of a partly refunded payment, and the status check completes a refund whose callback never came', async () => {
    const { payment, policy } = await failedIssue('ACTIVE');
    const proposed = await propose(payment.transactionId, { amount: 100, reasonCode: 'CUSTOMER_REQUEST', reason: 'Goodwill refund agreed with the customer.' });
    await approveAndSend(proposed.body.approvalRequestId, proposed.body.id);
    await testApp.db.update(paymentRefunds).set({ submittedAt: new Date(Date.now() - 60 * 60_000) }).where(eq(paymentRefunds.id, proposed.body.id));

    await testApp.app.get(PaymentJobs).checkOpen();

    expect((await refundRow(proposed.body.id)).status).toBe('COMPLETED');
    expect((await policyRow(policy.policyNumber)).status).toBe('ACTIVE');
    expect((await propose(payment.transactionId, { amount: 1234.56 })).body).toMatchObject({ code: 'REFUND_TOO_LARGE', details: { remaining: 1134.56 } });
  });

  it('allows one refund in progress per payment, and a new one once the last was rejected or failed', async () => {
    const { payment, providerPaymentId } = await failedIssue();
    const first = await propose(payment.transactionId, { amount: 600 });
    expect((await propose(payment.transactionId, { amount: 600 })).body.code).toBe('REFUND_IN_PROGRESS');

    const rejected = await admin(checker).post(`approvals/${first.body.approvalRequestId}/reject`, { reason: 'Check the amount first.' });
    expect(rejected.status).toBe(201);
    expect((await refundRow(first.body.id)).status).toBe('REJECTED');

    const second = await propose(payment.transactionId, { amount: 600 });
    expect(second.status).toBe(201);
    await approveAndSend(second.body.approvalRequestId, second.body.id);
    const failed = await testApp.http
      .post('/api/v1/dev/payment-provider/events')
      .send({ providerPaymentId, type: 'refund.failed', providerRefundId: `SIRF-${second.body.id}` });
    expect(failed.body.outcome).toBe('REFUND_FAILED');
    expect(await refundRow(second.body.id)).toMatchObject({ status: 'FAILED', failureReason: 'The stand-in refused the refund.' });
    expect((await propose(payment.transactionId, { amount: 600 })).status).toBe(201);
  });

  it('checks the amount again at approval, with the payment locked', async () => {
    const { payment } = await failedIssue();
    const proposed = await propose(payment.transactionId, { amount: 1000 });
    // Money went back some other way meanwhile, as an earlier completed refund.
    await testApp.db.insert(paymentRefunds).values({
      paymentId: payment.id,
      amountMinor: 50_000,
      reasonCode: 'OTHER',
      reason: 'Refunded earlier.',
      status: 'COMPLETED',
      provider: 'STAND_IN',
      providerRefundId: `SIRF-earlier-${payment.id}`,
      proposedByStaffId: makerId,
      completedAt: new Date(),
    });
    const approved = await admin(checker).post(`approvals/${proposed.body.approvalRequestId}/approve`);
    expect(approved.body.code).toBe('REFUND_TOO_LARGE');
    expect((await refundRow(proposed.body.id)).status).toBe('PROPOSED');
  });

  it('refuses a refund for a payment that is not confirmed, or one nobody knows', async () => {
    const { payment } = await failedIssue();
    await testApp.db.update(payments).set({ status: 'REVERSED' }).where(eq(payments.id, payment.id));
    expect((await propose(payment.transactionId)).body.code).toBe('PAYMENT_NOT_REFUNDABLE');
    expect((await propose('TXN-NOBODY')).status).toBe(404);
    expect((await propose(payment.transactionId, { reason: 'Short.' })).status).toBe(400);
  });

  it('cannot refund a payment taken before the provider, which is refunded outside and then resolved', async () => {
    const { payment, item } = await failedIssue();
    await testApp.db.update(payments).set({ providerPaymentId: null }).where(eq(payments.id, payment.id));
    expect((await propose(payment.transactionId)).body.code).toBe('REFUND_NOT_POSSIBLE');
    const resolved = await admin(maker).post(`reconciliation/items/${item.id}/resolve`, { outcome: 'REFUNDED', note: 'Refunded by bank transfer outside InsurShield.' });
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', outcome: 'REFUNDED' });
  });

  describe('the queue', () => {
    it.each([
      ['verified late capture', 'EXPIRED', true, true, true, false],
      ['expired without capture', 'EXPIRED', false, true, false, false],
      ['reversed late capture', 'REVERSED', true, true, false, false],
      ['legacy confirmed payment', 'CONFIRMED', true, false, false, true],
    ] as const)('reports refund eligibility for a %s', async (_case, status, captured, hasProvider, refundable, requiresExternalRefund) => {
      const { customer, insurer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const code = await buildNcdCode(testApp.db, { insurerId: insurer.insurer.id });
      const payment = await buildPayment(testApp.db, {
        customerId: customer.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id,
      }, {
        status,
        confirmedAt: captured ? new Date() : null,
        providerPaymentId: hasProvider ? `SI-test-${quote.id}` : null,
        reservedNcdCode: hasProvider ? code.code : null,
      });
      const [entry] = await testApp.db.insert(reconciliationItems).values({
        kind: 'REFUND_REQUIRED', paymentId: payment.id, insurerId: insurer.insurer.id,
        reason: 'Review the provider’s report for this payment.',
      }).returning();

      const response = await admin(maker).get(`reconciliation/items?status=OPEN&insurerId=${insurer.insurer.id}`);

      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([expect.objectContaining({
        id: entry.id,
        payment: { transactionId: payment.transactionId, status, amount: 1234.56, refunded: 0, refundable, requiresExternalRefund },
      })]);
    });

    it('lists items oldest first with their payment and refunds, a page at a time', async () => {
      const first = await failedIssue();
      const second = await failedIssue();
      const page = await admin(maker).get(`reconciliation/items?status=OPEN&kind=ISSUANCE_FAILED&limit=1`);
      expect(page.status).toBe(200);
      expect(page.body.items).toHaveLength(1);
      expect(page.body.next).toEqual(expect.any(String));
      const all = [];
      let cursor: string | null = null;
      do {
        const next = await admin(maker).get(`reconciliation/items?kind=ISSUANCE_FAILED&limit=50${cursor ? `&cursor=${cursor}` : ''}`);
        all.push(...next.body.items);
        cursor = next.body.next;
      } while (cursor);
      const mine = all.filter((entry: { id: string }) => [first.item.id, second.item.id].includes(entry.id));
      expect(mine.map((entry: { id: string }) => entry.id)).toEqual([first.item.id, second.item.id]);
      expect(mine[0]).toMatchObject({
        kind: 'ISSUANCE_FAILED',
        status: 'OPEN',
        amount: 1234.56,
        policyNumber: first.policy.policyNumber,
        owner: null,
        payment: { transactionId: first.payment.transactionId, amount: 1234.56, refunded: 0, refundable: true },
        refunds: [],
        ageDays: 0,
      });
    });

    it('assigns an item, and resolves it only with an outcome and a note', async () => {
      const { item } = await failedIssue();
      const assigned = await admin(maker).post(`reconciliation/items/${item.id}/assign`, { staffId: makerId });
      expect(assigned.body).toMatchObject({ status: 'IN_PROGRESS', ownerStaffId: makerId });
      const mine = await admin(maker).get('reconciliation/items?owner=me&status=IN_PROGRESS');
      expect(mine.body.items.map((entry: { id: string }) => entry.id)).toContain(item.id);

      expect((await admin(maker).post(`reconciliation/items/${item.id}/resolve`, { outcome: 'NO_ACTION' })).status).toBe(400);
      expect((await admin(maker).post(`reconciliation/items/${item.id}/resolve`, { outcome: 'REFUNDED', note: 'Refunded outside the platform.' })).body.code).toBe(
        'NO_REFUND_COMPLETED',
      );
      const resolved = await admin(maker).post(`reconciliation/items/${item.id}/resolve`, { outcome: 'WRITTEN_OFF', note: 'The customer asked to keep the cover with another insurer.' });
      expect(resolved.body).toMatchObject({ status: 'RESOLVED', outcome: 'WRITTEN_OFF' });
      expect((await admin(maker).post(`reconciliation/items/${item.id}/resolve`, { outcome: 'NO_ACTION', note: 'Second time round.' })).body.code).toBe('ITEM_RESOLVED');
    });

    it('is InsurShield administrators only', async () => {
      const { payment, item } = await failedIssue();
      const insurer = await buildInsurer(testApp.db);
      const asInsurer = await signIn(testApp.http, insurer.staff);
      const customer = await buildCustomer(testApp.db);
      const asCustomer = await signIn(testApp.http, customer);
      for (const session of [asInsurer, asCustomer]) {
        expect((await admin(session).get('reconciliation/items')).status).toBe(403);
        expect((await admin(session).post(`reconciliation/items/${item.id}/resolve`, { outcome: 'NO_ACTION', note: 'Not mine to resolve.' })).status).toBe(403);
        expect((await propose(payment.transactionId).set(session)).status).toBe(403);
      }
      expect((await testApp.http.get('/api/v1/admin/reconciliation/items')).status).toBe(401);
    });
  });
});
