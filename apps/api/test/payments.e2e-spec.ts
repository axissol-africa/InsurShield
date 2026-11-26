import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';
import { MAX_KWACHA, MAX_NGWEE } from '../src/common/domain/money-limits.js';
import type { Env } from '../src/config/env.js';
import {
  auditLogs,
  insurerProductVersions,
  insurerProducts,
  insurerQuotes,
  inspections,
  ncdCodes,
  ncdApplications,
  vehicles,
  notifications,
  paymentCallbacks,
  payments,
  policies,
  quoteRequestProductVersions,
  quoteRequests,
  quoteSelections,
  reconciliationItems,
  type customers,
} from '../src/db/schema.js';
import { QuoteAvailabilityService } from '../src/customer/quote-availability.service.js';
import { PaymentEventsService } from '../src/payments/payment-events.service.js';
import { RefundsService } from '../src/payments/refunds.service.js';
import { PaymentJobs } from '../src/payments/payment-jobs.js';
import { ProviderUnavailableError, type PaymentEvent } from '../src/payments/provider/payment-provider.js';
import { StandInPaymentProvider } from '../src/payments/provider/stand-in-payment-provider.js';
import {
  buildCustomer,
  buildInsurer,
  buildInsurerQuote,
  buildNcdCode,
  buildPayment,
  buildPurchasedPolicy,
  buildQuoteRequest,
  buildStaffUser,
  buildVehicle,
  type Row,
} from './builders.js';
import { buildApprovedNcdCode } from './builders/customer.js';
import { addQuote, buildPayableQuote } from './builders/payments.js';
import { holdLocks, openTestDatabase, queueBehind, startApp, startRepeatableReadApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

type Customer = Row<typeof customers>;

const PAYMENT_KEYS = [
  'amount',
  'breakdown',
  'checkoutUrl',
  'confirmedAt',
  'currency',
  'failure',
  'initiatedAt',
  'insurer',
  'insurerQuoteId',
  'method',
  'payer',
  'pendingUntil',
  'policyNumber',
  'policyStatus',
  'quoteRequestId',
  'rtsaAnniversaryFee',
  'status',
  'transactionId',
];
const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
/** The stand-in's test wallets, by their last four digits. */
const WALLET = {
  confirms: '+260970000001',
  declines: '+260970000002',
  waits: '+260970000003',
  reverses: '+260970000004',
};
const LOCKING_THE_REQUEST = 'select % from "quote_requests" % for update';
const ANY_STATEMENT = '%';
const CLOSING_THE_ACCOUNT = `WITH locked AS (SELECT id FROM customers WHERE id = $1 FOR UPDATE)
  UPDATE customers SET "deletedAt" = now() FROM locked WHERE customers.id = locked.id`;

describe('payments', () => {
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

  const asCustomer = (customer: Customer) => signIn(testApp.http, customer);

  /** A payment as the web starts one: always with a key unless the test leaves it out on purpose. */
  const pay = async (customer: Customer, body: Record<string, unknown>, key: string | null = randomUUID()) => {
    const call = testApp.http.post('/api/v1/payments').set(await asCustomer(customer));
    return (key === null ? call : call.set('Idempotency-Key', key)).send(body);
  };
  const bodyFor = (quote: { quoteRequestId: string; id: string }, change: Record<string, unknown> = {}) => ({
    quoteRequestId: quote.quoteRequestId,
    insurerQuoteId: quote.id,
    amount: 1234.56,
    method: 'Mobile money',
    mobileNumber: WALLET.confirms,
    ...change,
  });
  /** Reading the status while it is open asks the provider, as the waiting page does. */
  const statusOf = async (customer: Customer, transactionId: string) =>
    testApp.http.get(`/api/v1/payments/${transactionId}`).set(await asCustomer(customer));
  /** Starts a payment and follows it until the provider settles it. */
  const payAndSettle = async (customer: Customer, body: Record<string, unknown>) => {
    const started = await pay(customer, body);
    expect(started.status).toBe(201);
    return statusOf(customer, started.body.transactionId);
  };

  const paymentsFor = (quoteRequestIds: string[]) =>
    testApp.db.select().from(payments).where(inArray(payments.quoteRequestId, quoteRequestIds));
  const policiesFor = (quoteRequestIds: string[]) =>
    testApp.db.select().from(policies).where(inArray(policies.quoteRequestId, quoteRequestIds));
  const itemsFor = (paymentId: string) => testApp.db.select().from(reconciliationItems).where(eq(reconciliationItems.paymentId, paymentId));
  const paymentRow = async (transactionId: string) =>
    (await testApp.db.select().from(payments).where(eq(payments.transactionId, transactionId)))[0];
  const lockedBy = (statement: string, values: unknown[]) => holdLocks(side.pool, (_db, client) => client.query(statement, values));

  /**
   * A product-selection request where one insurer quoted each of the given
   * products. The database only takes a quote for a product the customer chose.
   */
  async function productSelectionQuotes(
    quoteOverrides: Array<Partial<typeof insurerQuotes.$inferInsert>>,
    inspectionRules: Array<Pick<typeof insurerProductVersions.$inferInsert, 'inspectionRule' | 'inspectionTiming' | 'inspectionMethod'>> = [],
  ) {
    const customer = await buildCustomer(testApp.db);
    const insurer = await buildInsurer(testApp.db);
    const { quoteRequest } = await buildQuoteRequest(
      testApp.db,
      { customerId: customer.id, insurerIds: [insurer.insurer.id] },
      { model: 'PRODUCT_SELECTION', status: 'QUOTED' },
    );
    const [product] = await testApp.db
      .insert(insurerProducts)
      .values({ insurerId: insurer.insurer.id, code: `product-${randomUUID()}`, coverType: 'COMPREHENSIVE' })
      .returning();
    const versions = await testApp.db
      .insert(insurerProductVersions)
      .values(
        quoteOverrides.map((_override, index) => ({
          productId: product.id,
          versionNumber: index + 1,
          status: 'APPROVED' as const,
          name: `Comprehensive ${index + 1}`,
          coverType: 'COMPREHENSIVE' as const,
          coverGuide: {},
          ...(inspectionRules[index] ?? { inspectionRule: 'NOT_REQUIRED' as const }),
          rateBps: 500,
          allowedDurations: ['Q4' as const],
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
          createdByStaffId: insurer.staff.id,
        })),
      )
      .returning();
    await testApp.db.insert(quoteRequestProductVersions).values(
      versions.map((selected) => ({
        quoteRequestId: quoteRequest.id,
        productVersionId: selected.id,
        insurerId: insurer.insurer.id,
        productCode: product.code,
        productVersionNumber: selected.versionNumber,
        productName: selected.name,
        coverType: selected.coverType,
        coverGuide: selected.coverGuide,
        inspectionRule: selected.inspectionRule,
        inspectionTiming: selected.inspectionTiming,
        inspectionMethod: selected.inspectionMethod,
        status: 'QUOTED' as const,
      })),
    );
    const quotes = [];
    for (const [index, version] of versions.entries()) {
      const { quote } = await buildInsurerQuote(
        testApp.db,
        { quoteRequestId: quoteRequest.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
        { ...quoteOverrides[index], productVersionId: version.id },
      );
      quotes.push(quote);
    }
    return { customer, insurer, quoteRequest, versions, quotes, quote: quotes[0] };
  }

  const standIn = () => testApp.app.get(StandInPaymentProvider);
  const providerEvent = (providerPaymentId: string, change: Partial<PaymentEvent> = {}): PaymentEvent => ({
    eventId: `SIE-${randomUUID()}`,
    type: 'payment.confirmed',
    providerPaymentId,
    paymentId: null,
    amountMinor: standIn().chargedAmount(providerPaymentId),
    currency: 'ZMW',
    reference: 'SIR-TEST',
    reason: null,
    occurredAt: new Date(),
    ...change,
  });
  /** Sends a provider callback exactly as the provider would: signed raw bytes. */
  const callback = (signed: { rawBody: Buffer; headers: Record<string, string> }) =>
    testApp.http.post('/api/v1/payments/callbacks/stand-in').set(signed.headers).send(signed.rawBody.toString('utf8'));
  const send = (event: PaymentEvent) => callback(standIn().sign(event));

  describe('POST /payments', () => {
    it('starts the attempt and answers with its status, never a receipt; the provider then confirms it into a policy', async () => {
      const { customer, insurer, quoteRequest, quote } = await buildPayableQuote(testApp.db);

      const started = await pay(customer, bodyFor(quote));

      expect(started.status).toBe(201);
      expect(Object.keys(started.body).sort()).toEqual(PAYMENT_KEYS);
      expect(started.body).toMatchObject({
        status: 'Pending',
        method: 'Mobile money',
        amount: 1234.56,
        rtsaAnniversaryFee: 0,
        breakdown: [{ kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amount: 1234.56 }],
        currency: 'ZMW',
        payer: '***001',
        confirmedAt: null,
        checkoutUrl: null,
        failure: null,
        quoteRequestId: quoteRequest.id,
        insurerQuoteId: quote.id,
        insurer: insurer.insurer.name,
        policyNumber: null,
        policyStatus: null,
      });
      expect(started.body.transactionId).toMatch(/^TXN-[0-9A-Z]+$/);
      expect(started.body.initiatedAt).toMatch(ISO_MS);
      // The default pending window is 15 minutes.
      expect(new Date(started.body.pendingUntil).getTime() - new Date(started.body.initiatedAt).getTime()).toBe(15 * 60_000);
      expect(await policiesFor([quoteRequest.id])).toEqual([]);

      const [payment] = await paymentsFor([quoteRequest.id]);
      expect(payment).toMatchObject({
        status: 'PENDING',
        provider: 'STAND_IN',
        amountMinor: 123_456,
        payerMsisdnMasked: '***001',
        customerId: customer.id,
        insurerQuoteId: quote.id,
      });
      expect(payment.providerPaymentId).toMatch(/^SI-C-123456-/);
      // The whole wallet number is never stored.
      expect(JSON.stringify(payment)).not.toContain('970000001');

      const settled = await statusOf(customer, started.body.transactionId);
      expect(settled.body).toMatchObject({ status: 'Confirmed', policyStatus: 'Awaiting insurer certificate' });
      expect(settled.body.policyNumber).toMatch(/^POL-[0-9A-Z]+$/);
      expect(settled.body.confirmedAt).toMatch(ISO_MS);

      const [policy] = await policiesFor([quoteRequest.id]);
      expect(policy).toMatchObject({
        policyNumber: settled.body.policyNumber,
        status: 'AWAITING_INSURER_CERTIFICATE',
        insurerId: insurer.insurer.id,
        customerId: customer.id,
        vehicleId: quoteRequest.vehicleId,
        coverage: 'Comprehensive',
        premiumMinor: 123_456,
        insurerQuoteId: quote.id,
        insurerQuoteReference: quote.insurerReference,
        quoteDocumentId: quote.documentId,
        paymentId: payment.id,
        certificateDocumentId: null,
      });
      expect(policy.policyStartDate).toEqual(quoteRequest.policyStartDate);
      expect(policy.issuanceDueAt!.getTime() - policy.receivedAt.getTime()).toBe(12 * 60 * 60_000);

      const told = await testApp.db
        .select({ key: notifications.templateKey })
        .from(notifications)
        .where(and(eq(notifications.customerId, customer.id), eq(notifications.channel, 'IN_APP')));
      expect(told.map((message) => message.key).sort()).toEqual(['payment.confirmed', 'policy.created']);

      const request = await testApp.http.get(`/api/v1/quote-requests/${quoteRequest.id}`).set(await asCustomer(customer));
      expect(request.body).toMatchObject({ progress: 'POLICY_ISSUING', progressLabel: 'Policy issuing' });
    });

    it('sends a card payment to the provider checkout, back to an InsurShield page only', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);

      const foreign = await pay(customer, bodyFor(quote, { method: 'Card', mobileNumber: undefined, returnUrl: 'https://evil.example/' }));
      expect(foreign.status).toBe(400);
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);

      const origin = testApp.app.get(ConfigService<Env, true>).get('CORS_ORIGINS', { infer: true })[0];
      const started = await pay(customer, bodyFor(quote, { method: 'Card', mobileNumber: undefined, returnUrl: `${origin}/payment/return` }));
      expect(started.status).toBe(201);
      expect(started.body).toMatchObject({ status: 'Pending', method: 'Card', payer: null });
      expect(started.body.checkoutUrl).toContain('/api/v1/dev/payment-provider/checkout/SI-K-');

      // The stand-in checkout page, then its Pay button, which sends the signed confirmation and returns the customer.
      const checkout = new URL(started.body.checkoutUrl);
      const page = await testApp.http.get(checkout.pathname + checkout.search);
      expect(page.status).toBe(200);
      expect(page.text).toContain('ZMW 1,234.56');
      const paid = await testApp.http.post(checkout.pathname).type('form').send({ outcome: 'pay', returnUrl: `${origin}/payment/return` });
      expect(paid.status).toBe(303);
      expect(paid.headers.location).toBe(`${origin}/payment/return`);

      const settled = await statusOf(customer, started.body.transactionId);
      expect(settled.body).toMatchObject({ status: 'Confirmed', checkoutUrl: null });
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });

    it('asks for the wallet number of a mobile money payment', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const response = await pay(customer, bodyFor(quote, { mobileNumber: undefined }));
      expect(response.status).toBe(400);
      expect(response.body.details).toEqual({ mobileNumber: 'Enter a mobile money number.' });
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    describe('the amount', () => {
      it('uses the configured RTSA anniversary fee only for an aligned request, and itemises it', async () => {
        const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db, {
          request: { matchRtsaAnniversary: true },
          quote: { premiumMinor: 123_456 },
        });

        const response = await pay(customer, bodyFor(quote, { amount: 1734.56 }));

        expect(response.status).toBe(201);
        expect(response.body).toMatchObject({
          amount: 1734.56,
          rtsaAnniversaryFee: 500,
          breakdown: [
            { kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amount: 1234.56 },
            { kind: 'CHARGE', code: 'RTSA_ANNIVERSARY_FEE', label: 'RTSA anniversary fee', amount: 500 },
          ],
        });
        await statusOf(customer, response.body.transactionId);
        const [payment] = await paymentsFor([quoteRequest.id]);
        expect(payment).toMatchObject({ amountMinor: 173_456, rtsaAnniversaryFeeMinor: 50_000, status: 'CONFIRMED' });
        const [policy] = await policiesFor([quoteRequest.id]);
        expect(policy.premiumMinor).toBe(123_456);
      });

      it.each([
        ['one ngwee under', 1734.55],
        ['one ngwee over', 1734.57],
      ])('refuses an aligned payment that is %s with the expected breakdown, and stores nothing', async (_case, amount) => {
        const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db, { request: { matchRtsaAnniversary: true } });

        const response = await pay(customer, bodyFor(quote, { amount }));

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
          code: 'AMOUNT_MISMATCH',
          message: 'The amount does not match the quote. Reload the quote and try again.',
          details: {
            expected: 1734.56,
            received: amount,
            breakdown: [
              { kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amount: 1234.56 },
              { kind: 'CHARGE', code: 'RTSA_ANNIVERSARY_FEE', label: 'RTSA anniversary fee', amount: 500 },
            ],
          },
        });
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      });

      it('does not charge the fee for an unaligned request', async () => {
        const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
        const response = await pay(customer, bodyFor(quote, { amount: 1734.56 }));
        expect(response.status).toBe(409);
        expect(response.body.details).toMatchObject({ expected: 1234.56, received: 1734.56 });
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      });

      it('refuses a client-supplied RTSA fee instead of trusting it', async () => {
        const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
        const response = await pay(customer, bodyFor(quote, { rtsaAnniversaryFee: 500 }));
        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_FAILED');
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      });

      it('refuses an amount above MAX_KWACHA with 400, and stores nothing', async () => {
        const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
        const response = await pay(customer, bodyFor(quote, { amount: MAX_KWACHA + 0.01 }));
        expect(response.status).toBe(400);
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      });

      it('rejects an aligned quote whose premium and configured fee exceed MAX_KWACHA', async () => {
        const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db, {
          request: { matchRtsaAnniversary: true },
          quote: { premiumMinor: Number(MAX_NGWEE) },
        });
        const response = await pay(customer, bodyFor(quote, { amount: MAX_KWACHA }));
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('PAYMENT_AMOUNT_TOO_HIGH');
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      });

      it('adds the optional add-ons the customer chose, never one included in the quote', async () => {
        const { customer, quoteRequest, quote } = await productSelectionQuotes([
          {
            addOns: [
              { code: 'WINDSCREEN', label: 'Windscreen cover', priceMinor: 15_000, included: false, terms: null },
              { code: 'TOWING', label: 'Towing', priceMinor: 9_000, included: true, terms: null },
            ],
          },
        ]);
        const session = await asCustomer(customer);
        const included = await testApp.http
          .post(`/api/v1/quote-requests/${quoteRequest.id}/selection`)
          .set(session)
          .send({ insurerQuoteId: quote.id, addOnCodes: ['TOWING'] });
        expect(included.status).toBe(400);
        await testApp.http
          .post(`/api/v1/quote-requests/${quoteRequest.id}/selection`)
          .set(session)
          .send({ insurerQuoteId: quote.id, addOnCodes: ['WINDSCREEN'] })
          .expect(200);

        const response = await pay(customer, bodyFor(quote, { amount: 1384.56 }));

        expect(response.status).toBe(201);
        expect(response.body.breakdown).toEqual([
          { kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amount: 1234.56 },
          { kind: 'ADD_ON', code: 'WINDSCREEN', label: 'Windscreen cover', amount: 150 },
        ]);
        const [selection] = await testApp.db.select().from(quoteSelections).where(eq(quoteSelections.quoteRequestId, quoteRequest.id));
        expect((await paymentsFor([quoteRequest.id]))[0].selectionId).toBe(selection.id);

        // While the payment is under way the choice cannot change underneath it.
        const changed = await testApp.http
          .post(`/api/v1/quote-requests/${quoteRequest.id}/selection`)
          .set(session)
          .send({ insurerQuoteId: quote.id });
        expect(changed.status).toBe(409);
        expect(changed.body.code).toBe('PAYMENT_IN_PROGRESS');
      });

      it('needs a product-selection quote to be chosen before it is paid', async () => {
        const { customer, quoteRequest, quote } = await productSelectionQuotes([{}]);
        const response = await pay(customer, bodyFor(quote));
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('SELECTION_REQUIRED');
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      });
    });

    it('refuses an expired quote, and nothing is stored', async () => {
      const { customer, insurer, quoteRequest, quote } = await buildPayableQuote(testApp.db, {
        quote: { validUntil: new Date('2026-01-15T09:00:00.000Z') },
      });
      const response = await pay(customer, bodyFor(quote));
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        code: 'QUOTE_EXPIRED',
        message: `${insurer.insurer.name}'s quote expired on 2026-01-15. Request fresh quotes to continue.`,
        details: null,
      });
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('refuses a second attempt while one is open, and a new one once the request is paid', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const first = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }));

      const whileOpen = await pay(customer, bodyFor(quote));
      expect(whileOpen.status).toBe(409);
      expect(whileOpen.body).toMatchObject({
        code: 'PAYMENT_IN_PROGRESS',
        details: { transactionId: first.body.transactionId, status: 'PENDING' },
      });

      // The customer gives up on the stuck prompt, then pays with another wallet.
      const cancelled = await testApp.http.post(`/api/v1/payments/${first.body.transactionId}/cancel`).set(await asCustomer(customer));
      expect(cancelled.status).toBe(200);
      expect(cancelled.body).toMatchObject({ status: 'Cancelled', failure: 'The payment was cancelled. No money was taken.' });
      const second = await payAndSettle(customer, bodyFor(quote));
      expect(second.body.status).toBe('Confirmed');

      const third = await pay(customer, bodyFor(quote));
      expect(third.status).toBe(409);
      expect(third.body.code).toBe('ALREADY_PAID');
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(2);
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });

    it('needs an Idempotency-Key, so a retry can always be recognised', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const response = await pay(customer, bodyFor(quote), null);
      expect(response.status).toBe(400);
      expect(response.body.message).toBe('Send an Idempotency-Key header of 1 to 200 characters, so a retry cannot pay twice.');
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('reports a quote that does not belong to this request as not found', async () => {
      const { customer, quoteRequest } = await buildPayableQuote(testApp.db);
      const quoteId = randomUUID();
      const response = await pay(customer, bodyFor({ quoteRequestId: quoteRequest.id, id: quoteId }));
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND', message: `Quote ${quoteId} was not found.`, details: null });
    });

    it('pays the exact quote, when the request has several', async () => {
      const { customer, quoteRequest } = await buildPayableQuote(testApp.db);
      const { insurer: second, quote } = await addQuote(testApp.db, quoteRequest.id, { premiumMinor: 99_999 });

      const response = await payAndSettle(customer, bodyFor(quote, { amount: 999.99 }));

      expect(response.body.status).toBe('Confirmed');
      const [policy] = await policiesFor([quoteRequest.id]);
      expect(policy).toMatchObject({ insurerId: second.insurer.id, insurerQuoteId: quote.id, premiumMinor: 99_999 });
    });

    it('records the product version on the policy when one insurer offered more than one product', async () => {
      const { customer, quoteRequest, quotes: sent, versions } = await productSelectionQuotes([{ premiumMinor: 99_999 }, { premiumMinor: 88_888 }]);
      const sibling = sent[1];
      await testApp.http
        .post(`/api/v1/quote-requests/${quoteRequest.id}/selection`)
        .set(await asCustomer(customer))
        .send({ insurerQuoteId: sibling.id })
        .expect(200);

      const response = await payAndSettle(customer, bodyFor(sibling, { amount: 888.88 }));

      expect(response.body.status).toBe('Confirmed');
      const [policy] = await policiesFor([quoteRequest.id]);
      expect(policy).toMatchObject({ insurerQuoteId: sibling.id, premiumMinor: 88_888, productVersionId: versions[1].id });
      const shown = await testApp.http.get(`/api/v1/policies/${policy.policyNumber}`).set(await asCustomer(customer));
      expect(shown.body.product).toEqual({ name: versions[1].name, versionNumber: 2 });
      expect(shown.body.issuance).toMatchObject({ dueAt: expect.any(String), overdue: false });
    });

    it.each([
      ['a too-short request id', { quoteRequestId: 'QR' }],
      ['an invalid quote ID', { insurerQuoteId: 'not-a-quote-id' }],
      ['a zero amount', { amount: 0 }],
      ['a string amount', { amount: '1234.56' }],
      ['an amount with three decimals', { amount: 1234.561 }],
      ['an unknown method', { method: 'Cash' }],
    ])('refuses %s with 400, and nothing is stored', async (_case, change) => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const response = await pay(customer, bodyFor(quote, change));
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('refuses the retired insurer-name-only payment payload and asks the customer to reload', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const response = await pay(customer, { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' });
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('RELOAD_REQUIRED');
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });
  });

  describe('ownership', () => {
    it('answers 404 for another customer’s request, and stores nothing', async () => {
      const { quote, quoteRequest } = await buildPayableQuote(testApp.db);
      const stranger = await buildCustomer(testApp.db);
      const response = await pay(stranger, bodyFor(quote));
      expect(response.status).toBe(404);
      expect(response.body.message).toBe(`Quote request ${quoteRequest.id} was not found.`);
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('does not let a customer pay another customer’s quote through their own request', async () => {
      const own = await buildPayableQuote(testApp.db);
      const other = await buildPayableQuote(testApp.db);
      const response = await pay(own.customer, bodyFor({ quoteRequestId: own.quoteRequest.id, id: other.quote.id }));
      expect(response.status).toBe(404);
      expect(await paymentsFor([own.quoteRequest.id, other.quoteRequest.id])).toEqual([]);
    });

    it('answers 404 for another customer’s payment, on reading and on cancelling', async () => {
      const { customer, quote } = await buildPayableQuote(testApp.db);
      const started = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }));
      const stranger = await buildCustomer(testApp.db);
      const session = await asCustomer(stranger);
      expect((await testApp.http.get(`/api/v1/payments/${started.body.transactionId}`).set(session)).status).toBe(404);
      expect((await testApp.http.post(`/api/v1/payments/${started.body.transactionId}/cancel`).set(session)).status).toBe(404);
      expect((await paymentRow(started.body.transactionId)).status).toBe('PENDING');
    });

    it('refuses staff on every customer route', async () => {
      const staff = await buildStaffUser(testApp.db);
      const auth = await signIn(testApp.http, staff);
      const posted = await testApp.http
        .post('/api/v1/payments')
        .set(auth)
        .set('Idempotency-Key', randomUUID())
        .send({ quoteRequestId: 'QR-none', amount: 1, method: 'Card' });
      expect(posted.status).toBe(403);
      expect((await testApp.http.get('/api/v1/payments/TXN-NONE').set(auth)).status).toBe(403);
      expect((await testApp.http.post('/api/v1/payments/TXN-NONE/cancel').set(auth)).status).toBe(403);
    });
  });

  describe('GET /payments/:transactionId', () => {
    it('shows a payment from before this batch as it was stored', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const payment = await buildPayment(
        testApp.db,
        { customerId: customer.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id },
        { amountMinor: 1, status: 'EXPIRED', failureCode: 'NEVER_SENT', confirmedAt: null, method: 'CARD' },
      );
      const response = await statusOf(customer, payment.transactionId);
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'Expired',
        amount: 0.01,
        breakdown: [],
        confirmedAt: null,
        policyNumber: null,
        failure: 'This payment was never completed. No money was taken.',
      });
    });

    it('answers 404 for an unknown transaction', async () => {
      const customer = await buildCustomer(testApp.db);
      const response = await statusOf(customer, 'TXN-UNKNOWN');
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Payment TXN-UNKNOWN was not found.', details: null });
    });
  });

  describe('the Idempotency-Key header', () => {
    it.each([
      ['empty', ' '],
      ['201 characters long', 'k'.repeat(201)],
      ['3000 random characters long', randomBytes(1500).toString('hex')],
    ])('is refused with 400 when %s, and nothing is stored', async (_case, key) => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const response = await pay(customer, bodyFor(quote), key);
      expect(response.status).toBe(400);
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('used again for the same payment answers with that attempt as it now stands, and starts nothing more', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const key = randomUUID().padEnd(200, 'k');
      const first = await pay(customer, bodyFor(quote), key);
      await statusOf(customer, first.body.transactionId);

      const again = await pay(customer, bodyFor(quote), key);

      expect(again.status).toBe(201);
      expect(again.body).toMatchObject({ transactionId: first.body.transactionId, status: 'Confirmed' });
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });

    it.each([
      ['amount', { amount: 1234.57 }],
      ['method', { method: 'Card', mobileNumber: undefined }],
    ])('with a different %s answers 409 IDEMPOTENCY_KEY_REUSED', async (_field, change) => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      await pay(customer, bodyFor(quote), key);
      const response = await pay(customer, bodyFor(quote, change), key);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('of another customer answers 403', async () => {
      const { customer, quote } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      await pay(customer, bodyFor(quote), key);
      const stranger = await buildCustomer(testApp.db);
      expect((await pay(stranger, bodyFor(quote), key)).status).toBe(403);
    });

    it('is not used up by a refused request', async () => {
      const { customer, quote } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      const refused = await pay(customer, bodyFor(quote, { amount: 1 }), key);
      const accepted = await pay(customer, bodyFor(quote), key);
      expect(refused.body.code).toBe('AMOUNT_MISMATCH');
      expect(accepted.status).toBe(201);
    });
  });

  describe('provider callbacks', () => {
    const started = async (wallet = WALLET.waits) => {
      const parts = await buildPayableQuote(testApp.db);
      const response = await pay(parts.customer, bodyFor(parts.quote, { mobileNumber: wallet }));
      const payment = await paymentRow(response.body.transactionId);
      return { ...parts, payment };
    };

    it('confirm a payment into exactly one policy, and a replay changes nothing', async () => {
      const { customer, quoteRequest, payment } = await started();
      const signed = standIn().sign(providerEvent(payment.providerPaymentId!));

      const first = await callback(signed);
      const again = await callback(signed);

      expect(first.status).toBe(200);
      expect(first.body).toEqual({ eventId: expect.stringMatching(/^SIE-/), outcome: 'POLICY_CREATED', replayed: false });
      expect(again.body).toEqual({ eventId: first.body.eventId, outcome: 'POLICY_CREATED', replayed: true });
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
      expect((await statusOf(customer, payment.transactionId)).body.status).toBe('Confirmed');

      // The same confirmation under a new event id, as a provider retrying might send, is already done.
      const retried = await send(providerEvent(payment.providerPaymentId!));
      expect(retried.body.outcome).toBe('ALREADY_APPLIED');
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });

    it('refuse the same event id with other content', async () => {
      const { payment } = await started();
      const event = providerEvent(payment.providerPaymentId!);
      await send({ ...event, type: 'payment.failed' });
      const reused = await send(event);
      expect(reused.status).toBe(409);
      expect(reused.body.code).toBe('CALLBACK_EVENT_REUSED');
      expect((await paymentRow(payment.transactionId)).status).toBe('FAILED');
    });

    it('refuse a forged, tampered or stale callback before anything changes', async () => {
      const { payment } = await started();
      const signed = standIn().sign(providerEvent(payment.providerPaymentId!));

      const forged = await callback({ rawBody: signed.rawBody, headers: { ...signed.headers, 'x-stand-in-signature': 'a'.repeat(64) } });
      const tampered = await callback({
        rawBody: Buffer.from(signed.rawBody.toString().replace(`"amountMinor":${payment.amountMinor}`, '"amountMinor":1')),
        headers: signed.headers,
      });
      const stale = await callback(standIn().sign(providerEvent(payment.providerPaymentId!), new Date(Date.now() - 10 * 60_000)));
      const unknownProvider = await testApp.http.post('/api/v1/payments/callbacks/other').set(signed.headers).send(signed.rawBody.toString());

      expect([forged.status, tampered.status, stale.status, unknownProvider.status]).toEqual([401, 401, 401, 404]);
      expect(stale.body.code).toBe('STALE_CALLBACK');
      expect((await paymentRow(payment.transactionId)).status).toBe('PENDING');
      expect(await testApp.db.select().from(paymentCallbacks).where(eq(paymentCallbacks.paymentId, payment.id))).toEqual([]);
    });

    it('keep money taken for the wrong amount, without a policy, for a person to sort out', async () => {
      const { customer, quoteRequest, payment } = await started();
      const response = await send(providerEvent(payment.providerPaymentId!, { amountMinor: payment.amountMinor - 100 }));

      expect(response.body.outcome).toBe('AMOUNT_MISMATCH');
      expect((await paymentRow(payment.transactionId)).status).toBe('CONFIRMED');
      expect(await policiesFor([quoteRequest.id])).toEqual([]);
      expect(await itemsFor(payment.id)).toEqual([
        expect.objectContaining({ kind: 'AMOUNT_MISMATCH', status: 'OPEN', amountMinor: payment.amountMinor - 100 }),
      ]);
      const request = await testApp.http.get(`/api/v1/quote-requests/${quoteRequest.id}`).set(await asCustomer(customer));
      expect(request.body.progress).toBe('PAYMENT_REVIEW');
    });

    it('refund a confirmation that arrives after the insurer was suspended, and issue nothing', async () => {
      const { insurer, quoteRequest, payment, customer } = await started();
      await testApp.db
        .update(insurerQuotes)
        .set({ unpayableAt: new Date(), unpayableReason: 'INSURER_SUSPENDED' })
        .where(eq(insurerQuotes.id, payment.insurerQuoteId));

      const response = await send(providerEvent(payment.providerPaymentId!));

      expect(response.body.outcome).toBe('REFUND_REQUIRED');
      expect(await policiesFor([quoteRequest.id])).toEqual([]);
      expect(await itemsFor(payment.id)).toEqual([
        expect.objectContaining({
          kind: 'REFUND_REQUIRED',
          insurerId: insurer.insurer.id,
          reason: 'The insurer became unavailable while the payment was pending.',
        }),
      ]);
      const told = await testApp.db.select({ key: notifications.templateKey }).from(notifications).where(eq(notifications.customerId, customer.id));
      expect(told.map((message) => message.key)).toContain('payment.held');
    });

    it('treat a failure after a confirmation as a conflict and change nothing', async () => {
      const { payment, quoteRequest } = await started(WALLET.confirms);
      await send(providerEvent(payment.providerPaymentId!));
      const conflict = await send(providerEvent(payment.providerPaymentId!, { type: 'payment.failed' }));
      expect(conflict.body.outcome).toBe('STATE_CONFLICT');
      expect((await paymentRow(payment.transactionId)).status).toBe('CONFIRMED');
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
      expect(await itemsFor(payment.id)).toEqual([expect.objectContaining({ kind: 'STATE_CONFLICT' })]);
    });

    it('record a reversal of a confirmed payment and leave the policy to operations', async () => {
      const { payment, quoteRequest, customer } = await started(WALLET.reverses);
      await statusOf(customer, payment.transactionId);
      const reversed = await testApp.http
        .post('/api/v1/dev/payment-provider/events')
        .send({ providerPaymentId: payment.providerPaymentId, type: 'payment.reversed' });
      expect(reversed.body.outcome).toBe('REVERSED');
      const [policy] = await policiesFor([quoteRequest.id]);
      expect(policy.status).toBe('AWAITING_INSURER_CERTIFICATE');
      expect(await itemsFor(payment.id)).toEqual([expect.objectContaining({ kind: 'REVERSAL', policyNumber: policy.policyNumber })]);
      expect((await statusOf(customer, payment.transactionId)).body.status).toBe('Reversed');
    });

    it('store an event for a payment nobody knows, for a person to look at', async () => {
      const response = await send(providerEvent(`SI-C-100-${randomUUID()}`));
      expect(response.body.outcome).toBe('UNMATCHED');
      const [stored] = await testApp.db.select().from(paymentCallbacks).where(eq(paymentCallbacks.eventId, response.body.eventId));
      const [item] = await testApp.db.select().from(reconciliationItems).where(eq(reconciliationItems.paymentCallbackId, stored.id));
      expect(item).toMatchObject({ kind: 'UNMATCHED_PROVIDER_EVENT', paymentId: null });
    });

    it('let a declined payment be tried again', async () => {
      const { customer, quote, quoteRequest } = await buildPayableQuote(testApp.db);
      const declined = await payAndSettle(customer, bodyFor(quote, { mobileNumber: WALLET.declines }));
      expect(declined.body).toMatchObject({ status: 'Failed', failure: 'The payment was declined. No money was taken.' });
      const request = await testApp.http.get(`/api/v1/quote-requests/${quoteRequest.id}`).set(await asCustomer(customer));
      expect(request.body.progress).toBe('PAYMENT_FAILED');

      const retried = await payAndSettle(customer, bodyFor(quote));
      expect(retried.body.status).toBe('Confirmed');
    });

    it('let the customer stop a waiting payment; it ends only on the provider answer', async () => {
      const { customer, quote, payment } = await started();
      const stopped = await testApp.http.post(`/api/v1/payments/${payment.transactionId}/cancel`).set(await asCustomer(customer));
      expect(stopped.status).toBe(200);
      expect(stopped.body.status).toBe('Cancelled');
      const again = await testApp.http.post(`/api/v1/payments/${payment.transactionId}/cancel`).set(await asCustomer(customer));
      expect(again.body.code).toBe('PAYMENT_NOT_OPEN');
      expect((await payAndSettle(customer, bodyFor(quote))).body.status).toBe('Confirmed');
    });

    it('honour a quote that expired while its payment was pending', async () => {
      const { quoteRequest, payment } = await started();
      await testApp.db.update(insurerQuotes).set({ validUntil: new Date(Date.now() - 60_000) }).where(eq(insurerQuotes.id, payment.insurerQuoteId));
      const response = await send(providerEvent(payment.providerPaymentId!));
      expect(response.body.outcome).toBe('POLICY_CREATED');
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });

    it('stop a pending attempt at the provider when its insurer is suspended', async () => {
      const { insurer, payment } = await started();
      await testApp.db.transaction((tx) =>
        testApp.app.get(QuoteAvailabilityService).cancelForSuspendedInsurer(tx, {
          insurerId: insurer.insurer.id,
          insurerName: insurer.insurer.name,
          suspendedAt: new Date(),
        }),
      );
      await testApp.app.get(PaymentJobs).cancelAtProvider(payment.id);
      expect((await paymentRow(payment.transactionId)).status).toBe('CANCELLED');
      expect((await paymentRow(payment.transactionId)).providerPaymentId).toBe(payment.providerPaymentId);
    });

    it('cannot be imitated by the browser: no customer route confirms a payment', async () => {
      const { customer, payment } = await started();
      const session = await asCustomer(customer);
      const attempts = [
        await testApp.http.post(`/api/v1/payments/${payment.transactionId}`).set(session).send({ status: 'Confirmed' }),
        await testApp.http.patch(`/api/v1/payments/${payment.transactionId}`).set(session).send({ status: 'Confirmed' }),
        await testApp.http.post('/api/v1/payments/callbacks/stand-in').set(session).send({ id: 'x', type: 'payment.confirmed', data: {} }),
      ];
      for (const attempt of attempts) expect([401, 404]).toContain(attempt.status);
      expect((await paymentRow(payment.transactionId)).status).toBe('PENDING');
    });
  });

  describe('the status job', () => {
    it('leaves an attempt the provider never answered open, then ends it at its deadline', async () => {
      const unreachable = await startApp({
        override: (builder) =>
          builder.overrideProvider(StandInPaymentProvider).useFactory({
            factory: (config: ConfigService<Env, true>) => {
              const provider = new StandInPaymentProvider(config);
              provider.initiate = () => Promise.reject(new ProviderUnavailableError('timed out'));
              return provider;
            },
            inject: [ConfigService],
          }),
      });
      try {
        const { customer, quote, quoteRequest } = await buildPayableQuote(testApp.db);
        const started = await unreachable.http
          .post('/api/v1/payments')
          .set(await signIn(unreachable.http, customer))
          .set('Idempotency-Key', randomUUID())
          .send(bodyFor(quote));
        expect(started.status).toBe(201);
        expect(started.body.status).toBe('Initiated');
        const payment = await paymentRow(started.body.transactionId);
        expect(payment.providerPaymentId).toBeNull();

        // The provider never had it, so at its deadline the attempt ends and the customer can try again.
        const jobs = unreachable.app.get(PaymentJobs);
        await jobs.checkOpen(new Date(Date.now() + 60_000));
        expect((await paymentRow(payment.transactionId)).status).toBe('INITIATED');
        await jobs.checkOpen(new Date(payment.pendingUntil!.getTime() + 1));
        expect(await paymentRow(payment.transactionId)).toMatchObject({ status: 'EXPIRED', failureCode: 'EXPIRED' });
        const request = await testApp.http.get(`/api/v1/quote-requests/${quoteRequest.id}`).set(await asCustomer(customer));
        expect(request.body.progress).toBe('PAYMENT_FAILED');
      } finally {
        await unreachable.close();
      }
    });

    it('confirms an attempt whose callback never came', async () => {
      const { customer, quote, quoteRequest } = await buildPayableQuote(testApp.db);
      const started = await pay(customer, bodyFor(quote));
      await testApp.app.get(PaymentJobs).checkOpen(new Date(Date.now() + 60_000));
      expect((await paymentRow(started.body.transactionId)).status).toBe('CONFIRMED');
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });
  });

  describe('after-payment inspection creation', () => {
    const required = { inspectionRule: 'REQUIRED', inspectionTiming: 'AFTER_PAYMENT', inspectionMethod: 'PHYSICAL' } as const;
    const inspectionRows = (customerId: string) => testApp.db.select().from(inspections).where(eq(inspections.customerId, customerId));
    async function selectedInspectionQuote(rules = [required] as Array<Pick<typeof insurerProductVersions.$inferInsert, 'inspectionRule' | 'inspectionTiming' | 'inspectionMethod'>>) {
      const fixture = await productSelectionQuotes(rules.map(() => ({})), rules);
      await testApp.http.post(`/api/v1/quote-requests/${fixture.quoteRequest.id}/selection`)
        .set(await asCustomer(fixture.customer)).send({ insurerQuoteId: fixture.quote.id }).expect(200);
      return fixture;
    }

    it('opens exactly one for the chosen snapshot across concurrent callbacks, status checks and payment replays', async () => {
      const { customer, quote, quoteRequest, versions } = await selectedInspectionQuote();
      const key = randomUUID();
      const started = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }), key);
      expect(started.status).toBe(201);
      const payment = await paymentRow(started.body.transactionId);
      // The historical selected terms must survive later edits to the source version.
      await testApp.db.update(insurerProductVersions).set({ inspectionRule: 'NOT_REQUIRED', inspectionTiming: null, inspectionMethod: null })
        .where(eq(insurerProductVersions.id, versions[0].id));
      const event = providerEvent(payment.providerPaymentId!);
      const held = await lockedBy('SELECT id FROM payments WHERE id = $1 FOR UPDATE', [payment.id]);
      const receipts = await queueBehind(held, '%payments%for update', 2, [() => send(event), () => send({ ...event, eventId: randomUUID() })]);
      expect(receipts.map((receipt) => receipt.body.outcome).sort((a, b) => a.localeCompare(b))).toEqual(['ALREADY_APPLIED', 'POLICY_CREATED']);
      expect((await send(event)).body.replayed).toBe(true);
      await testApp.app.get(PaymentEventsService).applyStatus(payment.id, {
        status: 'CONFIRMED', amountMinor: payment.amountMinor, currency: payment.currency, reference: 'REPLAY', reason: null,
      });
      expect((await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }), key)).body.transactionId).toBe(payment.transactionId);
      const [policy] = await policiesFor([quoteRequest.id]);
      expect(await inspectionRows(customer.id)).toEqual([expect.objectContaining({
        policyNumber: policy.policyNumber, claimNumber: null, purpose: 'AFTER_PAYMENT', stage: 'AFTER_PAYMENT', insurerId: policy.insurerId,
      })]);
    });

    it.each([
      { inspectionRule: 'REQUIRED', inspectionTiming: 'BEFORE_PAYMENT', inspectionMethod: 'PHYSICAL' },
      { inspectionRule: 'OPTIONAL', inspectionTiming: 'AFTER_PAYMENT', inspectionMethod: 'PHYSICAL' },
      { inspectionRule: 'NOT_REQUIRED', inspectionTiming: null, inspectionMethod: null },
    ] as const)('does not open for %j or another selected product', async (rule) => {
      const { customer, quote } = await selectedInspectionQuote([rule, required]);
      expect((await payAndSettle(customer, bodyFor(quote))).body.policyNumber).toBeTruthy();
      expect(await inspectionRows(customer.id)).toEqual([]);
    });

    it.each(['mismatch', 'rejected'] as const)('does not open when the provider outcome is %s', async (outcome) => {
      const { customer, quote, quoteRequest } = await selectedInspectionQuote();
      const started = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(started.body.transactionId);
      const receipt = await send(providerEvent(payment.providerPaymentId!, outcome === 'mismatch'
        ? { amountMinor: payment.amountMinor - 1 } : { type: 'payment.failed' }));
      expect(receipt.body.outcome).toBe(outcome === 'mismatch' ? 'AMOUNT_MISMATCH' : 'FAILED');
      expect(await policiesFor([quoteRequest.id])).toEqual([]);
      expect(await inspectionRows(customer.id)).toEqual([]);
    });
  });

  describe('the no-claim discount code on the request', () => {
    const redeemedAtOf = async (code: string) => (await testApp.db.select().from(ncdCodes).where(eq(ncdCodes.code, code)))[0].redeemedAt;

    async function bindCode(
      code: string,
      quoteRequestId: string,
      customer: Customer,
      insurer: Awaited<ReturnType<typeof buildInsurer>>,
      sourceVehicleId?: string,
    ) {
      const [request] = await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.id, quoteRequestId));
      const vehicleId = sourceVehicleId ?? request.vehicleId;
      await testApp.db
        .update(vehicles)
        .set({ chassisNumber: `NCD-${code}` })
        .where(eq(vehicles.id, vehicleId));
      const source = await buildPurchasedPolicy(testApp.db, {
        customer,
        insurer,
      });
      const [policy] = await testApp.db
        .update(policies)
        .set({ vehicleId, issuedAt: new Date() })
        .where(eq(policies.policyNumber, source.policy.policyNumber))
        .returning();
      await testApp.db
        .update(ncdCodes)
        .set({ expiresAt: new Date(Date.now() + 86_400_000) })
        .where(eq(ncdCodes.code, code));
      await testApp.db
        .update(ncdApplications)
        .set({
          sourcePolicyNumber: policy.policyNumber,
          sourceVehicleId: vehicleId,
          declarationAcceptedAt: new Date(),
        })
        .where(eq(ncdApplications.approvedCodeId, code));
      const [codeRow] = await testApp.db.select().from(ncdCodes).where(eq(ncdCodes.code, code));
      await testApp.db.update(insurerQuotes).set({ ncdPercentage: codeRow.percentage }).where(eq(insurerQuotes.quoteRequestId, quoteRequestId));
      return policy;
    }

    it.each(['AMOUNT_MISMATCH', 'REFUND_REQUIRED'] as const)('holds a code during unresolved %s capture, including a concurrent start', async (kind) => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const request = { ncdCode: code.code };
      const one = await buildPayableQuote(testApp.db, { customer, insurer, request });
      const two = await buildPayableQuote(testApp.db, { customer, insurer, request, quote: { ncdPercentage: code.percentage } });
      await bindCode(code.code, one.quoteRequest.id, customer, insurer);
      await testApp.db.update(quoteRequests).set({ vehicleId: one.quoteRequest.vehicleId }).where(eq(quoteRequests.id, two.quoteRequest.id));
      const started = await pay(customer, bodyFor(one.quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(started.body.transactionId);
      if (kind === 'REFUND_REQUIRED') await testApp.db.update(insurerQuotes).set({ unpayableAt: new Date(), unpayableReason: 'INSURER_SUSPENDED' }).where(eq(insurerQuotes.id, one.quote.id));
      const event = providerEvent(payment.providerPaymentId!, kind === 'AMOUNT_MISMATCH' ? { amountMinor: payment.amountMinor - 1 } : {});
      const held = await lockedBy('SELECT code FROM ncd_codes WHERE code = $1 FOR UPDATE', [code.code]);
      const [capture, competing] = await queueBehind(held, '%ncd_codes%for update', 2, [() => send(event), () => pay(customer, bodyFor(two.quote))]);
      expect(capture.body.outcome).toBe(kind);
      expect(competing.body.code).toBe('NCD_CODE_UNAVAILABLE');
      expect((await pay(customer, bodyFor(two.quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      expect((await send(event)).body.replayed).toBe(true);
      expect((await send({ ...event, eventId: randomUUID() })).body.outcome).toBe('ALREADY_APPLIED');
      expect(await redeemedAtOf(code.code)).toBeNull();
      const [item] = await itemsFor(payment.id);
      await testApp.db.update(reconciliationItems).set({ status: 'IN_PROGRESS' }).where(eq(reconciliationItems.id, item.id));
      expect((await pay(customer, bodyFor(two.quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      await testApp.db.update(reconciliationItems).set({ status: 'RESOLVED', outcome: 'REFUNDED', resolvedAt: new Date(), resolutionNote: 'Provider refund verified.' })
        .where(eq(reconciliationItems.id, item.id));
      expect((await pay(customer, bodyFor(two.quote))).status).toBe(201);
    });

    it('confirms an already-reserved retry concurrently with an older terminal late capture', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const request = { ncdCode: code.code };
      const old = await buildPayableQuote(testApp.db, { customer, insurer, request });
      const retry = await buildPayableQuote(testApp.db, { customer, insurer, request, quote: { ncdPercentage: code.percentage } });
      await bindCode(code.code, old.quoteRequest.id, customer, insurer);
      await testApp.db.update(quoteRequests).set({ vehicleId: old.quoteRequest.vehicleId }).where(eq(quoteRequests.id, retry.quoteRequest.id));
      const first = await pay(customer, bodyFor(old.quote, { mobileNumber: WALLET.waits }));
      const previous = await paymentRow(first.body.transactionId);
      await testApp.db.update(payments).set({ status: 'EXPIRED' }).where(eq(payments.id, previous.id));
      const started = await pay(customer, bodyFor(retry.quote, { mobileNumber: WALLET.waits }));
      expect(started.status).toBe(201);
      const current = await paymentRow(started.body.transactionId);
      const late = providerEvent(previous.providerPaymentId!);
      const confirmed = providerEvent(current.providerPaymentId!);
      const held = await lockedBy('SELECT code FROM ncd_codes WHERE code = $1 FOR UPDATE', [code.code]);
      const receipts = await queueBehind(held, '%ncd_codes%for update', 2, [() => send(late), () => send(confirmed)]);
      expect(receipts.map((receipt) => receipt.body.outcome)).toEqual(['REFUND_REQUIRED', 'POLICY_CREATED']);
      expect(await policiesFor([old.quoteRequest.id, retry.quoteRequest.id])).toEqual([expect.objectContaining({ paymentId: current.id })]);
      expect(await itemsFor(previous.id)).toEqual([expect.objectContaining({ kind: 'REFUND_REQUIRED' })]);
      expect(await redeemedAtOf(code.code)).not.toBeNull();
      expect((await send(late)).body.replayed).toBe(true);
      expect((await send(confirmed)).body.replayed).toBe(true);
    });

    it('does not reserve or redeem a modern code for an ordinary same-issuer quote', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quote } = await buildPayableQuote(testApp.db, { customer, insurer, request: { ncdCode: code.code } });
      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      await testApp.db.update(insurerQuotes).set({ ncdPercentage: null }).where(eq(insurerQuotes.id, quote.id));
      const started = await pay(customer, bodyFor(quote));
      expect(started.status).toBe(201);
      expect((await paymentRow(started.body.transactionId)).reservedNcdCode).toBeNull();
      await statusOf(customer, started.body.transactionId);
      expect(await redeemedAtOf(code.code)).toBeNull();
      expect(await policiesFor([quote.quoteRequestId])).toHaveLength(1);
    });

    it('requires the marked discount to match the bound issuer and percentage', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quote } = await buildPayableQuote(testApp.db, { customer, insurer, request: { ncdCode: code.code } });
      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      await testApp.db.update(insurerQuotes).set({ ncdPercentage: code.percentage === 1 ? 2 : 1 }).where(eq(insurerQuotes.id, quote.id));
      expect((await pay(customer, bodyFor(quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      const other = await buildPayableQuote(testApp.db, { customer, request: { ncdCode: code.code }, quote: { ncdPercentage: code.percentage } });
      expect((await pay(customer, bodyFor(other.quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      await testApp.db.update(insurerQuotes).set({ ncdPercentage: code.percentage }).where(eq(insurerQuotes.id, quote.id));
      const started = await pay(customer, bodyFor(quote));
      await testApp.db.update(insurerQuotes).set({ ncdPercentage: code.percentage === 1 ? 2 : 1 }).where(eq(insurerQuotes.id, quote.id));
      await statusOf(customer, started.body.transactionId);
      expect(await policiesFor([quote.quoteRequestId])).toHaveLength(0);
      expect(await redeemedAtOf(code.code)).toBeNull();
    });

    it('holds the reservation past deadline and an inconclusive cancellation, releasing on definitive cancellation', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const request = { ncdCode: code.code };
      const one = await buildPayableQuote(testApp.db, { customer, insurer, request });
      const two = await buildPayableQuote(testApp.db, { customer, insurer, request, quote: { ncdPercentage: code.percentage } });
      await bindCode(code.code, one.quoteRequest.id, customer, insurer);
      await testApp.db.update(quoteRequests).set({ vehicleId: one.quoteRequest.vehicleId }).where(eq(quoteRequests.id, two.quoteRequest.id));
      const started = await pay(customer, bodyFor(one.quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(started.body.transactionId);
      await testApp.db.update(payments).set({ pendingUntil: new Date(0) }).where(eq(payments.id, payment.id));
      await testApp.app.get(PaymentEventsService).refresh(payment.id);
      expect((await paymentRow(payment.transactionId)).status).toBe('PENDING');
      expect((await pay(customer, bodyFor(two.quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      const pending = { status: 'PENDING' as const, amountMinor: null, currency: null, reference: null, reason: null };
      const cancel = vi.spyOn(standIn(), 'cancel').mockResolvedValueOnce(pending);
      try {
        expect((await testApp.http.post(`/api/v1/payments/${payment.transactionId}/cancel`).set(await asCustomer(customer))).body.status).toBe('Pending');
      } finally { cancel.mockRestore(); }
      expect((await pay(customer, bodyFor(two.quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      expect(await itemsFor(payment.id)).toEqual([expect.objectContaining({ kind: 'PENDING_TOO_LONG' })]);
      expect((await testApp.http.post(`/api/v1/payments/${payment.transactionId}/cancel`).set(await asCustomer(customer))).body.status).toBe('Cancelled');
      expect((await pay(customer, bodyFor(two.quote))).status).toBe(201);
    });

    it('fails closed for an absent code at start and confirmation', async () => {
      const { customer, quote, quoteRequest } = await buildPayableQuote(testApp.db);
      await testApp.db.update(quoteRequests).set({ ncdCode: 'ABSENT-NCD' }).where(eq(quoteRequests.id, quoteRequest.id));
      expect((await pay(customer, bodyFor(quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(0);
      await testApp.db.update(quoteRequests).set({ ncdCode: null }).where(eq(quoteRequests.id, quoteRequest.id));
      const started = await pay(customer, bodyFor(quote));
      await testApp.db.update(quoteRequests).set({ ncdCode: 'ABSENT-NCD' }).where(eq(quoteRequests.id, quoteRequest.id));
      await statusOf(customer, started.body.transactionId);
      expect(await policiesFor([quoteRequest.id])).toHaveLength(0);
      expect(await itemsFor((await paymentRow(started.body.transactionId)).id)).toEqual([expect.objectContaining({ kind: 'REFUND_REQUIRED' })]);
    });

    it('is redeemed when the payment to the insurer that issued it is confirmed, not before', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quote } = await buildPayableQuote(testApp.db, { customer, insurer, request: { ncdCode: code.code, ncdPercentage: code.percentage } });

      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      const started = await pay(customer, bodyFor(quote));
      expect(started.status).toBe(201);
      expect((await paymentRow(started.body.transactionId)).reservedNcdCode).toBe(code.code);
      expect(await redeemedAtOf(code.code)).toBeNull();
      const settled = await statusOf(customer, started.body.transactionId);
      expect((await redeemedAtOf(code.code))?.toISOString()).toBe(settled.body.confirmedAt);
    });

    it('is left unredeemed when the request pays another insurer', async () => {
      const customer = await buildCustomer(testApp.db);
      const issuer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: issuer.insurer.id });
      const { quote } = await buildPayableQuote(testApp.db, { customer, request: { ncdCode: code.code, ncdPercentage: code.percentage } });
      expect((await payAndSettle(customer, bodyFor(quote))).body.status).toBe('Confirmed');
      expect(await redeemedAtOf(code.code)).toBeNull();
    });

    it.each([
      ['unbound legacy code', 'self', {}],
      ['expired', 'self', { expiresAt: new Date(0) }],
      ['revoked', 'self', { revokedAt: new Date() }],
      ['already redeemed', 'self', { redeemedAt: new Date() }],
      ['issued to another customer', 'stranger', {}],
      ['issued without an application', 'none', {}],
    ] as const)('%s refuses the payment with 409 NCD_CODE_UNAVAILABLE, and nothing is stored', async (_case, holder, codeOverrides) => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code =
        holder === 'none'
          ? await buildNcdCode(testApp.db, { insurerId: insurer.insurer.id })
          : await buildApprovedNcdCode(
              testApp.db,
              { customerId: holder === 'self' ? customer.id : (await buildCustomer(testApp.db)).id, insurerId: insurer.insurer.id },
              codeOverrides,
            );
      const { quoteRequest, quote } = await buildPayableQuote(testApp.db, {
        customer,
        insurer,
        request: { ncdCode: code.code, ncdPercentage: code.percentage },
      });
      if (holder === 'self' && _case !== 'unbound legacy code') {
        await bindCode(code.code, quoteRequest.id, customer, insurer);
        await testApp.db.update(ncdCodes).set(codeOverrides).where(eq(ncdCodes.code, code.code));
      }
      const response = await pay(customer, bodyFor(quote));
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('NCD_CODE_UNAVAILABLE');
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('reserves a shared code once when starts wait on the same code lock', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const request = { ncdCode: code.code, ncdPercentage: code.percentage };
      const one = await buildPayableQuote(testApp.db, { customer, insurer, request, quote: { ncdPercentage: code.percentage } });
      const two = await buildPayableQuote(testApp.db, { customer, insurer, request, quote: { ncdPercentage: code.percentage } });
      await bindCode(code.code, one.quoteRequest.id, customer, insurer);
      await testApp.db.update(quoteRequests).set({ vehicleId: one.quoteRequest.vehicleId }).where(eq(quoteRequests.id, two.quoteRequest.id));
      const held = await lockedBy('SELECT code FROM ncd_codes WHERE code = $1 FOR UPDATE', [code.code]);
      const responses = await queueBehind(held, 'select % from "ncd_codes" % for update', 2, [
        () => pay(customer, bodyFor(one.quote)),
        () => pay(customer, bodyFor(two.quote)),
      ]);
      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('NCD_CODE_UNAVAILABLE');
      const winner = responses.find((response) => response.status === 201)!;
      await statusOf(customer, winner.body.transactionId);
      expect(await policiesFor([one.quoteRequest.id, two.quoteRequest.id])).toHaveLength(1);
    });

    it('refuses a second start racing confirmation without a lock cycle', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const request = { ncdCode: code.code };
      const one = await buildPayableQuote(testApp.db, { customer, insurer, request, quote: { ncdPercentage: code.percentage } });
      const two = await buildPayableQuote(testApp.db, { customer, insurer, request, quote: { ncdPercentage: code.percentage } });
      await bindCode(code.code, one.quoteRequest.id, customer, insurer);
      await testApp.db.update(quoteRequests).set({ vehicleId: one.quoteRequest.vehicleId }).where(eq(quoteRequests.id, two.quoteRequest.id));
      const started = await pay(customer, bodyFor(one.quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(started.body.transactionId);
      const held = await lockedBy('SELECT code FROM ncd_codes WHERE code = $1 FOR UPDATE', [code.code]);
      const [attempt, confirmation] = await queueBehind(held, 'select % from "ncd_codes" % for update', 2, [
        () => pay(customer, bodyFor(two.quote)),
        () => send(providerEvent(payment.providerPaymentId!)),
      ]);
      expect(attempt.status).toBe(409);
      expect(attempt.body.code).toBe('NCD_CODE_UNAVAILABLE');
      expect(confirmation.body.outcome).toBe('POLICY_CREATED');
      expect(await policiesFor([one.quoteRequest.id, two.quoteRequest.id])).toHaveLength(1);
    });

    it.each([
      { amountMinor: 100, currency: 'ZMW' },
      { amountMinor: 123456, currency: 'USD' },
      { amountMinor: 123456, currency: null },
    ])('does not make a mismatched late capture refundable: %j', async (capture) => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quote } = await buildPayableQuote(testApp.db, { customer, insurer, request: { ncdCode: code.code } });
      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      const started = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(started.body.transactionId);
      await testApp.db.update(payments).set({ status: 'EXPIRED' }).where(eq(payments.id, payment.id));
      const event = providerEvent(payment.providerPaymentId!, capture);
      expect((await send(event)).body.outcome).toBe('AMOUNT_MISMATCH');
      expect((await send(event)).body.replayed).toBe(true);
      expect((await paymentRow(payment.transactionId)).confirmedAt).toBeNull();
      expect((await statusOf(customer, payment.transactionId)).body.failure).toContain('unexpected payment details');
      expect(await itemsFor(payment.id)).toEqual([expect.objectContaining({ kind: 'AMOUNT_MISMATCH', amountMinor: capture.amountMinor })]);
      const maker = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'ADMIN' }));
      const proposed = await testApp.http.post(`/api/v1/admin/payments/${payment.transactionId}/refunds`).set(maker).send({
        amount: 1234.56, reasonCode: 'OTHER', reason: 'Attempt to refund an unverified late capture.',
      });
      expect(proposed.body.code).toBe('PAYMENT_NOT_REFUNDABLE');
      expect(await redeemedAtOf(code.code)).toBeNull();
    });

    it('blocks a late-capture refund once the provider reverses the money', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quote } = await buildPayableQuote(testApp.db, { customer, insurer, request: { ncdCode: code.code } });
      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      const started = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(started.body.transactionId);
      await testApp.db.update(payments).set({ status: 'CANCELLED' }).where(eq(payments.id, payment.id));
      expect((await send(providerEvent(payment.providerPaymentId!))).body.outcome).toBe('REFUND_REQUIRED');
      const maker = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'ADMIN' }));
      const checker = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'ADMIN' }));
      const proposed = await testApp.http.post(`/api/v1/admin/payments/${payment.transactionId}/refunds`).set(maker).send({
        amount: 1234.56, reasonCode: 'OTHER', reason: 'Refund a late capture before the reversal arrives.',
      });
      expect(proposed.status).toBe(201);
      expect((await send(providerEvent(payment.providerPaymentId!, { type: 'payment.reversed' }))).body.outcome).toBe('REVERSED');
      const approval = await testApp.http.post(`/api/v1/admin/approvals/${proposed.body.approvalRequestId}/approve`).set(checker);
      expect(approval.body.code).toBe('PAYMENT_NOT_REFUNDABLE');
      expect((await paymentRow(payment.transactionId)).status).toBe('REVERSED');
    });

    it.each(['FAILED', 'EXPIRED', 'CANCELLED'] as const)('releases a %s reservation for retry and holds a late callback for reconciliation', async (status) => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, {
        customerId: customer.id,
        insurerId: insurer.insurer.id,
      });
      const { quote } = await buildPayableQuote(testApp.db, {
        customer,
        insurer,
        request: { ncdCode: code.code },
      });
      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      const first = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(first.body.transactionId);
      await testApp.db.update(payments).set({ status }).where(eq(payments.id, payment.id));
      const retried = await pay(customer, bodyFor(quote));
      expect(retried.status).toBe(201);
      const late = await send(providerEvent(payment.providerPaymentId!));
      expect(late.body.outcome).toBe('REFUND_REQUIRED');
      expect((await paymentRow(payment.transactionId)).confirmedAt).not.toBeNull();
      expect((await statusOf(customer, payment.transactionId)).body.failure).toContain('late charge');
      expect(await redeemedAtOf(code.code)).toBeNull();
      await statusOf(customer, retried.body.transactionId);
      expect(await policiesFor([quote.quoteRequestId])).toHaveLength(1);
      const replay = await send(providerEvent(payment.providerPaymentId!));
      expect(replay.body.outcome).toBe('ALREADY_APPLIED');
      const maker = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'ADMIN' }));
      const checker = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'ADMIN' }));
      const [item] = await itemsFor(payment.id);
      const proposed = await testApp.http.post(`/api/v1/admin/payments/${payment.transactionId}/refunds`).set(maker).send({
        amount: 1234.56, reasonCode: 'OTHER', reason: 'Late capture after the original NCD attempt ended.', reconciliationItemId: item.id,
      });
      expect(proposed.status).toBe(201);
      expect((await testApp.http.post(`/api/v1/admin/approvals/${proposed.body.approvalRequestId}/approve`).set(checker)).status).toBe(201);
      await testApp.app.get(RefundsService).submit(proposed.body.id);
      await testApp.app.get(RefundsService).refresh(proposed.body.id);
      expect(await itemsFor(payment.id)).toEqual([expect.objectContaining({ status: 'RESOLVED', outcome: 'REFUNDED' })]);
    });

    it.each(['expiry', 'revocation'] as const)('honors %s after reservation and replays the callback ledger', async (change) => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, {
        customerId: customer.id,
        insurerId: insurer.insurer.id,
      });
      const { quote } = await buildPayableQuote(testApp.db, {
        customer,
        insurer,
        request: { ncdCode: code.code },
      });
      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      const started = await pay(customer, bodyFor(quote, { mobileNumber: WALLET.waits }));
      const payment = await paymentRow(started.body.transactionId);
      await testApp.db
        .update(ncdCodes)
        .set(change === 'expiry' ? { expiresAt: new Date(0) } : { revokedAt: new Date() })
        .where(eq(ncdCodes.code, code.code));
      const event = providerEvent(payment.providerPaymentId!);
      const first = await send(event);
      const replay = await send(event);
      expect(first.body.outcome).toBe(change === 'expiry' ? 'POLICY_CREATED' : 'REFUND_REQUIRED');
      expect(replay.body).toEqual({ ...first.body, replayed: true });
      expect((await statusOf(customer, payment.transactionId)).body.status).toBe('Confirmed');
      expect(await policiesFor([quote.quoteRequestId])).toHaveLength(change === 'expiry' ? 1 : 0);
      if (change === 'revocation') expect(await redeemedAtOf(code.code)).toBeNull();
    });

    it('keeps legacy null-reservation callbacks under the old owner and issuer rules', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, {
        customerId: customer.id,
        insurerId: insurer.insurer.id,
      });
      const { quote } = await buildPayableQuote(testApp.db, {
        customer,
        insurer,
      });
      const started = await pay(customer, bodyFor(quote));
      await testApp.db.update(quoteRequests).set({ ncdCode: code.code }).where(eq(quoteRequests.id, quote.quoteRequestId));
      expect((await statusOf(customer, started.body.transactionId)).body.policyNumber).toBeTruthy();
      expect(await redeemedAtOf(code.code)).not.toBeNull();
    });

    it.each([false, true])('accepts a matching independent vehicle snapshot with explicit renewal %s', async (renewal) => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quote, quoteRequest } = await buildPayableQuote(testApp.db, { customer, insurer, request: { ncdCode: code.code } });
      const source = await bindCode(code.code, quoteRequest.id, customer, insurer);
      const [vehicle] = await testApp.db.select().from(vehicles).where(eq(vehicles.id, source.vehicleId));
      const snapshot = await buildVehicle(testApp.db, {
        plateNumber: vehicle.plateNumber, chassisNumber: vehicle.chassisNumber, registrationCountry: vehicle.registrationCountry,
      });
      await testApp.db.update(quoteRequests).set({ vehicleId: snapshot.id, renewalOfPolicyNumber: renewal ? source.policyNumber : null })
        .where(eq(quoteRequests.id, quoteRequest.id));
      const key = randomUUID();
      const started = await pay(customer, bodyFor(quote), key);
      expect(started.status).toBe(201);
      expect((await pay(customer, bodyFor(quote), key)).body).toEqual(started.body);
      await statusOf(customer, started.body.transactionId);
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('does not honor expired NCD after the reservation price hold ends', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quote } = await buildPayableQuote(testApp.db, { customer, insurer, request: { ncdCode: code.code } });
      await bindCode(code.code, quote.quoteRequestId, customer, insurer);
      const started = await pay(customer, bodyFor(quote));
      const payment = await paymentRow(started.body.transactionId);
      await testApp.db.update(ncdCodes).set({ expiresAt: new Date(0) }).where(eq(ncdCodes.code, code.code));
      await testApp.db.update(payments).set({ pendingUntil: new Date(0) }).where(eq(payments.id, payment.id));
      const response = await send(providerEvent(payment.providerPaymentId!));
      expect(response.body.outcome).toBe('REFUND_REQUIRED');
      expect(await redeemedAtOf(code.code)).toBeNull();
      expect(await policiesFor([quote.quoteRequestId])).toHaveLength(0);
    });

    it('rejects a bound code for a different vehicle or an explicit different renewal', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, {
        customerId: customer.id,
        insurerId: insurer.insurer.id,
      });
      const { quote, quoteRequest } = await buildPayableQuote(testApp.db, {
        customer,
        insurer,
        request: { ncdCode: code.code },
      });
      const vehicle = await buildVehicle(testApp.db);
      await bindCode(code.code, quoteRequest.id, customer, insurer, vehicle.id);
      expect((await pay(customer, bodyFor(quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
      const { policy: otherPolicy } = await buildPurchasedPolicy(testApp.db, {
        customer,
        insurer,
      });
      await testApp.db
        .update(quoteRequests)
        .set({
          vehicleId: vehicle.id,
          renewalOfPolicyNumber: otherPolicy.policyNumber,
        })
        .where(eq(quoteRequests.id, quoteRequest.id));
      expect((await pay(customer, bodyFor(quote))).body.code).toBe('NCD_CODE_UNAVAILABLE');
    });
  });

  describe('concurrent payments', () => {
    it('for one request with different keys start one attempt; the other is told one is under way', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const responses = await Promise.all([pay(customer, bodyFor(quote)), pay(customer, bodyFor(quote))]);
      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('PAYMENT_IN_PROGRESS');
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('for one request, both held before the request lock, end in one attempt', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const held = await lockedBy('SELECT id FROM quote_requests WHERE id = $1 FOR UPDATE', [quoteRequest.id]);
      const responses = await queueBehind(held, LOCKING_THE_REQUEST, 2, [() => pay(customer, bodyFor(quote)), () => pay(customer, bodyFor(quote))]);
      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    describe('on a database whose transactions default to repeatable read', () => {
      let strict: TestApp;

      beforeAll(async () => {
        strict = await startRepeatableReadApp(4);
      });

      afterAll(async () => {
        await strict.close();
      });

      it('for one request, both held before the request lock, end in one attempt', async () => {
        const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
        const held = await lockedBy('SELECT id FROM quote_requests WHERE id = $1 FOR UPDATE', [quoteRequest.id]);
        const payStrictly = async () =>
          strict.http.post('/api/v1/payments').set(await signIn(strict.http, customer)).set('Idempotency-Key', randomUUID()).send(bodyFor(quote));
        const responses = await queueBehind(held, LOCKING_THE_REQUEST, 2, [payStrictly, payStrictly]);
        expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
        expect(responses.find((response) => response.status === 409)?.body.code).toBe('PAYMENT_IN_PROGRESS');
        expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
      });
    });

    it('with one key on one request start one attempt, and both answers are it', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      const held = await lockedBy('SELECT id FROM quote_requests WHERE id = $1 FOR UPDATE', [quoteRequest.id]);
      const [first, second] = await queueBehind(held, LOCKING_THE_REQUEST, 2, [
        () => pay(customer, bodyFor(quote), key),
        () => pay(customer, bodyFor(quote), key),
      ]);
      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.body.transactionId).toBe(first.body.transactionId);
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('uses the vehicle on the request when the payment is confirmed', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const replacementVehicle = await buildVehicle(testApp.db);
      const started = await pay(customer, bodyFor(quote));
      await testApp.db.update(quoteRequests).set({ vehicleId: replacementVehicle.id }).where(eq(quoteRequests.id, quoteRequest.id));
      await statusOf(customer, started.body.transactionId);
      expect((await policiesFor([quoteRequest.id])).map((policy) => policy.vehicleId)).toEqual([replacementVehicle.id]);
    });

    it('on an account being closed wait for the closure, then answer 403 and store nothing', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const held = await lockedBy(CLOSING_THE_ACCOUNT, [customer.id]);
      const [response] = await queueBehind(held, ANY_STATEMENT, 1, [() => pay(customer, bodyFor(quote))]);
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('This account has been closed.');
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });
  });

  it('audits each step of a payment with who did it, and never the wallet number', async () => {
    const { customer, quote } = await buildPayableQuote(testApp.db);
    const settled = await payAndSettle(customer, bodyFor(quote));
    const entries = await testApp.db.select().from(auditLogs).where(eq(auditLogs.entityId, settled.body.transactionId));
    expect(entries.map((entry) => [entry.action, entry.actorType])).toEqual(
      expect.arrayContaining([
        ['payment.initiated', 'CUSTOMER'],
        ['payment.status_changed', 'SYSTEM'],
      ]),
    );
    expect(JSON.stringify(entries)).not.toContain('970000001');
  });
});
