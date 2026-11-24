import { and, eq } from 'drizzle-orm';
import { IssuanceJobs } from '../src/payments/issuance-jobs.js';
import { auditLogs, jobs, notifications, policies, reconciliationItems } from '../src/db/schema.js';
import { buildDocument, buildInsurer, buildPurchasedPolicy, buildStaffUser, type BuiltInsurer } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const HOUR_MS = 3_600_000;

describe('issuing a paid policy', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const post = async (insurer: BuiltInsurer, path: string, body: Record<string, unknown> = {}) =>
    testApp.http.post(`/api/v1/insurer/${path}`).set(await signIn(testApp.http, insurer.staff)).send(body);
  const certificate = async (insurer: BuiltInsurer) =>
    (await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'CERTIFICATE' })).id;
  const policyRow = async (policyNumber: string) =>
    (await testApp.db.select().from(policies).where(eq(policies.policyNumber, policyNumber)))[0];
  const itemsOf = (policyNumber: string) =>
    testApp.db.select().from(reconciliationItems).where(eq(reconciliationItems.policyNumber, policyNumber));
  const toldCustomer = async (customerId: string) =>
    (
      await testApp.db
        .select({ key: notifications.templateKey })
        .from(notifications)
        .where(and(eq(notifications.customerId, customerId), eq(notifications.channel, 'IN_APP')))
    ).map((row) => row.key);

  async function paidPolicy(overrides: { issuanceDueAt?: Date } = {}) {
    const insurer = await buildInsurer(testApp.db);
    const built = await buildPurchasedPolicy(testApp.db, { insurer });
    await testApp.db
      .update(policies)
      .set({ issuanceDueAt: overrides.issuanceDueAt ?? new Date(Date.now() + 48 * HOUR_MS) })
      .where(eq(policies.policyNumber, built.policy.policyNumber));
    return built;
  }

  it('accepts once, then issues with the certificate', async () => {
    const { insurer, customer, policy } = await paidPolicy();

    const accepted = await post(insurer, `policies/${policy.policyNumber}/accept`, { insurerPolicyNumber: 'MTR-1400' });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ policyNumber: policy.policyNumber, issuanceAcceptedAt: expect.any(String), insurerPolicyNumber: 'MTR-1400' });
    const again = await post(insurer, `policies/${policy.policyNumber}/accept`);
    expect(again.body.issuanceAcceptedAt).toBe(accepted.body.issuanceAcceptedAt);

    const issued = await post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: await certificate(insurer) });
    expect(issued.body).toMatchObject({ status: 'Active', insurerPolicyNumber: 'MTR-1400' });
    expect((await policyRow(policy.policyNumber)).issuanceAcceptedAt?.toISOString()).toBe(accepted.body.issuanceAcceptedAt);
    expect(await toldCustomer(customer.id)).toEqual(expect.arrayContaining(['policy.issuance_accepted', 'policy.certificate_issued']));
  });

  it('accepts and issues in one step when the certificate comes first', async () => {
    const { insurer, policy } = await paidPolicy();
    await post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: await certificate(insurer) });
    const row = await policyRow(policy.policyNumber);
    expect(row.status).toBe('ACTIVE');
    expect(row.issuanceAcceptedAt?.toISOString()).toBe(row.issuedAt?.toISOString());
    expect((await post(insurer, `policies/${policy.policyNumber}/accept`)).body.code).toBe('ALREADY_ISSUED');
  });

  it('records a failure for a refund, tells the customer, and blocks a later certificate', async () => {
    const { insurer, customer, policy, payment } = await paidPolicy();
    const failed = await post(insurer, `policies/${policy.policyNumber}/issuance-failure`, {
      reasonCode: 'VEHICLE_DETAILS_WRONG',
      customerMessage: 'The chassis number does not match the registration book.',
    });

    expect(failed.status).toBe(200);
    expect(failed.body).toMatchObject({ status: 'Issuance failed', reason: 'The chassis number does not match the registration book.' });
    expect(await policyRow(policy.policyNumber)).toMatchObject({
      status: 'ISSUANCE_FAILED',
      issuanceFailureReason: 'The chassis number does not match the registration book.',
    });
    expect(await itemsOf(policy.policyNumber)).toEqual([
      expect.objectContaining({ kind: 'ISSUANCE_FAILED', status: 'OPEN', paymentId: payment.id, insurerId: insurer.insurer.id, amountMinor: payment.amountMinor }),
    ]);
    expect(await toldCustomer(customer.id)).toContain('policy.issuance_failed');

    const late = await post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: await certificate(insurer) });
    expect(late.body.code).toBe('ISSUANCE_CLOSED');
    expect((await post(insurer, `policies/${policy.policyNumber}/accept`)).body.code).toBe('ISSUANCE_CLOSED');
    expect(
      (await post(insurer, `policies/${policy.policyNumber}/issuance-failure`, { reasonCode: 'OTHER', customerMessage: 'Trying a second time.' })).body.code,
    ).toBe('ISSUANCE_CLOSED');
  });

  it('refuses a failure without a reason the customer can read', async () => {
    const { insurer, policy } = await paidPolicy();
    const vague = await post(insurer, `policies/${policy.policyNumber}/issuance-failure`, { reasonCode: 'OTHER', customerMessage: 'No.' });
    const unknown = await post(insurer, `policies/${policy.policyNumber}/issuance-failure`, { reasonCode: 'BORED', customerMessage: 'We do not want to issue it.' });
    expect([vague.status, unknown.status]).toEqual([400, 400]);
    expect((await policyRow(policy.policyNumber)).status).toBe('AWAITING_INSURER_CERTIFICATE');
  });

  it("answers another insurer's policy as absent on every issuing route, and audits the reach", async () => {
    const { policy } = await paidPolicy();
    const other = await buildInsurer(testApp.db);
    const answers = [
      await post(other, `policies/${policy.policyNumber}/accept`),
      await post(other, `policies/${policy.policyNumber}/issuance-failure`, { reasonCode: 'OTHER', customerMessage: 'Not ours to issue at all.' }),
    ];
    expect(answers.map((answer) => answer.status)).toEqual([404, 404]);
    expect((await policyRow(policy.policyNumber)).status).toBe('AWAITING_INSURER_CERTIFICATE');
    const refused = await testApp.db
      .select({ actorId: auditLogs.actorId })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.refused'), eq(auditLogs.entityId, policy.policyNumber)));
    expect(refused).toHaveLength(2);
  });

  it('shows the portal where issuing stands', async () => {
    const { insurer, policy } = await paidPolicy({ issuanceDueAt: new Date(Date.now() - HOUR_MS) });
    const listed = await testApp.http.get('/api/v1/insurer/policies').set(await signIn(testApp.http, insurer.staff));
    expect(listed.body.find((entry: { policyNumber: string }) => entry.policyNumber === policy.policyNumber).issuance).toEqual({
      dueAt: expect.any(String),
      acceptedAt: null,
      overdue: true,
      failedAt: null,
      failureReason: null,
    });
  });

  describe('the overdue check', () => {
    it('flags each late policy once, tells the customer and emails the insurer administrators', async () => {
      const { insurer, customer, policy } = await paidPolicy({ issuanceDueAt: new Date(Date.now() - HOUR_MS) });
      const admin = await buildStaffUser(testApp.db, { role: 'INSURER_ADMIN', insurerId: insurer.insurer.id });
      const { policy: onTime } = await paidPolicy();
      const check = testApp.app.get(IssuanceJobs);

      await check.flagOverdue();
      await check.flagOverdue();

      expect(await itemsOf(policy.policyNumber)).toEqual([expect.objectContaining({ kind: 'ISSUANCE_OVERDUE', status: 'OPEN' })]);
      expect(await itemsOf(onTime.policyNumber)).toEqual([]);
      expect((await policyRow(policy.policyNumber)).status).toBe('AWAITING_INSURER_CERTIFICATE');
      expect((await toldCustomer(customer.id)).filter((key) => key === 'policy.issuance_delayed')).toHaveLength(1);
      const emails = await testApp.db.select().from(jobs).where(eq(jobs.key, `issuance-overdue:${policy.policyNumber}:${admin.id}`));
      expect(emails).toHaveLength(1);
      expect(emails[0].payload).toMatchObject({ to: admin.email });
    });

    it('closes the overdue item when the late policy is issued', async () => {
      const { insurer, policy } = await paidPolicy({ issuanceDueAt: new Date(Date.now() - HOUR_MS) });
      await testApp.app.get(IssuanceJobs).flagOverdue();
      await post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: await certificate(insurer) });
      expect(await itemsOf(policy.policyNumber)).toEqual([
        expect.objectContaining({ kind: 'ISSUANCE_OVERDUE', status: 'RESOLVED', outcome: 'ISSUED', resolvedAt: expect.any(Date) }),
      ]);
    });
  });

  it("tells the customer on their policy where issuing stands, and the product they bought", async () => {
    const { customer, policy } = await paidPolicy({ issuanceDueAt: new Date(Date.now() - HOUR_MS) });
    const mine = await testApp.http.get(`/api/v1/policies/${policy.policyNumber}`).set(await signIn(testApp.http, customer));
    expect(mine.body.issuance).toMatchObject({ overdue: true, failedAt: null });
    expect(mine.body.product).toBeNull();
  });
});
