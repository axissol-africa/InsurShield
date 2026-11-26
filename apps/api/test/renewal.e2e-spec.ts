import { vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { RenewalReminders } from '../src/customer/renewal-reminders.js';
import { SettingsService } from '../src/settings/settings.service.js';
import {
  insurerEvidence,
  insurerProductVersions,
  insurerProducts,
  notifications,
  payments,
  policies,
  quoteRequests,
  renewalReminders,
} from '../src/db/schema.js';
import { randomUUID } from 'node:crypto';
import { buildCustomer, buildInsurer, buildInsurerQuote, buildPayment, buildPolicy, buildPurchasedPolicy, buildQuoteRequest, unique, type BuiltInsurer } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const DAY_MS = 86_400_000;

describe('renewal', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const reminders = () => testApp.app.get(RenewalReminders);
  /** Noon today plus `days`, so the count of days left is exact whatever the hour of the run. */
  const inDays = (days: number) => {
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    return new Date(noon.getTime() + days * DAY_MS);
  };

  async function activePolicy(endsInDays: number, insurer?: BuiltInsurer) {
    const bought = await buildPurchasedPolicy(testApp.db, insurer ? { insurer } : {});
    await testApp.db
      .update(policies)
      .set({ status: 'ACTIVE', policyStartDate: inDays(endsInDays - 365), policyEndDate: inDays(endsInDays) })
      .where(eq(policies.policyNumber, bought.policy.policyNumber));
    return bought;
  }
  const told = async (customerId: string) =>
    (
      await testApp.db
        .select({ key: notifications.templateKey })
        .from(notifications)
        .where(and(eq(notifications.customerId, customerId), eq(notifications.channel, 'IN_APP')))
    ).map((row) => row.key);
  const remindersOf = (policyNumber: string) =>
    testApp.db.select({ kind: renewalReminders.kind, daysBefore: renewalReminders.daysBefore }).from(renewalReminders).where(eq(renewalReminders.policyNumber, policyNumber));

  async function replacementPurchase(previous: Awaited<ReturnType<typeof activePolicy>>, status: 'PENDING' | 'CONFIRMED', expired: boolean) {
    const { customer, insurer } = previous;
    const { quoteRequest } = await buildQuoteRequest(
      testApp.db,
      { customerId: customer.id, insurerIds: [insurer.insurer.id] },
      { renewalOfPolicyNumber: previous.policy.policyNumber, expiresAt: inDays(expired ? -1 : 7) },
    );
    const { quote } = await buildInsurerQuote(testApp.db, {
      quoteRequestId: quoteRequest.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id,
    });
    const payment = await buildPayment(
      testApp.db,
      { customerId: customer.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id },
      { status, confirmedAt: status === 'CONFIRMED' ? new Date() : null },
    );
    return {
      quoteRequest,
      policy: (policyStatus: 'ACTIVE' | 'CANCELLED') => buildPolicy(testApp.db, {
        customerId: customer.id, insurerId: insurer.insurer.id, vehicleId: quoteRequest.vehicleId, paymentId: payment.id,
      }, { status: policyStatus, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id }),
    };
  }

  describe('reminders', () => {
    it('reminds once on a reminder day, however often the job runs', async () => {
      const { customer, policy } = await activePolicy(30);
      await reminders().run();
      await reminders().run();
      expect(await remindersOf(policy.policyNumber)).toEqual([{ kind: 'DUE', daysBefore: 30 }]);
      expect((await told(customer.id)).filter((key) => key === 'policy.renewal_due')).toHaveLength(1);

      const listed = await testApp.http.get('/api/v1/notifications').set(await signIn(testApp.http, customer));
      expect(listed.body.items.find((item: { entityId: string }) => item.entityId === policy.policyNumber)).toMatchObject({
        entityType: 'POLICY',
        action: 'RENEW',
      });
    });

    it('sends the closest reminder after a missed run, not a stale one', async () => {
      const { policy } = await activePolicy(2);
      await reminders().run();
      expect(await remindersOf(policy.policyNumber)).toEqual([{ kind: 'DUE', daysBefore: 3 }]);
    });

    it('leaves alone a policy being renewed, or renewed and paid', async () => {
      const open = await activePolicy(14);
      await buildQuoteRequest(testApp.db, { customerId: open.customer.id, insurerIds: [] }, { renewalOfPolicyNumber: open.policy.policyNumber });

      const paid = await activePolicy(14);
      await (await replacementPurchase(paid, 'CONFIRMED', true)).policy('ACTIVE');

      const processing = await activePolicy(14);
      await replacementPurchase(processing, 'PENDING', true);

      await reminders().run();
      expect(await remindersOf(open.policy.policyNumber)).toEqual([]);
      expect(await remindersOf(paid.policy.policyNumber)).toEqual([]);
      expect(await remindersOf(processing.policy.policyNumber)).toEqual([]);
    });

    it('reminds and offers renewal again after confirmed money fails to produce continuing cover', async () => {
      const mismatch = await activePolicy(14);
      await replacementPurchase(mismatch, 'CONFIRMED', false);
      const refunded = await activePolicy(14);
      await (await replacementPurchase(refunded, 'CONFIRMED', false)).policy('CANCELLED');

      await reminders().run();
      for (const source of [mismatch, refunded]) {
        expect(await remindersOf(source.policy.policyNumber)).toEqual([{ kind: 'DUE', daysBefore: 14 }]);
        const current = await testApp.http.get(`/api/v1/policies/${source.policy.policyNumber}`).set(await signIn(testApp.http, source.customer)).expect(200);
        expect(current.body.renewal).toMatchObject({ renewable: true, renewalRequestId: null });
      }
    });

    it('tells a lapsed policy once, and nothing before the first reminder day', async () => {
      const lapsed = await activePolicy(-2);
      const early = await activePolicy(45);
      await reminders().run();
      await reminders().run();
      expect(await remindersOf(lapsed.policy.policyNumber)).toEqual([{ kind: 'LAPSED', daysBefore: 0 }]);
      expect(await told(lapsed.customer.id)).toContain('policy.lapsed');
      expect(await remindersOf(early.policy.policyNumber)).toEqual([]);
    });

    it('takes the reminder days and the window from the renewal setting', async () => {
      const settings = testApp.app.get(SettingsService);
      const real = settings.effective.bind(settings);
      const renewalPolicy = { value: { windowDays: 90, reminderDays: [45] }, version: 99, provisional: true };
      const spy = vi
        .spyOn(settings, 'effective')
        .mockImplementation(((key: Parameters<typeof real>[0], ...rest: [Date?]) => (key === 'RENEWAL_POLICY' ? Promise.resolve(renewalPolicy) : real(key, ...rest))) as typeof real);
      try {
        const { customer, policy } = await activePolicy(45);
        await reminders().run();
        expect(await remindersOf(policy.policyNumber)).toEqual([{ kind: 'DUE', daysBefore: 45 }]);
        const mine = await testApp.http.get(`/api/v1/policies/${policy.policyNumber}`).set(await signIn(testApp.http, customer));
        expect(mine.body.renewal).toMatchObject({ window: 'DUE', renewable: true });
      } finally {
        spy.mockRestore();
      }
    });

    it('reminds only active cover', async () => {
      const { policy } = await activePolicy(30);
      await testApp.db.update(policies).set({ status: 'CANCELLED' }).where(eq(policies.policyNumber, policy.policyNumber));
      await reminders().run();
      expect(await remindersOf(policy.policyNumber)).toEqual([]);
    });
  });

  describe('the product a renewal starts from', () => {
    /** A product this insurer offers today, with its first version, as a customer may buy it. */
    async function offered(insurer: BuiltInsurer) {
      const code = unique('REN');
      await testApp.db.insert(insurerEvidence).values({ insurerId: insurer.insurer.id, kind: 'LICENCE', state: 'APPROVED', reference: `${code}-LICENCE` });
      const [product] = await testApp.db.insert(insurerProducts).values({ insurerId: insurer.insurer.id, code, coverType: 'COMPREHENSIVE' }).returning();
      const version = (versionNumber: number, status: 'APPROVED' | 'WITHDRAWN' = 'APPROVED') =>
        testApp.db
          .insert(insurerProductVersions)
          .values({
            productId: product.id,
            versionNumber,
            status,
            name: `${code} cover v${versionNumber}`,
            coverType: 'COMPREHENSIVE',
            coverGuide: { planName: code },
            inspectionRule: 'NOT_REQUIRED',
            rateBps: 525,
            allowedDurations: ['Q4'],
            effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
            createdByStaffId: insurer.staff.id,
          })
          .returning()
          .then((rows) => rows[0]);
      return { product, version: await version(1), addVersion: version };
    }
    const policyView = async (customer: { email: string }, policyNumber: string) =>
      (await testApp.http.get(`/api/v1/policies/${policyNumber}`).set(await signIn(testApp.http, customer))).body;

    it('is the version bought while it is still offered, and the newer one once the terms change', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { version, addVersion } = await offered(insurer);
      const { customer, policy } = await activePolicy(30, insurer);
      await testApp.db.update(policies).set({ productVersionId: version.id }).where(eq(policies.policyNumber, policy.policyNumber));

      expect((await policyView(customer, policy.policyNumber)).renewalProduct).toEqual({
        available: true,
        productVersionId: version.id,
        name: version.name,
        versionNumber: 1,
        termsChanged: false,
      });
      expect(version.name).toMatch(/v1$/);

      const newer = await addVersion(2);
      expect((await policyView(customer, policy.policyNumber)).renewalProduct).toMatchObject({ productVersionId: newer.id, versionNumber: 2, termsChanged: true });
    });

    it('says when the product is no longer offered, and is null for a policy from before product selection', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { version } = await offered(insurer);
      await testApp.db.update(insurerProductVersions).set({ status: 'WITHDRAWN' }).where(eq(insurerProductVersions.id, version.id));
      const withdrawn = await activePolicy(30, insurer);
      await testApp.db.update(policies).set({ productVersionId: version.id }).where(eq(policies.policyNumber, withdrawn.policy.policyNumber));
      expect((await policyView(withdrawn.customer, withdrawn.policy.policyNumber)).renewalProduct).toEqual({
        available: false,
        reason: 'This product is no longer offered. Compare current products to renew.',
      });

      const legacy = await activePolicy(30);
      expect((await policyView(legacy.customer, legacy.policy.policyNumber)).renewalProduct).toBeNull();
    });
    it('takes an owned policy through account read and renewal submission to the selected insurer queue', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { version } = await offered(insurer);
      const previous = await activePolicy(14);
      const owner = await signIn(testApp.http, previous.customer);
      const [accountPolicy] = (await testApp.http.get('/api/v1/policies').set(owner).expect(200)).body;
      const startDate = inDays(15).toISOString();
      const body = {
        vehicleDetails: accountPolicy.vehicleDetails,
        vehicleValue: accountPolicy.vehicleValue,
        vehicleUsage: accountPolicy.vehicleUsage,
        insuranceType: 'Comprehensive',
        coverageDurationId: '4q',
        policyDates: { startDate, endDate: startDate },
        selectedProductVersionIds: [version.id],
        renewalOfPolicyNumber: accountPolicy.policyNumber,
      };
      const submit = (headers: Awaited<ReturnType<typeof signIn>>, key: string) =>
        testApp.http.post('/api/v1/quote-requests').set(headers).set('Idempotency-Key', key).send(body);
      const other = await signIn(testApp.http, await buildCustomer(testApp.db));
      await submit(other, randomUUID()).expect(404);

      const keys = [randomUUID(), randomUUID()];
      const attempts = await Promise.all(keys.map((key) => submit(owner, key)));
      const winners = attempts.flatMap((attempt, index) => attempt.status === 201 ? [index] : []);
      expect(winners).toHaveLength(1);
      const [winner] = winners;
      const requestId = attempts[winner].body.id;
      const duplicate = attempts[1 - winner];
      // PostgreSQL's lock wait can expire on a busy host. Retry that response
      // with the same key after the first transaction has finished.
      if (duplicate.status === 503) expect(duplicate.body.code).toBe('TRY_AGAIN');
      const refusal = duplicate.status === 503 ? await submit(owner, keys[1 - winner]) : duplicate;
      expect([refusal.status, refusal.body.code]).toEqual([409, 'RENEWAL_IN_PROGRESS']);
      expect((await submit(owner, keys[winner]).expect(201)).body.id).toBe(requestId);

      const listed = await testApp.http.get('/api/v1/insurer/quote-requests').set(await signIn(testApp.http, insurer.staff)).expect(200);
      expect(listed.body.find((entry: { id: string }) => entry.id === requestId)?.renewalOf).toMatchObject({
        policyNumber: previous.policy.policyNumber,
        insurer: previous.insurer.insurer.name,
      });
      const renewalView = await policyView(previous.customer, previous.policy.policyNumber);
      expect(renewalView.renewal).toMatchObject({ renewable: false, renewalRequestId: requestId });
      await reminders().run();
      expect(await remindersOf(previous.policy.policyNumber)).toEqual([]);
    });

    it('does not offer renewal or accept a linked request for a cancelled policy', async () => {
      const { policy, customer, insurer } = await activePolicy(14);
      await testApp.db.update(policies).set({ status: 'CANCELLED' }).where(eq(policies.policyNumber, policy.policyNumber));
      const { version } = await offered(insurer);
      const accountPolicy = await policyView(customer, policy.policyNumber);
      expect(accountPolicy.renewal).toMatchObject({ renewable: false, renewalRequestId: null });

      const reply = await testApp.http.post('/api/v1/quote-requests').set(await signIn(testApp.http, customer)).send({
        vehicleDetails: accountPolicy.vehicleDetails,
        vehicleValue: accountPolicy.vehicleValue,
        vehicleUsage: accountPolicy.vehicleUsage,
        insuranceType: 'Comprehensive',
        coverageDurationId: '4q',
        selectedProductVersionIds: [version.id],
        renewalOfPolicyNumber: policy.policyNumber,
      }).expect(409);
      expect(reply.body.code).toBe('POLICY_NOT_RENEWABLE');
    });
  });

  it('gives the customer the value and use the policy was quoted on, so a renewal need not ask again', async () => {
    const { customer, policy, quoteRequest } = await activePolicy(30);
    const view = (await testApp.http.get(`/api/v1/policies/${policy.policyNumber}`).set(await signIn(testApp.http, customer))).body;
    expect(view).toMatchObject({ vehicleValue: quoteRequest.vehicleValueMinor / 100, vehicleUsage: quoteRequest.vehicleUsage });
  });

  it('shows the insurer which policy a renewal request renews', async () => {
    const previous = await activePolicy(20);
    const insurer = await buildInsurer(testApp.db);
    const { quoteRequest } = await buildQuoteRequest(
      testApp.db,
      { customerId: previous.customer.id, insurerIds: [insurer.insurer.id] },
      { renewalOfPolicyNumber: previous.policy.policyNumber },
    );
    const listed = await testApp.http.get('/api/v1/insurer/quote-requests').set(await signIn(testApp.http, insurer.staff));
    const request = listed.body.find((entry: { id: string }) => entry.id === quoteRequest.id);
    expect(request.renewalOf).toEqual({
      policyNumber: previous.policy.policyNumber,
      endDate: expect.any(String),
      insurer: previous.insurer.insurer.name,
    });
    const [stored] = await testApp.db.select({ renewalOfPolicyNumber: quoteRequests.renewalOfPolicyNumber }).from(quoteRequests).where(eq(quoteRequests.id, quoteRequest.id));
    expect(stored.renewalOfPolicyNumber).toBe(previous.policy.policyNumber);
    expect((await testApp.db.select().from(payments).where(eq(payments.quoteRequestId, quoteRequest.id)))).toEqual([]);
  });
});
