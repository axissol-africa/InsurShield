import { and, eq } from 'drizzle-orm';
import {
  auditLogs, authSessions, contactPreferences, insurerProducts, insurerProductVersions, marketingConsents, notifications, payments,
  quoteRequestProductRequirementAnswers, quoteRequestProductVersions, serviceRequests, serviceRequestUpdates,
} from '../src/db/schema.js';
import { buildClaim, buildCustomer, buildDocument, buildInspection, buildPurchasedPolicy, buildStaffUser, unique } from './builders.js';
import { buildConsent } from './builders/admin.js';
import { buildNcdApplication } from './builders/customer.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const EXPORT = '/api/v1/account/export';

describe('customer portfolio data export', () => {
  let app: TestApp;
  beforeAll(async () => { app = await startApp(); });
  afterAll(async () => { await app?.close(); });

  it('exports the owner’s records and only public updates, with protected document links', async () => {
    const { customer, insurer, policy, payment, quoteRequest, quote, quotation } = await buildPurchasedPolicy(app.db);
    const other = await buildCustomer(app.db, { fullName: 'Unrelated account' });
    const competingPurchase = await buildPurchasedPolicy(app.db, { customer: other, insurer });
    const competingClaim = await buildClaim(app.db, { customerId: other.id, insurerId: insurer.insurer.id });
    const competingInspection = await buildInspection(app.db, { customerId: other.id, insurerId: insurer.insurer.id });
    const otherDocument = await buildDocument(app.db, { customerId: other.id }, { fileName: 'separate-account.pdf' });
    const internal = await buildDocument(app.db, { staffId: insurer.staff.id }, { kind: 'SERVICE_REQUEST_DOCUMENT', fileName: 'internal-insurer.pdf' });
    const unscanned = await buildDocument(app.db, { customerId: customer.id }, { fileName: 'unscanned.pdf', scanStatus: 'UNSCANNED', scannedAt: null });
    await buildConsent(app.db, customer.id, { ipAddress: '192.0.2.50' });
    await app.db.insert(marketingConsents).values({ customerId: customer.id, granted: false, noticeVersion: 'marketing-1', purpose: 'Promotional messages' });
    await app.db.insert(contactPreferences).values({ customerId: customer.id, channel: 'EMAIL', category: 'POLICY', enabled: false });
    await app.db.update(payments).set({ payerMsisdnMasked: '097****123', checkoutUrl: 'https://checkout.invalid/private-token' }).where(eq(payments.id, payment.id));
    const parties = { customerId: customer.id, insurerId: insurer.insurer.id };
    const claim = await buildClaim(app.db, { ...parties, policyNumber: policy.policyNumber });
    const ncd = await buildNcdApplication(app.db, parties);
    const inspection = await buildInspection(app.db, parties);
    const [product] = await app.db.insert(insurerProducts).values({
      insurerId: insurer.insurer.id, code: unique('EXPORT'), coverType: 'COMPREHENSIVE',
    }).returning();
    const [version] = await app.db.insert(insurerProductVersions).values({
      productId: product.id, versionNumber: 1, name: 'Annual cover', coverType: 'COMPREHENSIVE',
      coverGuide: {}, inspectionRule: 'NOT_REQUIRED', rateBps: 525, effectiveFrom: new Date(), createdByStaffId: insurer.staff.id,
    }).returning();
    await app.db.insert(quoteRequestProductVersions).values({
      quoteRequestId: quoteRequest.id, productVersionId: version.id, insurerId: insurer.insurer.id,
      productCode: product.code, productVersionNumber: 1, productName: version.name, coverType: version.coverType,
      coverGuide: {}, inspectionRule: 'NOT_REQUIRED', assignedStaffId: insurer.staff.id, assignedAt: new Date(),
    });
    await app.db.insert(quoteRequestProductRequirementAnswers).values({
      quoteRequestId: quoteRequest.id, productVersionId: version.id, requirementKey: 'parking', value: 'Garage',
    });

    const reference = unique('SR');
    await app.db.insert(serviceRequests).values({ ...parties, reference, policyNumber: policy.policyNumber, type: 'ASSISTANCE', reason: 'Please explain my excess.' });
    await app.db.insert(serviceRequestUpdates).values([
      { reference, authorKind: 'INSURER', authorId: insurer.staff.id, message: 'We will explain your excess.', visibleToCustomer: true },
      { reference, authorKind: 'INSURER', authorId: insurer.staff.id, message: 'Internal underwriting note', visibleToCustomer: false, documentIds: [internal.id] },
    ]);
    await app.db.insert(notifications).values({
      customerId: customer.id, templateKey: 'service_request.update', templateVersion: 1, channel: 'IN_APP', category: 'POLICY',
      mandatory: true, entityType: 'SERVICE_REQUEST', entityId: reference, subject: 'Request update', body: 'Your request was updated.',
    });
    const competingReference = unique('SR');
    await app.db.insert(serviceRequests).values({
      customerId: other.id, insurerId: insurer.insurer.id, reference: competingReference,
      policyNumber: competingPurchase.policy.policyNumber, type: 'ASSISTANCE', reason: 'Different account request',
    });
    await app.db.insert(serviceRequestUpdates).values({
      reference: competingReference, authorKind: 'CUSTOMER', authorId: other.id, message: 'Separate customer response',
      visibleToCustomer: true, documentIds: [otherDocument.id],
    });
    await app.db.insert(notifications).values({
      customerId: other.id, templateKey: 'service_request.update', templateVersion: 1, channel: 'IN_APP', category: 'POLICY',
      mandatory: true, entityType: 'SERVICE_REQUEST', entityId: competingReference, subject: 'Other customer', body: 'Separate customer alert',
    });
    const session = await signIn(app.http, customer);
    const response = await app.http.get(EXPORT).set(session).expect(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['content-disposition']).toMatch(/attachment.*insurshield-account\.json/);
    expect(response.body).toMatchObject({
      schemaVersion: 1,
      profile: { id: customer.id, email: customer.email },
      consents: [expect.objectContaining({ privacyVersion: 'privacy-1' })],
      marketingConsent: [expect.objectContaining({ granted: false })],
      contactPreferences: [expect.objectContaining({ category: 'POLICY', enabled: false })],
      vehicles: [expect.objectContaining({ id: quoteRequest.vehicleId })],
      quoteRequests: [expect.objectContaining({
        id: quoteRequest.id, answers: [expect.objectContaining({ value: 'Garage' })],
        selectedProducts: [expect.objectContaining({ productVersionId: version.id })],
        quotations: [expect.objectContaining({ id: quote.id, documentId: quotation.id })],
      })],
      payments: [expect.objectContaining({ transactionId: payment.transactionId, payerMasked: '097****123' })],
      policies: [expect.objectContaining({ policyNumber: policy.policyNumber })],
      claims: [expect.objectContaining({ claimNumber: claim.claimNumber })],
      ncdApplications: [expect.objectContaining({ applicationNumber: ncd.applicationNumber })],
      inspections: [expect.objectContaining({ id: inspection.id })],
      notifications: [expect.objectContaining({ entityId: reference })],
      serviceRequests: [expect.objectContaining({ reference, updates: [expect.objectContaining({ message: 'We will explain your excess.' })] })],
      documents: expect.arrayContaining([
        expect.objectContaining({ id: quotation.id, downloadUrl: expect.any(String) }),
        expect.objectContaining({ id: unscanned.id, available: false, downloadUrl: null }),
      ]),
    });
    const wire = JSON.stringify(response.body);
    for (const secret of [
      other.email, otherDocument.id, competingPurchase.quotation.id, competingPurchase.quoteRequest.vehicleId,
      competingPurchase.quoteRequest.id, competingPurchase.policy.policyNumber, competingPurchase.payment.transactionId,
      competingClaim.claimNumber, competingInspection.id, competingReference, 'Separate customer alert', 'Separate customer response',
      internal.id, insurer.staff.id, 'Internal underwriting note', '192.0.2.50', 'private-token',
    ]) {
      expect(wire).not.toContain(secret);
    }
    const path = new URL(response.body.documents.find((record: { id: string }) => record.id === quotation.id).downloadUrl).pathname;
    await app.http.get(path).expect(401);
    await app.http.get(path).set(session).expect(302);
    await app.http.get(path).set(await signIn(app.http, other)).expect(404);
    const list = await app.http.get('/api/v1/account/documents').set(session).expect(200);
    expect(list.body.map((record: { id: string }) => record.id).sort()).toEqual([quotation.id, unscanned.id].sort());
    const exported = await app.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, customer.id), eq(auditLogs.action, 'customer.data_exported')));
    expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({ actorId: customer.id, after: { documents: 2, quoteRequests: 1, policies: 1 } });
  });

  it('requires a verified customer and a recent sign-in before creating an export', async () => {
    await app.http.get(EXPORT).expect(401);
    const admin = await buildStaffUser(app.db, { role: 'ADMIN' });
    await app.http.get(EXPORT).set(await signIn(app.http, admin)).expect(403);

    const customer = await buildCustomer(app.db);
    const stale = await signIn(app.http, customer);
    if (!customer.userId) throw new Error('Expected the fixture to have an identity');
    await app.db.update(authSessions).set({ createdAt: new Date(Date.now() - 11 * 60_000) }).where(eq(authSessions.userId, customer.userId));
    const refused = await app.http.get(EXPORT).set(stale).expect(403);
    expect(refused.body.code).toBe('REAUTHENTICATION_REQUIRED');
    const unverified = await buildCustomer(app.db, { emailVerifiedAt: null });
    const unverifiedExport = await app.http.get(EXPORT).set(await signIn(app.http, unverified)).expect(403);
    expect(unverifiedExport.body.code).toBe('EMAIL_NOT_VERIFIED');
    await app.http.get(EXPORT).set(await signIn(app.http, customer)).expect(200);
  });

  it('limits repeated exports without auditing a download that was refused', async () => {
    const limited = await startApp({ env: { API_RATE_LIMIT: 'on' } });
    try {
      const customer = await buildCustomer(limited.db);
      const session = await signIn(limited.http, customer);
      for (let count = 0; count < 3; count++) await limited.http.get(EXPORT).set(session).expect(200);
      const refused = await limited.http.get(EXPORT).set(session).expect(429);
      expect(refused.body.code).toBe('RATE_LIMITED');
      const events = await limited.db.select({ id: auditLogs.id }).from(auditLogs)
        .where(and(eq(auditLogs.action, 'customer.data_exported'), eq(auditLogs.entityId, customer.id)));
      expect(events).toHaveLength(3);
    } finally {
      await limited.close();
    }
  });
});
