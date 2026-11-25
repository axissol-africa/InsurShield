import { and, eq, inArray } from 'drizzle-orm';
import { DataRetention } from '../src/privacy/data-retention.js';
import { auditLogs, authUsers, customers, documents, paymentRefunds, policies, quoteRequestProductVersions, quoteRequestDrafts, quoteRequests } from '../src/db/schema.js';
import { buildCustomer, buildDocument, buildInsurer, buildInsurerQuote, buildPayment, buildPurchasedPolicy, buildQuoteRequest, type BuiltInsurer } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const DAY_MS = 86_400_000;

describe('data lifecycle', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  type Party = { email: string };
  const as = async (party: Party) => {
    const session = await signIn(testApp.http, party);
    return {
      get: (path: string) => testApp.http.get(`/api/v1/${path}`).set(session),
      post: (path: string, body: Record<string, unknown> = {}) => testApp.http.post(`/api/v1/${path}`).set(session).send(body),
      close: () => testApp.http.delete('/api/v1/account').set(session),
    };
  };

  /** A policy in force for a year from 30 days ago. */
  async function activePolicy(insurer?: BuiltInsurer) {
    const bought = await buildPurchasedPolicy(testApp.db, insurer ? { insurer } : {});
    const start = new Date(Date.now() - 30 * DAY_MS);
    await testApp.db
      .update(policies)
      .set({ status: 'ACTIVE', issuedAt: start, policyStartDate: start, policyEndDate: new Date(start.getTime() + 365 * DAY_MS) })
      .where(eq(policies.policyNumber, bought.policy.policyNumber));
    return bought;
  }

  describe('downloading my data', () => {
    it('holds every category of the customer\'s own records, and nothing of anyone else\'s or internal', async () => {
      const mine = await activePolicy();
      const someoneElse = await activePolicy();
      const customer = await as(mine.customer);
      const insurer = await as(mine.insurer.staff);
      const asked = await customer.post('service-requests', {
        policyNumber: mine.policy.policyNumber,
        type: 'ASSISTANCE',
        reason: 'Please send me the schedule of cover again.',
      });
      await insurer.post(`insurer/service-requests/${asked.body.reference}/updates`, { message: 'Internal: the schedule printer is down.', visibleToCustomer: false });
      await insurer.post(`insurer/service-requests/${asked.body.reference}/updates`, { message: 'We are sending it today.', visibleToCustomer: true });

      const exported = await customer.get('account/export');

      expect(exported.status).toBe(200);
      expect(exported.headers['cache-control']).toBe('no-store');
      expect(Object.keys(exported.body).sort()).toEqual(
        [
          'about',
          'claims',
          'consents',
          'contactPreferences',
          'documents',
          'exportedAt',
          'inspections',
          'marketingConsents',
          'ncdApplications',
          'notifications',
          'payments',
          'policies',
          'profile',
          'quoteRequests',
          'serviceRequests',
          'vehicles',
        ].sort(),
      );
      expect(exported.body.profile).toMatchObject({ email: mine.customer.email, fullName: mine.customer.fullName });
      expect(exported.body.policies.map((policy: { policyNumber: string }) => policy.policyNumber)).toEqual([mine.policy.policyNumber]);
      expect(exported.body.payments).toEqual([expect.objectContaining({ transactionId: mine.payment.transactionId })]);
      expect(exported.body.vehicles).toHaveLength(1);
      expect(exported.body.serviceRequests).toEqual([expect.objectContaining({ reference: asked.body.reference })]);
      expect(exported.body.notifications.length).toBeGreaterThan(0);

      const text = JSON.stringify(exported.body);
      expect(text).toContain('We are sending it today.');
      expect(text).not.toContain('schedule printer');
      expect(text).not.toContain(someoneElse.policy.policyNumber);
      expect(text).not.toContain(someoneElse.customer.email);
      expect(text).not.toContain('providerPaymentId');
      expect(text).not.toContain(mine.insurer.staff.email);

      const [audited] = await testApp.db
        .select({ after: auditLogs.after })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'customer.data_exported'), eq(auditLogs.entityId, mine.customer.id)));
      expect(audited.after).toMatchObject({ policies: 1, serviceRequests: 1 });
      expect(JSON.stringify(audited.after)).not.toContain(mine.customer.email);
    });

    it('is for customers only', async () => {
      const { insurer } = await activePolicy();
      expect((await (await as(insurer.staff)).get('account/export')).status).toBe(403);
    });
  });

  describe('closing an account', () => {
    it('is refused while a service request, a payment or a refund is in progress', async () => {
      const asking = await activePolicy();
      const customer = await as(asking.customer);
      const asked = await customer.post('service-requests', { policyNumber: asking.policy.policyNumber, type: 'ASSISTANCE', reason: 'Please send me the schedule of cover again.' });
      // The cover itself has ended, so only the open request stands in the way.
      await testApp.db.update(policies).set({ policyEndDate: new Date(Date.now() - DAY_MS) }).where(eq(policies.policyNumber, asking.policy.policyNumber));
      expect((await customer.close()).body.code).toBe('SERVICE_REQUEST_OPEN');
      await customer.post(`service-requests/${asked.body.reference}/withdraw`);
      expect((await customer.close()).status).toBe(200);

      const paying = await buildCustomer(testApp.db);
      const payingInsurer = await buildInsurer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: paying.id, insurerIds: [] });
      const { quote } = await buildInsurerQuote(testApp.db, { quoteRequestId: quoteRequest.id, insurerId: payingInsurer.insurer.id, staffId: payingInsurer.staff.id });
      await buildPayment(testApp.db, { customerId: paying.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id }, { status: 'PENDING' });
      expect((await (await as(paying)).close()).body.code).toBe('PAYMENT_IN_PROGRESS');

      const refunded = await activePolicy();
      await testApp.db.update(policies).set({ status: 'CANCELLED' }).where(eq(policies.policyNumber, refunded.policy.policyNumber));
      await testApp.db.insert(paymentRefunds).values({
        paymentId: refunded.payment.id,
        amountMinor: 1_000,
        reasonCode: 'CUSTOMER_REQUEST',
        reason: 'Cancelled on the customer request.',
        status: 'APPROVED',
        provider: 'STAND_IN',
        proposedByStaffId: refunded.insurer.staff.id,
      });
      expect((await (await as(refunded.customer)).close()).body.code).toBe('REFUND_IN_PROGRESS');
    });

    it('ends open requests for the insurers, cancels their products and deletes drafts', async () => {
      const customer = await buildCustomer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] });
      await testApp.db.insert(quoteRequestDrafts).values({ customerId: customer.id, expiresAt: new Date(Date.now() + DAY_MS) });

      expect((await (await as(customer)).close()).status).toBe(200);

      const [request] = await testApp.db.select({ status: quoteRequests.status, expiresAt: quoteRequests.expiresAt }).from(quoteRequests).where(eq(quoteRequests.id, quoteRequest.id));
      expect(request.status).toBe('EXPIRED');
      expect(request.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
      const open = await testApp.db
        .select({ status: quoteRequestProductVersions.status })
        .from(quoteRequestProductVersions)
        .where(and(eq(quoteRequestProductVersions.quoteRequestId, quoteRequest.id), inArray(quoteRequestProductVersions.status, ['SUBMITTED', 'QUOTED'])));
      expect(open).toEqual([]);
      expect(await testApp.db.select().from(quoteRequestDrafts).where(eq(quoteRequestDrafts.customerId, customer.id))).toEqual([]);
    });
  });

  describe('retention', () => {
    const retention = () => testApp.app.get(DataRetention);
    const longAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
    const documentRow = async (id: string) => (await testApp.db.select().from(documents).where(eq(documents.id, id)))[0];

    it('deletes the file of a document past its period, keeps the row, and runs only once', async () => {
      const customer = await buildCustomer(testApp.db);
      const old = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK', uploadedAt: longAgo(3_000) });
      const recent = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK', uploadedAt: longAgo(30) });

      await retention().run();
      const deletedAt = (await documentRow(old.id)).deletedAt;
      expect(deletedAt).toBeInstanceOf(Date);
      expect((await documentRow(recent.id)).deletedAt).toBeNull();
      expect(await documentRow(old.id)).toMatchObject({ kind: 'WHITE_BOOK', retentionClass: old.retentionClass });

      await retention().run();
      expect((await documentRow(old.id)).deletedAt?.toISOString()).toBe(deletedAt?.toISOString());

      const audited = await testApp.db.select({ after: auditLogs.after }).from(auditLogs).where(eq(auditLogs.action, 'data_retention.applied'));
      expect(audited.length).toBeGreaterThan(0);
      expect(JSON.stringify(audited)).not.toContain(old.storageKey);
    });

    it('keeps what a live policy or an open service request still needs', async () => {
      const held = await activePolicy();
      const certificate = await buildDocument(testApp.db, { staffId: held.insurer.staff.id }, { kind: 'CERTIFICATE', uploadedAt: longAgo(3_000) });
      await testApp.db.update(policies).set({ certificateDocumentId: certificate.id }).where(eq(policies.policyNumber, held.policy.policyNumber));

      const asking = await activePolicy();
      const evidence = await buildDocument(testApp.db, { customerId: asking.customer.id }, { kind: 'SERVICE_REQUEST_DOCUMENT', uploadedAt: longAgo(3_000) });
      const sent = await (await as(asking.customer)).post('service-requests', {
        policyNumber: asking.policy.policyNumber,
        type: 'DETAILS_CHANGE',
        reason: 'The vehicle colour should be blue, not white.',
        documentIds: [evidence.id],
      });
      expect(sent.status).toBe(201);

      await retention().run();
      expect((await documentRow(certificate.id)).deletedAt).toBeNull();
      expect((await documentRow(evidence.id)).deletedAt).toBeNull();

      // Once the cover has ended, its papers are no longer held.
      await testApp.db.update(policies).set({ policyEndDate: longAgo(1) }).where(eq(policies.policyNumber, held.policy.policyNumber));
      await retention().run();
      expect((await documentRow(certificate.id)).deletedAt).toBeInstanceOf(Date);
    });

    it('gives a deleted document no link, and refuses to download it', async () => {
      const customer = await buildCustomer(testApp.db);
      const old = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK', uploadedAt: longAgo(3_000) });
      await retention().run();
      const answer = await (await as(customer)).get(`documents/${old.id}`);
      expect(answer.body.code).toBe('DOCUMENT_NOT_AVAILABLE');
    });

    it('replaces the identity of an account closed long ago and removes its sign-in, keeping its records', async () => {
      const closedLongAgo = await activePolicy();
      await testApp.db.update(customers).set({ deletedAt: longAgo(3_000) }).where(eq(customers.id, closedLongAgo.customer.id));
      const closedRecently = await buildCustomer(testApp.db, { deletedAt: longAgo(10) });
      const [before] = await testApp.db.select({ userId: customers.userId }).from(customers).where(eq(customers.id, closedLongAgo.customer.id));

      await retention().run();

      const [after] = await testApp.db.select().from(customers).where(eq(customers.id, closedLongAgo.customer.id));
      expect(after).toMatchObject({ fullName: 'Closed account', userId: null, anonymisedAt: expect.any(Date) });
      expect(after.email).not.toBe(closedLongAgo.customer.email);
      expect(after.phone).not.toBe(closedLongAgo.customer.phone);
      expect(await testApp.db.select().from(authUsers).where(eq(authUsers.id, before.userId!))).toEqual([]);
      const [policy] = await testApp.db.select({ customerId: policies.customerId }).from(policies).where(eq(policies.policyNumber, closedLongAgo.policy.policyNumber));
      expect(policy.customerId).toBe(closedLongAgo.customer.id);
      const [recent] = await testApp.db.select().from(customers).where(eq(customers.id, closedRecently.id));
      expect(recent.anonymisedAt).toBeNull();
    });
  });
});
