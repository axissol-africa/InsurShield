import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { MAX_KWACHA } from '../src/common/domain/money-limits.js';
import { ncdCodes, payments, policies } from '../src/db/schema.js';
import {
  buildCustomer,
  buildInsurer,
  buildNcdCode,
  buildPayment,
  buildStaffUser,
  type Row,
} from './builders.js';
import { buildApprovedNcdCode } from './builders/customer.js';
import { addQuote, buildPayableQuote } from './builders/payments.js';
import { holdLocks, openTestDatabase, queueBehind, startApp, type TestApp } from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';
import type { customers } from '../src/db/schema.js';

type Customer = Row<typeof customers>;

const RECEIPT_KEYS = [
  'amount',
  'confirmedAt',
  'currency',
  'method',
  'policyNumber',
  'quoteRequestId',
  'status',
  'transactionId',
];
const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const LOCKING_THE_REQUEST = 'select % from "quote_requests" % for update';
const REDEEMING_THE_CODE = 'update "ncd_codes" %';
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

  const asCustomer = async (customer: Customer) =>
    bearer(await customerToken({ keycloakId: customer.keycloakId, email: customer.email }));

  const pay = async (customer: Customer, body: Record<string, unknown>, key?: string) => {
    const call = testApp.http.post('/api/v1/payments').set(await asCustomer(customer));
    return (key === undefined ? call : call.set('Idempotency-Key', key)).send(body);
  };

  const paymentsFor = (quoteRequestIds: string[]) =>
    testApp.db.select().from(payments).where(inArray(payments.quoteRequestId, quoteRequestIds));
  const policiesFor = (quoteRequestIds: string[]) =>
    testApp.db.select().from(policies).where(inArray(policies.quoteRequestId, quoteRequestIds));
  const lockedBy = (statement: string, values: unknown[]) =>
    holdLocks(side.pool, (_db, client) => client.query(statement, values));

  describe('POST /payments', () => {
    it('confirms the payment, creates the policy awaiting the certificate and returns the receipt', async () => {
      const { customer, insurer, quoteRequest, quote } = await buildPayableQuote(testApp.db);

      const response = await pay(
        customer,
        { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Mobile money', mobileNumber: '+260971234567' },
        randomUUID(),
      );

      expect(response.status).toBe(201);
      expect(Object.keys(response.body).sort()).toEqual(RECEIPT_KEYS);
      expect(response.body).toMatchObject({
        status: 'Confirmed',
        method: 'Mobile money',
        amount: 1234.56,
        currency: 'ZMW',
        quoteRequestId: quoteRequest.id,
      });
      expect(response.body.transactionId).toMatch(/^TXN-[0-9A-Z]+$/);
      expect(response.body.policyNumber).toMatch(/^POL-[0-9A-Z]+$/);
      expect(response.body.confirmedAt).toMatch(ISO_MS);

      const [payment] = await paymentsFor([quoteRequest.id]);
      expect(payment).toMatchObject({
        transactionId: response.body.transactionId,
        status: 'CONFIRMED',
        method: 'MOBILE_MONEY',
        amountMinor: 123_456,
        currency: 'ZMW',
        providerReference: 'MM-4567',
        customerId: customer.id,
        insurerQuoteId: quote.id,
      });
      expect(payment.confirmedAt?.toISOString()).toBe(response.body.confirmedAt);

      const [policy] = await policiesFor([quoteRequest.id]);
      expect(policy).toMatchObject({
        policyNumber: response.body.policyNumber,
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
      expect(policy.policyEndDate).toEqual(quoteRequest.policyEndDate);
      expect(policy.receivedAt.toISOString()).toBe(response.body.confirmedAt);
    });

    it('records no provider reference for a card payment', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);

      const response = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
      });

      expect(response.status).toBe(201);
      expect(response.body.method).toBe('Card');
      const [payment] = await paymentsFor([quoteRequest.id]);
      expect(payment).toMatchObject({ method: 'CARD', providerReference: null });
    });

    describe('the amount', () => {
      it('is the premium plus the RTSA anniversary fee, in ngwee', async () => {
        const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db, { quote: { premiumMinor: 123_456 } });

        const response = await pay(customer, {
          quoteRequestId: quoteRequest.id,
          insurer: insurer.insurer.name,
          amount: 1234.66,
          method: 'Card',
          rtsaAnniversaryFee: 0.1,
        });

        expect(response.status).toBe(201);
        expect(response.body.amount).toBe(1234.66);
        const [payment] = await paymentsFor([quoteRequest.id]);
        expect(payment.amountMinor).toBe(123_466);
        const [policy] = await policiesFor([quoteRequest.id]);
        expect(policy.premiumMinor).toBe(123_466);
      });

      it.each([
        ['one ngwee under', 1234.55, undefined],
        ['one ngwee over', 1234.57, undefined],
        ['one ngwee off the premium plus the fee', 1234.65, 0.1],
      ])('is refused when %s, and nothing is stored', async (_case, amount, rtsaAnniversaryFee) => {
        const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);

        const response = await pay(customer, {
          quoteRequestId: quoteRequest.id,
          insurer: insurer.insurer.name,
          amount,
          method: 'Card',
          rtsaAnniversaryFee,
        });

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
          code: 'AMOUNT_MISMATCH',
          message: 'The amount does not match the quoted premium. Reload the quote and try again.',
          details: { expected: rtsaAnniversaryFee ? 1234.66 : 1234.56, received: amount },
        });
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
        expect(await policiesFor([quoteRequest.id])).toEqual([]);
      });

      it.each([
        ['an amount', { amount: MAX_KWACHA + 0.01 }],
        ['a fee', { amount: 1234.56, rtsaAnniversaryFee: MAX_KWACHA + 0.01 }],
      ])('above MAX_KWACHA is refused with 400 for %s, and nothing is stored', async (_case, amounts) => {
        const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);

        const response = await pay(customer, {
          quoteRequestId: quoteRequest.id,
          insurer: insurer.insurer.name,
          method: 'Card',
          ...amounts,
        });

        expect(response.status).toBe(400);
        expect(response.body.code).toBe('VALIDATION_FAILED');
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      });

      it('at MAX_KWACHA reaches the premium check rather than failing', async () => {
        const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);

        const response = await pay(customer, {
          quoteRequestId: quoteRequest.id,
          insurer: insurer.insurer.name,
          amount: MAX_KWACHA,
          method: 'Card',
        });

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('AMOUNT_MISMATCH');
      });
    });

    it('refuses an expired quote, and nothing is stored', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db, {
        quote: { validUntil: new Date('2026-01-15T09:00:00.000Z') },
      });

      const response = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
      });

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        code: 'QUOTE_EXPIRED',
        message: `${insurer.insurer.name}'s quote expired on 2026-01-15. Request fresh quotes to continue.`,
        details: null,
      });
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('refuses a second payment for a request that already has a policy', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      const first = await pay(customer, body, randomUUID());

      const second = await pay(customer, body, randomUUID());

      expect(second.status).toBe(409);
      expect(second.body).toEqual({
        code: 'ALREADY_PAID',
        message: `This request was already paid; policy ${first.body.policyNumber} exists.`,
        details: null,
      });
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('treats a request without a key like any other: the second attempt is already paid', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };

      expect((await pay(customer, body)).status).toBe(201);
      const second = await pay(customer, body);

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ALREADY_PAID');
    });

    it('reports a quote from an insurer that did not quote this request as not found', async () => {
      const { customer, quoteRequest } = await buildPayableQuote(testApp.db);
      const { insurer: other } = await buildInsurer(testApp.db);

      const response = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: other.name,
        amount: 1234.56,
        method: 'Card',
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        code: 'NOT_FOUND',
        message: `Quote from ${other.name} was not found.`,
        details: null,
      });
    });

    it('pays the quote of the insurer named, when the request has several', async () => {
      const { customer, quoteRequest } = await buildPayableQuote(testApp.db);
      const { insurer: second, quote } = await addQuote(testApp.db, quoteRequest.id, { premiumMinor: 99_999 });

      const response = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: second.insurer.name,
        amount: 999.99,
        method: 'Card',
      });

      expect(response.status).toBe(201);
      const [policy] = await policiesFor([quoteRequest.id]);
      expect(policy).toMatchObject({ insurerId: second.insurer.id, insurerQuoteId: quote.id, premiumMinor: 99_999 });
    });

    it.each([
      ['a too-short request id', { quoteRequestId: 'QR' }],
      ['an empty insurer', { insurer: '' }],
      ['a zero amount', { amount: 0 }],
      ['a negative amount', { amount: -1234.56 }],
      ['a string amount', { amount: '1234.56' }],
      ['an amount with three decimals', { amount: 1234.561 }],
      ['a negative fee', { amount: 1234.55, rtsaAnniversaryFee: -0.01 }],
      ['a fee with three decimals', { amount: 1234.56, rtsaAnniversaryFee: 0.001 }],
      ['an unknown method', { method: 'Cash' }],
    ])('refuses %s with 400, and nothing is stored', async (_case, change) => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);

      const response = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
        ...change,
      });

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('answers 404 for an unknown insurer on a request already paid', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      expect((await pay(customer, body)).status).toBe(201);

      const response = await pay(customer, { ...body, insurer: 'Nobody Assurance' });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        code: 'NOT_FOUND',
        message: 'Quote from Nobody Assurance was not found.',
        details: null,
      });
    });
  });

  describe('ownership', () => {
    it('answers 404 for another customer’s request, and stores nothing', async () => {
      const { insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const stranger = await buildCustomer(testApp.db);

      const response = await pay(stranger, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
      });

      expect(response.status).toBe(404);
      expect(response.body).toEqual({
        code: 'NOT_FOUND',
        message: `Quote request ${quoteRequest.id} was not found.`,
        details: null,
      });
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('answers 404 for another customer’s receipt', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const paid = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
      });
      const stranger = await buildCustomer(testApp.db);

      const response = await testApp.http
        .get(`/api/v1/payments/${paid.body.transactionId}`)
        .set(await asCustomer(stranger));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('refuses staff on both routes', async () => {
      const staff = await buildStaffUser(testApp.db);
      const auth = bearer(await staffToken(staff, ['admin']));

      const posted = await testApp.http
        .post('/api/v1/payments')
        .set(auth)
        .send({ quoteRequestId: 'QR-none', insurer: 'Any', amount: 1, method: 'Card' });
      const read = await testApp.http.get('/api/v1/payments/TXN-NONE').set(auth);

      expect(posted.status).toBe(403);
      expect(posted.body).toEqual({
        code: 'FORBIDDEN',
        message: 'Only a customer can pay for their own quote.',
        details: null,
      });
      expect(read.status).toBe(403);
    });
  });

  describe('GET /payments/:transactionId', () => {
    it('returns the receipt with exactly the receipt keys', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const paid = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Mobile money',
      });

      const response = await testApp.http
        .get(`/api/v1/payments/${paid.body.transactionId}`)
        .set(await asCustomer(customer));

      expect(response.status).toBe(200);
      expect(Object.keys(response.body).sort()).toEqual(RECEIPT_KEYS);
      expect(response.body).toEqual(paid.body);
    });

    it('sends K0.01, a null confirmation time and a null policy number as stored', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const payment = await buildPayment(
        testApp.db,
        { customerId: customer.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id },
        { amountMinor: 1, status: 'PENDING', confirmedAt: null, method: 'CARD' },
      );

      const response = await testApp.http
        .get(`/api/v1/payments/${payment.transactionId}`)
        .set(await asCustomer(customer));

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        transactionId: payment.transactionId,
        status: 'Pending',
        method: 'Card',
        amount: 0.01,
        currency: 'ZMW',
        confirmedAt: null,
        quoteRequestId: quoteRequest.id,
        policyNumber: null,
      });
    });

    it('answers 404 for an unknown transaction', async () => {
      const customer = await buildCustomer(testApp.db);

      const response = await testApp.http.get('/api/v1/payments/TXN-UNKNOWN').set(await asCustomer(customer));

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
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);

      const response = await pay(
        customer,
        { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' },
        key,
      );

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        message: 'The payment key must be 1 to 200 characters long.',
        details: null,
      });
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
    });

    it('of 200 characters is accepted and replays', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      const key = randomUUID().padEnd(200, 'k');

      const first = await pay(customer, body, key);
      const again = await pay(customer, body, key);

      expect(first.status).toBe(201);
      expect(again.body).toEqual(first.body);
    });
  });

  describe('a reused Idempotency-Key', () => {
    it('replays the original receipt for the same request, and charges nothing more', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      const first = await pay(customer, body, key);

      const again = await pay(customer, body, key);

      expect(again.status).toBe(201);
      expect(again.body).toEqual(first.body);
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });

    it.each([
      ['amount', { amount: 1234.57, rtsaAnniversaryFee: 0.01 }],
      ['method', { method: 'Mobile money' }],
    ])('with a different %s answers 409 IDEMPOTENCY_KEY_REUSED', async (_field, change) => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      await pay(customer, body, key);

      const response = await pay(customer, { ...body, ...change }, key);

      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'This payment key was already used for a different payment. Start the payment again.',
        details: null,
      });
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('with a different insurer on the same request answers 409 IDEMPOTENCY_KEY_REUSED', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const { insurer: second } = await addQuote(testApp.db, quoteRequest.id, { premiumMinor: 123_456 });
      const key = randomUUID();
      await pay(customer, { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' }, key);

      const response = await pay(
        customer,
        { quoteRequestId: quoteRequest.id, insurer: second.insurer.name, amount: 1234.56, method: 'Card' },
        key,
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('on a different request answers 409 IDEMPOTENCY_KEY_REUSED and leaves that request unpaid', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const { quoteRequest: other } = await buildPayableQuote(testApp.db, { customer, insurer });
      const key = randomUUID();
      await pay(customer, { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' }, key);

      const response = await pay(
        customer,
        { quoteRequestId: other.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' },
        key,
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await paymentsFor([other.id])).toEqual([]);
      expect(await policiesFor([other.id])).toEqual([]);
    });

    it('of another customer answers 403', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      await pay(customer, body, key);
      const stranger = await buildCustomer(testApp.db);

      const response = await pay(stranger, body, key);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
    });

    it('is not used up by a refused request', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };

      const refused = await pay(customer, { ...body, amount: 1 }, key);
      const accepted = await pay(customer, body, key);

      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('AMOUNT_MISMATCH');
      expect(accepted.status).toBe(201);
    });

    it.each([
      ['ALREADY_PAID', 'paid'],
      ['QUOTE_EXPIRED', 'expired'],
      ['NCD_CODE_UNAVAILABLE', 'redeemed code'],
    ] as const)('is not used up by a %s refusal', async (code, state) => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const ncd =
        state === 'redeemed code'
          ? await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id }, { redeemedAt: new Date() })
          : undefined;
      const { quoteRequest: refusedRequest } = await buildPayableQuote(testApp.db, {
        customer,
        insurer,
        request: ncd ? { ncdCode: ncd.code, ncdPercentage: ncd.percentage } : {},
        quote: state === 'expired' ? { validUntil: new Date('2026-01-15T09:00:00.000Z') } : {},
      });
      const { quoteRequest: payable } = await buildPayableQuote(testApp.db, { customer, insurer });
      const body = { insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      if (state === 'paid') expect((await pay(customer, { ...body, quoteRequestId: refusedRequest.id })).status).toBe(201);
      const key = randomUUID();

      const refused = await pay(customer, { ...body, quoteRequestId: refusedRequest.id }, key);
      const accepted = await pay(customer, { ...body, quoteRequestId: payable.id }, key);

      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe(code);
      expect(accepted.status).toBe(201);
      expect(accepted.body.quoteRequestId).toBe(payable.id);
    });
  });

  describe('the no-claim discount code on the request', () => {
    const redeemedAtOf = async (code: string) =>
      (await testApp.db.select().from(ncdCodes).where(eq(ncdCodes.code, code)))[0].redeemedAt;

    it('is redeemed when the request pays the insurer that issued it to this customer', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const { quoteRequest } = await buildPayableQuote(testApp.db, {
        customer,
        insurer,
        request: { ncdCode: code.code, ncdPercentage: code.percentage },
      });

      const response = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
      });

      expect(response.status).toBe(201);
      expect((await redeemedAtOf(code.code))?.toISOString()).toBe(response.body.confirmedAt);
    });

    it('is left unredeemed when the request pays another insurer, and the payment succeeds', async () => {
      const customer = await buildCustomer(testApp.db);
      const issuer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: issuer.insurer.id });
      const { insurer, quoteRequest } = await buildPayableQuote(testApp.db, {
        customer,
        request: { ncdCode: code.code, ncdPercentage: code.percentage },
      });

      const response = await pay(customer, {
        quoteRequestId: quoteRequest.id,
        insurer: insurer.insurer.name,
        amount: 1234.56,
        method: 'Card',
      });

      expect(response.status).toBe(201);
      expect(await redeemedAtOf(code.code)).toBeNull();
    });

    it.each([
      ['already redeemed', 'self', { redeemedAt: new Date() }],
      ['issued to another customer', 'stranger', {}],
      ['issued without an application', 'none', {}],
    ] as const)(
      '%s refuses the payment with 409 NCD_CODE_UNAVAILABLE, and nothing is stored',
      async (_case, holder, codeOverrides) => {
        const customer = await buildCustomer(testApp.db);
        const insurer = await buildInsurer(testApp.db);
        if (holder === 'stranger') await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
        const code =
          holder === 'none'
            ? await buildNcdCode(testApp.db, { insurerId: insurer.insurer.id })
            : await buildApprovedNcdCode(
                testApp.db,
                { customerId: holder === 'self' ? customer.id : (await buildCustomer(testApp.db)).id, insurerId: insurer.insurer.id },
                codeOverrides,
              );
        const { quoteRequest } = await buildPayableQuote(testApp.db, {
          customer,
          insurer,
          request: { ncdCode: code.code, ncdPercentage: code.percentage },
        });
        const key = randomUUID();

        const response = await pay(
          customer,
          { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' },
          key,
        );

        expect(response.status).toBe(409);
        expect(response.body).toEqual({
          code: 'NCD_CODE_UNAVAILABLE',
          message: 'The no-claim discount code on this request has already been used. Request fresh quotes to continue.',
          details: null,
        });
        expect(await paymentsFor([quoteRequest.id])).toEqual([]);
        expect(await policiesFor([quoteRequest.id])).toEqual([]);
        expect(await testApp.db.select().from(payments).where(eq(payments.idempotencyKey, key))).toEqual([]);
        if (holder !== 'self') expect(await redeemedAtOf(code.code)).toBeNull();
      },
    );
  });

  describe('concurrent payments', () => {
    it('for one request with different keys create one policy; the other is already paid', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };

      const responses = await Promise.all([pay(customer, body, randomUUID()), pay(customer, body, randomUUID())]);

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_PAID');
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('for one request, both held after reading it and before inserting, end in one policy and ALREADY_PAID', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      const held = await lockedBy('SELECT id FROM quote_requests WHERE id = $1 FOR UPDATE', [quoteRequest.id]);

      const responses = await queueBehind(held, LOCKING_THE_REQUEST, 2, [
        () => pay(customer, body, randomUUID()),
        () => pay(customer, body, randomUUID()),
      ]);

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_PAID');
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
    });

    it('with one key on two requests make one payment; the other is IDEMPOTENCY_KEY_REUSED', async () => {
      const { customer, insurer, quoteRequest: one } = await buildPayableQuote(testApp.db);
      const { quoteRequest: two } = await buildPayableQuote(testApp.db, { customer, insurer });
      const key = randomUUID();
      const held = await lockedBy('SELECT id FROM quote_requests WHERE id = ANY($1) FOR UPDATE', [[one.id, two.id]]);

      const responses = await queueBehind(
        held,
        LOCKING_THE_REQUEST,
        2,
        [one, two].map((request) => () =>
          pay(customer, { quoteRequestId: request.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' }, key),
        ),
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await testApp.db.select().from(payments).where(eq(payments.idempotencyKey, key))).toHaveLength(1);
      expect(await policiesFor([one.id, two.id])).toHaveLength(1);
    });

    it('with one key on one request make one payment, and both answers are its receipt', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const key = randomUUID();
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      const held = await lockedBy('SELECT id FROM quote_requests WHERE id = $1 FOR UPDATE', [quoteRequest.id]);

      const [first, second] = await queueBehind(held, LOCKING_THE_REQUEST, 2, [
        () => pay(customer, body, key),
        () => pay(customer, body, key),
      ]);

      expect([first.status, second.status]).toEqual([201, 201]);
      expect(second.body).toEqual(first.body);
      expect(await paymentsFor([quoteRequest.id])).toHaveLength(1);
      expect(await policiesFor([quoteRequest.id])).toHaveLength(1);
    });

    it('on two requests sharing one code redeem it once; the other rolls back with NCD_CODE_UNAVAILABLE', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.insurer.id });
      const request = { ncdCode: code.code, ncdPercentage: code.percentage };
      const { quoteRequest: one } = await buildPayableQuote(testApp.db, { customer, insurer, request });
      const { quoteRequest: two } = await buildPayableQuote(testApp.db, { customer, insurer, request });
      const held = await lockedBy('SELECT code FROM ncd_codes WHERE code = $1 FOR UPDATE', [code.code]);

      const responses = await queueBehind(
        held,
        REDEEMING_THE_CODE,
        2,
        [one, two].map((quoteRequest) => () =>
          pay(customer, { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' }),
        ),
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      const refused = responses.findIndex((response) => response.status === 409);
      expect(responses[refused].body.code).toBe('NCD_CODE_UNAVAILABLE');
      const refusedRequest = [one, two][refused].id;
      expect(await policiesFor([refusedRequest])).toEqual([]);
      expect(await paymentsFor([refusedRequest])).toEqual([]);
      expect(await policiesFor([one.id, two.id])).toHaveLength(1);
    });

    it('on an account being closed wait for the closure, then answer 403 and store nothing', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      const body = { quoteRequestId: quoteRequest.id, insurer: insurer.insurer.name, amount: 1234.56, method: 'Card' };
      const held = await lockedBy(CLOSING_THE_ACCOUNT, [customer.id]);

      const [response] = await queueBehind(held, ANY_STATEMENT, 1, [() => pay(customer, body, randomUUID())]);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(response.body.message).toBe('This account has been closed.');
      expect(await paymentsFor([quoteRequest.id])).toEqual([]);
      expect(await policiesFor([quoteRequest.id])).toEqual([]);
    });
  });
});
