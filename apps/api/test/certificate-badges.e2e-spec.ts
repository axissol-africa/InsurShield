import { and, eq } from 'drizzle-orm';
import { CertificateBadgesService } from '../src/certificate-badges/certificate-badges.service.js';
import { auditLogs, certificateBadgeSnapshots, insurers, payments, platformRuleVersions, policies } from '../src/db/schema.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { buildCustomer, buildInsurer, buildPurchasedPolicy, buildStaffUser, type BuiltInsurer } from './builders.js';
import { buildInsurerProfileProducts } from './builders/insurer-profiles.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const HOUR = 3_600_000;
const VERSION = 8_181;
const publicPath = '/api/v1/insurer-reputation';
const badgePath = (id: string) => `/api/v1/admin/insurer-reputation/${id}/badge`;

describe('Batch 18 certificate badge lifecycle', () => {
  let app: TestApp;
  let staffId: string;

  beforeAll(async () => { app = await startApp(); });
  afterAll(async () => {
    if (!app) return;
    if (staffId) await app.db.delete(platformRuleVersions).where(eq(platformRuleVersions.createdByStaffId, staffId));
    await app.close();
  });

  async function addPurchase(
    insurer: BuiltInsurer,
    customer: Awaited<ReturnType<typeof buildCustomer>>,
    confirmedAt: Date,
    dueAt: Date | null,
    issuedAt: Date | null,
  ) {
    const { payment, policy } = await buildPurchasedPolicy(app.db, { insurer, customer });
    await app.db.update(payments).set({ confirmedAt }).where(eq(payments.id, payment.id));
    await app.db.update(policies).set({ receivedAt: confirmedAt, issuanceDueAt: dueAt, issuedAt })
      .where(eq(policies.policyNumber, policy.policyNumber));
    return policy.policyNumber;
  }

  it('publishes at the exact threshold, keeps a private history, and refreshes after administrative suspension', async () => {
    const insurer = await buildInsurer(app.db, { staff: { role: 'INSURER_ADMIN' } });
    const insurerId = insurer.insurer.id;
    await buildInsurerProfileProducts(app.db, insurer);
    const customer = await buildCustomer(app.db);
    const staff = await buildStaffUser(app.db, { role: 'ADMIN' });
    staffId = staff.id;
    const admin = await signIn(app.http, staff);
    const otherAdmin = await signIn(app.http, await buildStaffUser(app.db, { role: 'ADMIN' }));
    const tenant = await signIn(app.http, insurer.staff);
    const decide = (headers: typeof admin, suspended: boolean, expectedGeneration: number, reason: string) =>
      app.http.put(badgePath(insurerId)).set(headers).send({ suspended, expectedGeneration, reason });
    const service = app.app.get(CertificateBadgesService);
    const publicRead = () => app.http.get(publicPath).query({ insurerIds: insurerId });
    const snapshots = () => app.db.select().from(certificateBadgeSnapshots)
      .where(eq(certificateBadgeSnapshots.insurerId, insurerId));
    const now = new Date();
    const due = new Date(now.getTime() - 24 * HOUR);
    const paid = new Date(due.getTime() - HOUR);
    const late = new Date(due.getTime() + 1);

    await publicRead().expect(200, { items: [] });
    await service.calculate(now);
    expect(await snapshots()).toEqual([]);
    await app.db.insert(platformRuleVersions).values({
      key: 'REPUTATION_POLICY', state: 'CONFIRMED', value: defaultRuleValue('REPUTATION_POLICY'),
      versionNumber: VERSION, effectiveFrom: paid, createdByStaffId: staff.id, confirmedByStaffId: staff.id, confirmedAt: paid,
    });

    for (let index = 0; index < 27; index += 1) await addPurchase(insurer, customer, paid, due, due);
    await addPurchase(insurer, customer, paid, due, late);
    await addPurchase(insurer, customer, paid, due, null);
    await addPurchase(insurer, customer, paid, due, null);
    await addPurchase(insurer, customer, paid, null, null);
    await addPurchase(insurer, customer, paid, new Date(now.getTime() + 24 * HOUR), null);
    await addPurchase(insurer, customer, paid, new Date(now.getTime() - 91 * 24 * HOUR), null);

    await Promise.all([service.calculate(now), service.calculate(now)]);
    expect(await snapshots()).toHaveLength(1);
    const { body } = await publicRead().expect(200);
    expect(body.items[0]).toMatchObject({
      insurerId,
      rating: null,
      badges: [{
        label: 'On-time policy certificates', sampleCount: 30, onTimeCount: 27, percentage: 90,
        minimumPolicies: 30, thresholdBps: 9000, ruleVersion: VERSION,
      }],
    });
    expect(JSON.stringify(body)).not.toContain(customer.email);
    expect(await service.publicBadges([insurerId], VERSION, new Date(now.getTime() + 48 * HOUR))).toEqual([]);

    const [original] = await snapshots();
    await expect(app.db.delete(certificateBadgeSnapshots).where(eq(certificateBadgeSnapshots.id, original.id)))
      .rejects.toMatchObject({ cause: { code: 'P0001' } });
    await app.http.get(badgePath(insurerId)).set(tenant).expect(403);
    await decide(tenant, true, 0, 'Tenant request').expect(403);
    await decide(admin, true, 0, '   ').expect(400);
    await app.http.put(badgePath(insurerId)).set(admin).send({ suspended: true, reason: 'Missing generation' }).expect(400);
    const initial = await app.http.get(badgePath(insurerId)).set(admin).expect(200);
    expect(initial.body.generation).toBe(0);
    await decide(admin, true, 0, 'Reviewing certificate delivery records').expect(200);
    expect((await publicRead().expect(200)).body.items[0].badges).toEqual([]);
    await decide(admin, false, 1, 'Delivery records reviewed').expect(200);
    expect((await publicRead().expect(200)).body.items[0].badges).toEqual([]);
    await decide(otherAdmin, true, 2, 'Reviewing a new concern').expect(200);
    const stale = await decide(admin, false, 1, 'Delivery records reviewed').expect(409);
    expect(stale.body.code).toBe('BADGE_STATE_CHANGED');
    const newer = await app.http.get(badgePath(insurerId)).set(admin).expect(200);
    expect(newer.body).toMatchObject({ generation: 3, suspensionReason: 'Reviewing a new concern' });
    expect((await publicRead().expect(200)).body.items[0].badges).toEqual([]);
    await decide(otherAdmin, false, 3, 'New concern reviewed').expect(200);
    await service.calculate(new Date());
    expect((await publicRead().expect(200)).body.items[0].badges).toHaveLength(1);
    await app.db.update(insurers).set({ status: 'SUSPENDED' }).where(eq(insurers.id, insurerId));
    expect((await publicRead().expect(200)).body.items[0].badges).toEqual([]);

    await app.db.update(insurers).set({ status: 'ACTIVE' }).where(eq(insurers.id, insurerId));
    const nextDay = new Date(now.getTime() + 24 * HOUR);
    await service.calculate(nextDay);
    expect(await snapshots()).toEqual(expect.arrayContaining([
      expect.objectContaining({ calculatedAt: nextDay, qualifies: false, sampleCount: 31, onTimeCount: 27 }),
    ]));
    expect(await service.publicBadges([insurerId], VERSION, nextDay)).toEqual([]);

    const changes = await app.db.select({ action: auditLogs.action }).from(auditLogs)
      .where(and(eq(auditLogs.entityId, insurerId), eq(auditLogs.entityType, 'CERTIFICATE_BADGE')));
    expect(changes.map(({ action }) => action).sort()).toEqual([
      'certificate_badge.calculated', 'certificate_badge.calculated', 'certificate_badge.calculated',
      'certificate_badge.resumed', 'certificate_badge.resumed', 'certificate_badge.suspended', 'certificate_badge.suspended',
    ]);
  });
});
