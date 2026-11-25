import { eq } from 'drizzle-orm';
import { moneyAdjustments, paymentRefunds, payments, policies, reconciliationItems, settlements } from '../src/db/schema.js';
import { buildInsurer, buildPurchasedPolicy, buildStaffUser, type BuiltInsurer } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

type Session = Awaited<ReturnType<typeof signIn>>;

const SEPTEMBER = new Date('2026-09-15T08:00:00.000Z');

describe('settlements and money adjustments', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let maker: Session;
  let checker: Session;
  let makerId: string;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    const makerStaff = await buildStaffUser(testApp.db, { role: 'ADMIN', fullName: 'Mwila Maker' });
    makerId = makerStaff.id;
    maker = await signIn(testApp.http, makerStaff);
    checker = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'ADMIN', fullName: 'Chipo Checker' }));
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const admin = (session: Session) => ({
    get: (path: string) => testApp.http.get(`/api/v1/admin/${path}`).set(session),
    post: (path: string, body: Record<string, unknown> = {}) => testApp.http.post(`/api/v1/admin/${path}`).set(session).send(body),
  });
  const approve = (approvalRequestId: string) => admin(checker).post(`approvals/${approvalRequestId}/approve`);
  const draft = (insurer: BuiltInsurer, period = '2026-09') => admin(maker).post('settlements', { insurerId: insurer.insurer.id, period });
  const finalise = async (id: string) => {
    const requested = await admin(maker).post(`settlements/${id}/finalise`, { reason: 'Checked against the provider statement.' });
    expect(requested.status).toBe(200);
    return requested.body.approvalRequestId as string;
  };

  /** A payment for this insurer confirmed on `at`, with a 5 kwacha levy, its policy in `status`. */
  async function paid(insurer: BuiltInsurer, at = SEPTEMBER, status: 'ACTIVE' | 'ISSUANCE_FAILED' = 'ACTIVE') {
    const bought = await buildPurchasedPolicy(testApp.db, { insurer });
    await testApp.db
      .update(payments)
      .set({
        confirmedAt: at,
        amountMinor: 100_500,
        amountBreakdown: [
          { kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amountMinor: 100_000 },
          { kind: 'CHARGE', code: 'RTSA_ANNIVERSARY_FEE', label: 'RTSA anniversary fee', amountMinor: 500 },
        ],
      })
      .where(eq(payments.id, bought.payment.id));
    await testApp.db.update(policies).set({ status }).where(eq(policies.policyNumber, bought.policy.policyNumber));
    return bought;
  }

  it('drafts a month from the records: premium for live cover, charges apart, live-cover refunds deducted', async () => {
    const insurer = await buildInsurer(testApp.db);
    const first = await paid(insurer);
    await paid(insurer);
    await paid(insurer, SEPTEMBER, 'ISSUANCE_FAILED');
    await testApp.db.insert(paymentRefunds).values({
      paymentId: first.payment.id,
      amountMinor: 20_000,
      reasonCode: 'CUSTOMER_REQUEST',
      reason: 'Goodwill after a late certificate.',
      status: 'COMPLETED',
      provider: 'STAND_IN',
      providerRefundId: `SIRF-goodwill-${first.payment.id}`,
      proposedByStaffId: makerId,
      completedAt: new Date('2026-09-20T08:00:00.000Z'),
    });

    const drafted = await draft(insurer);

    expect(drafted.status).toBe(201);
    expect(drafted.body).toMatchObject({
      status: 'DRAFT',
      period: '2026-09',
      insurer: insurer.insurer.name,
      grossPremium: 2000,
      fees: 10,
      refunds: 200,
      adjustments: 0,
      commission: 0,
      netPayable: 1800,
    });
    expect(drafted.body.lines.map((line: { kind: string; amount: number }) => [line.kind, line.amount])).toEqual([
      ['PAYMENT', 1000],
      ['PAYMENT', 1000],
      ['REFUND', -200],
    ]);

    // Drawing it again replaces the draft.
    const again = await draft(insurer);
    expect(again.body.id).not.toBe(drafted.body.id);
    expect(await testApp.db.select().from(settlements).where(eq(settlements.insurerId, insurer.insurer.id))).toHaveLength(1);
  });

  it('finalises only after a second administrator approves, then nothing in it is settled again or changed', async () => {
    const insurer = await buildInsurer(testApp.db);
    const bought = await paid(insurer);
    const drafted = await draft(insurer);
    const approvalId = await finalise(drafted.body.id);

    expect((await admin(maker).post(`approvals/${approvalId}/approve`)).status).toBe(403);
    expect((await approve(approvalId)).status).toBe(201);
    const settled = await admin(maker).get(`settlements/${drafted.body.id}`);
    expect(settled.body).toMatchObject({ status: 'FINALISED', finalisedAt: expect.any(String) });
    const [payment] = await testApp.db.select().from(payments).where(eq(payments.id, bought.payment.id));
    expect(payment.settlementId).toBe(drafted.body.id);

    expect((await draft(insurer)).body.code).toBe('SETTLEMENT_LOCKED');
    expect((await draft(insurer, '2026-10')).body).toMatchObject({ grossPremium: 0, netPayable: 0 });
    await expect(
      side.db.update(settlements).set({ netPayableMinor: 1 }).where(eq(settlements.id, drafted.body.id)),
    ).rejects.toThrow();
  });

  it('refuses to finalise a draft whose records another settlement took meanwhile', async () => {
    const insurer = await buildInsurer(testApp.db);
    await paid(insurer);
    const october = await draft(insurer, '2026-09');
    const november = await draft(insurer, '2026-10');
    // The September payment sits in both drafts until one is finalised.
    expect(november.body.grossPremium).toBe(1000);
    await approve(await finalise(october.body.id));

    const stale = await approve(await finalise(november.body.id));
    expect(stale.body.code).toBe('SETTLEMENT_STALE');
    expect((await admin(maker).get(`settlements/${november.body.id}`)).body.status).toBe('PROPOSED');
  });

  it('turns a rejected settlement back into a draft', async () => {
    const insurer = await buildInsurer(testApp.db);
    await paid(insurer);
    const drafted = await draft(insurer);
    const approvalId = await finalise(drafted.body.id);
    expect((await admin(maker).post(`settlements/${drafted.body.id}/finalise`, { reason: 'Sending it a second time.' })).body.code).toBe('SETTLEMENT_LOCKED');
    expect((await admin(checker).post(`approvals/${approvalId}/reject`, { reason: 'Wait for the statement.' })).status).toBe(201);
    expect((await admin(maker).get(`settlements/${drafted.body.id}`)).body.status).toBe('DRAFT');
  });

  it('lands an adjustment in the next draft only once approved, and never edits it afterwards', async () => {
    const insurer = await buildInsurer(testApp.db);
    const proposed = await admin(maker).post('money-adjustments', {
      insurerId: insurer.insurer.id,
      amount: -150.25,
      kind: 'SETTLEMENT_CORRECTION',
      reason: 'September paid a levy to the insurer by mistake.',
    });
    expect(proposed.status).toBe(201);
    expect(proposed.body).toMatchObject({ amount: -150.25, status: 'PENDING_APPROVAL' });
    expect((await draft(insurer)).body.adjustments).toBe(0);

    expect((await admin(maker).post(`approvals/${proposed.body.approvalRequestId}/approve`)).status).toBe(403);
    await approve(proposed.body.approvalRequestId);
    const [adjustment] = await testApp.db.select().from(moneyAdjustments).where(eq(moneyAdjustments.insurerId, insurer.insurer.id));
    expect(adjustment).toMatchObject({ amountMinor: -15_025, proposedByStaffId: makerId });
    // Approved today, so it is not in a month that ended before it.
    expect((await draft(insurer, '2026-10')).body.adjustments).toBe(0);
    const thisMonth = new Date().toISOString().slice(0, 7);
    expect((await admin(maker).post('settlements', { insurerId: insurer.insurer.id, period: thisMonth })).body.code).toBe('PERIOD_NOT_OVER');
    await expect(side.db.update(moneyAdjustments).set({ amountMinor: 1 }).where(eq(moneyAdjustments.id, adjustment.id))).rejects.toThrow();
    await expect(side.db.delete(moneyAdjustments).where(eq(moneyAdjustments.id, adjustment.id))).rejects.toThrow();

    expect(
      (await admin(maker).post('money-adjustments', { insurerId: insurer.insurer.id, amount: 0, kind: 'OTHER', reason: 'Nothing at all to move.' })).status,
    ).toBe(400);
  });

  it('takes an approved adjustment into the month it was approved in, as its own line', async () => {
    const insurer = await buildInsurer(testApp.db);
    await testApp.db.insert(moneyAdjustments).values({
      insurerId: insurer.insurer.id,
      kind: 'REVERSAL_RECOVERY',
      amountMinor: -5_000,
      reason: 'Recovering a reversed payment already settled.',
      approvalRequestId: crypto.randomUUID(),
      proposedByStaffId: makerId,
      approvedByStaffId: makerId,
      createdAt: new Date('2026-09-28T08:00:00.000Z'),
    });
    const drafted = await draft(insurer);
    expect(drafted.body).toMatchObject({ adjustments: -50, netPayable: -50 });
    expect(drafted.body.lines).toEqual([expect.objectContaining({ kind: 'ADJUSTMENT', amount: -50, reference: 'REVERSAL_RECOVERY' })]);
  });

  it('resolves the reconciliation item an adjustment was proposed for, once approved', async () => {
    const insurer = await buildInsurer(testApp.db);
    const bought = await paid(insurer);
    const [item] = await testApp.db
      .insert(reconciliationItems)
      .values({ kind: 'REVERSAL', paymentId: bought.payment.id, insurerId: insurer.insurer.id, amountMinor: 100_500, reason: 'Chargeback after settlement.' })
      .returning();
    const proposed = await admin(maker).post('money-adjustments', {
      insurerId: insurer.insurer.id,
      amount: -1000,
      kind: 'REVERSAL_RECOVERY',
      reason: 'Recover the premium of a reversed payment.',
      reconciliationItemId: item.id,
    });
    await approve(proposed.body.approvalRequestId);
    const [resolved] = await testApp.db.select().from(reconciliationItems).where(eq(reconciliationItems.id, item.id));
    expect(resolved).toMatchObject({ status: 'RESOLVED', outcome: 'ADJUSTED' });
  });

  describe("the insurer's view", () => {
    it('shows an insurer administrator its own finalised settlements and the export, and nothing else', async () => {
      const insurer = await buildInsurer(testApp.db);
      await paid(insurer);
      const drafted = await draft(insurer);
      const other = await buildInsurer(testApp.db);
      await paid(other);
      const othersDraft = await draft(other);
      await approve(await finalise(othersDraft.body.id));

      const insurerAdmin = await signIn(testApp.http, await buildStaffUser(testApp.db, { role: 'INSURER_ADMIN', insurerId: insurer.insurer.id }));
      const read = (path: string) => testApp.http.get(`/api/v1/insurer/${path}`).set(insurerAdmin);
      expect((await read('settlements')).body).toEqual([]);
      expect((await read(`settlements/${drafted.body.id}`)).status).toBe(404);

      await approve(await finalise(drafted.body.id));
      const listed = await read('settlements');
      expect(listed.body.map((entry: { id: string }) => entry.id)).toEqual([drafted.body.id]);
      expect((await read(`settlements/${othersDraft.body.id}`)).status).toBe(404);

      const csv = await read(`settlements/${drafted.body.id}/export`);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('gross_premium_zmw,1000.00');
      expect(csv.text).toContain('net_payable_zmw,1000.00');

      const quoting = await signIn(testApp.http, insurer.staff);
      expect((await testApp.http.get('/api/v1/insurer/settlements').set(quoting)).status).toBe(403);
      expect((await testApp.http.get('/api/v1/admin/settlements').set(insurerAdmin)).status).toBe(403);
    });
  });
});
