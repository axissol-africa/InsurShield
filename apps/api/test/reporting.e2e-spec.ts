import { and, eq } from 'drizzle-orm';
import { auditLogs, insurerProducts, insurerProductVersions, insurerQuotes, inspectionRequestProducts, paymentRefunds, payments, policies, quoteRequestProductVersions, quoteRequests, reconciliationItems, settlements } from '../src/db/schema.js';
import type { Report } from '../src/reporting/domain/report.js';
import { buildClaim, buildCustomer, buildInspection, buildInsurer, buildPurchasedPolicy, buildQuoteRequest, buildStaffUser, unique, type BuiltInsurer } from './builders.js';
import { buildNcdApplication } from './builders/customer.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

type Session = Awaited<ReturnType<typeof signIn>>;
const period = { from: '2026-09-01', to: '2026-09-30' };
const value = (report: Report, key: string) => report.metrics.find((metric) => metric.key === key)?.value;

describe('aggregate operational and financial reporting', () => {
  let app: TestApp;
  let insurer: BuiltInsurer;
  let other: BuiltInsurer;
  let manager: Session;
  let finance: Session;
  let quoteOfficer: Session;
  let admin: Session;
  let customer: Session;

  beforeAll(async () => {
    app = await startApp();
    insurer = await buildInsurer(app.db, { insurer: { name: '=PRIVATE_INSURER()' }, staff: { role: 'INSURER_ADMIN' } });
    other = await buildInsurer(app.db, { staff: { role: 'INSURER_ADMIN' } });
    manager = await signIn(app.http, insurer.staff);
    finance = await signIn(app.http, await buildStaffUser(app.db, { role: 'FINANCE', insurerId: insurer.insurer.id }));
    quoteOfficer = await signIn(app.http, await buildStaffUser(app.db, { role: 'QUOTE_OFFICER', insurerId: insurer.insurer.id }));
    admin = await signIn(app.http, await buildStaffUser(app.db, { role: 'ADMIN' }));
    customer = await signIn(app.http, await buildCustomer(app.db));

    for (const [owner, when, amount] of [
      [insurer, '2026-08-31T21:59:59.999Z', 900_000],
      [insurer, '2026-08-31T22:00:00.000Z', 100_000],
      [insurer, '2026-09-30T21:59:59.999Z', 200_000],
      [insurer, '2026-09-30T22:00:00.000Z', 800_000],
      [other, '2026-09-15T10:00:00.000Z', 700_000],
    ] as const) {
      const bought = await buildPurchasedPolicy(app.db, { insurer: owner });
      const at = new Date(when);
      await app.db.update(quoteRequests).set({ submittedAt: at }).where(eq(quoteRequests.id, bought.quoteRequest.id));
      await app.db.update(insurerQuotes).set({ sentAt: at }).where(eq(insurerQuotes.id, bought.quote.id));
      await app.db.update(payments).set({ confirmedAt: at, amountMinor: amount }).where(eq(payments.id, bought.payment.id));
      await app.db.update(policies).set({ receivedAt: at, issuedAt: at, status: 'ACTIVE', premiumMinor: amount }).where(eq(policies.policyNumber, bought.policy.policyNumber));
    }
  });
  afterAll(async () => { await app?.close(); });
  const get = (path: string, session: Session, filters: Record<string, string> = period) => app.http.get(`/api/v1/${path}`).set(session).query(filters);

  it('counts only the trusted insurer and inclusive Lusaka period, with cohort definitions and ownership', async () => {
    const result = await get('insurer/reports/operations', manager);
    expect(result.status).toBe(200);
    const report = result.body as Report;
    expect(report).toMatchObject({ reportType: 'operations', privacy: 'aggregate-only', filters: { ...period, timeZone: 'Africa/Lusaka' }, scope: { kind: 'insurer', insurerId: insurer.insurer.id }, owner: { organization: 'insurer', insurerId: insurer.insurer.id } });
    for (const key of ['quoteRequests', 'quotesSent', 'quotesConverted', 'policiesReceived', 'policiesIssued']) expect(value(report, key)).toBe('2');
    expect(value(report, 'claimsNotified')).toBe('0');
    expect(report.metrics.every((metric) => metric.label && metric.definition && /^\d+$/.test(metric.value))).toBe(true);
    expect(Number.isFinite(Date.parse(report.dataAsOf))).toBe(true);
    expect(Number.isFinite(Date.parse(report.generatedAt))).toBe(true);
    expect(result.headers['cache-control']).toBe('no-store');
    const [audit] = await app.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, report.reportId), eq(auditLogs.action, 'report.generated')));
    expect(audit).toMatchObject({ actorId: insurer.staff.id, actorType: 'INSURER', after: { ...period, permission: 'portal:reports:operations', format: 'json', insurerId: insurer.insurer.id } });
  });

  it('reports established finance facts without calculating commercial fees or commission', async () => {
    const result = await get('insurer/reports/finance', finance);
    expect(result.status).toBe(200);
    const report = result.body as Report;
    expect(value(report, 'confirmedPayments')).toBe('2');
    expect(value(report, 'confirmedPaymentAmount')).toBe('300000');
    expect(value(report, 'issuedPolicyPremium')).toBe('300000');
    expect(value(report, 'completedRefundAmount')).toBe('0');
    expect(report.metrics.filter((metric) => metric.unit === 'minorUnits').every((metric) => metric.currency === 'ZMW')).toBe(true);
    expect(report.metrics.some((metric) => /commission|fee/i.test(metric.key))).toBe(false);
    expect(report.limitations.join(' ')).toContain('DEC-013 commercial model is not approved');
    expect((await get('insurer/settlements', finance, {})).status).toBe(200);
    const otherReport = await get('insurer/reports/finance', await signIn(app.http, other.staff));
    expect(value(otherReport.body as Report, 'confirmedPaymentAmount')).toBe('700000');
  });

  it('reads renewal, claim, NCD, shared inspection and paused SLA facts without fan-out', async () => {
    const tenant = await buildInsurer(app.db, { staff: { role: 'INSURER_ADMIN' } });
    const buyer = await buildCustomer(app.db);
    const at = new Date('2026-09-10T10:00:00Z');
    const purchased = await buildPurchasedPolicy(app.db, { insurer: tenant, customer: buyer });
    const { quoteRequest } = await buildQuoteRequest(app.db, { customerId: buyer.id, insurerIds: [tenant.insurer.id] }, {
      submittedAt: at, model: 'PRODUCT_SELECTION', renewalOfPolicyNumber: purchased.policy.policyNumber,
    });
    await buildClaim(app.db, { insurerId: tenant.insurer.id, customerId: buyer.id }, { submittedAt: at });
    await buildClaim(app.db, { insurerId: tenant.insurer.id, customerId: buyer.id }, { submittedAt: new Date('2026-10-01T00:00:00Z') });
    await buildNcdApplication(app.db, { insurerId: tenant.insurer.id, customerId: buyer.id }, { submittedAt: at });
    const inspection = await buildInspection(app.db, { customerId: buyer.id, insurerId: null }, { createdAt: at });
    // Two products sharing one inspection must contribute only one inspection.
    for (const status of ['SUBMITTED', 'VERIFICATION_REQUIRED', 'TIMED_OUT'] as const) {
      const code = unique('report-product');
      const [product] = await app.db.insert(insurerProducts).values({ insurerId: tenant.insurer.id, code, coverType: 'COMPREHENSIVE' }).returning();
      const [version] = await app.db.insert(insurerProductVersions).values({
        productId: product.id, versionNumber: 1, status: 'APPROVED', name: code,
        coverType: 'COMPREHENSIVE', coverGuide: {}, inspectionRule: 'NOT_REQUIRED',
        rateBps: 525, allowedDurations: ['Q4'], effectiveFrom: at, createdByStaffId: tenant.staff.id,
      }).returning();
      await app.db.insert(quoteRequestProductVersions).values({
        quoteRequestId: quoteRequest.id, productVersionId: version.id, insurerId: tenant.insurer.id,
        productCode: code, productVersionNumber: 1, productName: code, coverType: 'COMPREHENSIVE',
        coverGuide: {}, inspectionRule: 'NOT_REQUIRED', status, selectedAt: at,
        replyDueAt: new Date('2020-01-01T00:00:00Z'), pausedAt: status === 'VERIFICATION_REQUIRED' ? at : null,
      });
      if (status !== 'TIMED_OUT') await app.db.insert(inspectionRequestProducts).values({
        inspectionId: inspection.id, quoteRequestId: quoteRequest.id, productVersionId: version.id, stage: 'BEFORE_QUOTATION',
      });
    }
    const response = await get('insurer/reports/operations', await signIn(app.http, tenant.staff));
    expect(response.status).toBe(200);
    const report = response.body as Report;
    for (const key of ['renewalRequests', 'claimsNotified', 'ncdApplications', 'inspectionsRequested', 'overdueProductSelections', 'timedOutProductSelections']) expect(value(report, key)).toBe('1');
    expect(value(report, 'productSelections')).toBe('3');
    expect(value(report, 'openProductSelections')).toBe('2');
  });

  it('uses completion and finalisation dates for refunds and settlements and excludes drafts and unattributed exceptions', async () => {
    const tenant = await buildInsurer(app.db, { staff: { role: 'INSURER_ADMIN' } });
    const bought = await buildPurchasedPolicy(app.db, { insurer: tenant });
    const actor = await buildStaffUser(app.db, { role: 'ADMIN' });
    const at = new Date('2026-09-10T10:00:00Z');
    await app.db.insert(paymentRefunds).values({ paymentId: bought.payment.id, amountMinor: 2000, reasonCode: 'CUSTOMER_REQUEST', reason: 'Recorded refund', status: 'COMPLETED', provider: 'STAND_IN', proposedByStaffId: actor.id, completedAt: at });
    for (const status of ['DRAFT', 'FINALISED'] as const) await app.db.insert(settlements).values({
      reference: unique('SET'), insurerId: tenant.insurer.id, period: status === 'DRAFT' ? '2026-08' : '2026-07',
      periodStart: new Date('2026-07-01T00:00:00Z'), periodEnd: new Date('2026-08-01T00:00:00Z'),
      status, grossPremiumMinor: 10000, feesMinor: 0, refundsMinor: 2000, adjustmentsMinor: 0,
      commissionMinor: 0, commissionBps: 0, netPayableMinor: 8000, ruleVersions: {}, draftedByStaffId: actor.id,
      finalisedAt: status === 'FINALISED' ? at : null,
    });
    await app.db.insert(reconciliationItems).values([
      { kind: 'ISSUANCE_FAILED', insurerId: tenant.insurer.id, reason: 'Assigned exception', openedAt: at },
      { kind: 'ISSUANCE_FAILED', insurerId: null, reason: 'Unassigned exception', openedAt: at },
      { kind: 'ISSUANCE_FAILED', insurerId: other.insurer.id, reason: 'Other insurer exception', openedAt: at },
    ]);
    const response = await get('insurer/reports/finance', await signIn(app.http, tenant.staff));
    expect(response.status).toBe(200);
    const report = response.body as Report;
    expect(value(report, 'completedRefunds')).toBe('1');
    expect(value(report, 'completedRefundAmount')).toBe('2000');
    expect(value(report, 'finalisedSettlements')).toBe('1');
    expect(value(report, 'recordedSettlementNetPayable')).toBe('8000');
    expect(value(report, 'reconciliationExceptions')).toBe('1');
  });

  it('keeps admin reporting platform-wide and protects both formats with the same permissions', async () => {
    const platform = await get('admin/reports/operations', admin);
    expect(platform.status).toBe(200);
    expect(platform.body.scope).toEqual({ kind: 'platform', insurerId: null });
    // Two boundary fixtures are outside the Lusaka period. The three inside
    // it span both insurers, so the platform cohort must include all three.
    expect(BigInt(value(platform.body as Report, 'quotesSent') ?? '0')).toBeGreaterThanOrEqual(3n);
    for (const suffix of ['', '/export']) {
      expect((await get(`insurer/reports/finance${suffix}`, quoteOfficer)).status).toBe(403);
      expect((await get(`admin/reports/operations${suffix}`, manager)).status).toBe(403);
      expect((await get(`insurer/reports/operations${suffix}`, customer)).status).toBe(403);
      expect((await app.http.get(`/api/v1/insurer/reports/operations${suffix}`).query(period)).status).toBe(401);
    }
    expect((await get('insurer/reports/operations', quoteOfficer)).status).toBe(200);
  });

  const invalidPeriods: Record<string, string>[] = [
    {}, { from: period.from }, { ...period, from: '2026-02-30' },
    { ...period, to: '2026-08-31' }, { from: '2026-01-01', to: '2027-01-02' },
    { ...period, to: '2026-09-30T23:59:59Z' }, { ...period, from: '2026-9-01' },
  ];
  it.each(invalidPeriods)('rejects invalid explicit date filters %j on JSON and CSV', async (filters) => {
    for (const suffix of ['', '/export']) {
      const response = await get(`insurer/reports/operations${suffix}`, manager, filters);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_FAILED');
    }
  });

  it('does not accept tenant scope from the query', async () => {
    const response = await get('insurer/reports/operations', manager, { ...period, insurerId: other.insurer.id });
    // The application validation pipe rejects unrecognised filters.
    expect(response.status).toBe(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('exports only aggregate cells and audits format, actor, permission and generation metadata', async () => {
    for (const [path, session, permission] of [
      ['insurer/reports/operations', manager, 'portal:reports:operations'],
      ['insurer/reports/finance', finance, 'portal:reports:finance'],
      ['admin/reports/operations', admin, 'admin:reports:read'],
    ] as const) {
      const response = await get(`${path}/export`, session);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('text/csv');
      expect(response.headers['content-disposition']).toContain('attachment;');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.text).toContain('"definition"');
      expect(response.text).toContain('"Africa/Lusaka"');
      expect(response.text).toContain('"aggregate-only"');
      if (path.startsWith('insurer/')) expect(response.text).not.toContain(other.insurer.id);
      if (path.endsWith('/finance')) expect(response.text).toContain('"confirmedPaymentAmount","Confirmed payment amount","300000"');
      for (const personal of [insurer.staff.email, insurer.staff.fullName, '=PRIVATE_INSURER()', other.staff.email]) expect(response.text).not.toContain(personal);
      const reportId = response.text.split('\r\n')[1].split(',')[0].replaceAll('"', '');
      const [audit] = await app.db.select().from(auditLogs).where(and(eq(auditLogs.entityId, reportId), eq(auditLogs.action, 'report.exported')));
      expect(audit.after).toMatchObject({ ...period, permission, format: 'csv', timeZone: 'Africa/Lusaka' });
      expect(audit.actorId).toBeTruthy();
      expect(audit.after).toHaveProperty('generatedAt');
      expect(audit.after).toHaveProperty('dataAsOf');
    }
  });
});
