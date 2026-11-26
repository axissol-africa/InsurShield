import { and, desc, eq } from 'drizzle-orm';
import { auditLogs, insurerReviews, notifications, platformRuleVersions, policies } from '../src/db/schema.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { buildCustomer, buildInsurer, buildPurchasedPolicy, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

describe('verified policy reviews', () => {
  let app: TestApp;
  let admin: SessionHeaders;
  let adminId: string;
  const base = '/api/v1/reviews';
  const publicPath = (insurerId: string) => base + '/public/' + insurerId;

  beforeAll(async () => {
    app = await startApp();
    const moderator = await buildStaffUser(app.db, { role: 'ADMIN' });
    adminId = moderator.id;
    admin = await signIn(app.http, moderator);
  });

  afterEach(async () => {
    await app.db.delete(platformRuleVersions).where(and(eq(platformRuleVersions.key, 'REVIEW_POLICY'), eq(platformRuleVersions.createdByStaffId, adminId)));
  });

  afterAll(async () => { if (app) await app.close(); });

  async function fixture(issuedAt: Date | null = new Date()) {
    const insurer = await buildInsurer(app.db, { staff: { role: 'INSURER_ADMIN' } });
    const purchase = await buildPurchasedPolicy(app.db, { insurer });
    if (issuedAt) {
      await app.db.update(policies).set({ status: 'ACTIVE', issuedAt })
        .where(eq(policies.policyNumber, purchase.policy.policyNumber));
    }
    return {
      purchase, insurerId: insurer.insurer.id,
      path: base + '/customer/policies/' + purchase.policy.policyNumber,
      owner: await signIn(app.http, purchase.customer),
      insurer: await signIn(app.http, insurer.staff),
    };
  }

  async function confirmRules() {
    const [latest] = await app.db.select({ version: platformRuleVersions.versionNumber })
      .from(platformRuleVersions)
      .where(eq(platformRuleVersions.key, 'REVIEW_POLICY'))
      .orderBy(desc(platformRuleVersions.versionNumber))
      .limit(1);
    await app.db.insert(platformRuleVersions).values({
      key: 'REVIEW_POLICY', versionNumber: (latest?.version ?? 0) + 1, state: 'CONFIRMED', value: defaultRuleValue('REVIEW_POLICY'),
      effectiveFrom: new Date('2020-01-01T00:00:00Z'), createdByStaffId: adminId, confirmedByStaffId: adminId, confirmedAt: new Date(),
    });
  }

  const submit = (path: string, owner: SessionHeaders, text = 'They explained my cover clearly.') =>
    app.http.post(path).set(owner).send({ rating: 5, text });

  const moderate = (reviewId: string, revisionId: string, action = 'PUBLISH', reason = 'APPROVED') =>
    app.http.post(base + '/admin/' + reviewId + '/decisions').set(admin).send({ revisionId, action, reason });

  it('checks verified ownership, issuance and window, validates the input, and creates one review under concurrent submissions', async () => {
    const waiting = await fixture(null);
    const old = await fixture(new Date('2020-01-01T00:00:00Z'));
    for (const f of [waiting, old]) {
      await submit(f.path, f.owner).expect(409);
      expect((await app.http.get(f.path).set(f.owner).expect(200)).body.canSubmit).toBe(false);
    }
    const ready = await fixture();
    const outsider = await signIn(app.http, await buildCustomer(app.db));
    await app.http.get(ready.path).set(outsider).expect(404);
    await submit(ready.path, outsider).expect(404);
    await app.http.post(ready.path).set(ready.owner).send({ rating: 1.5 }).expect(400);
    await app.http.post(ready.path).set(ready.owner).send({ rating: 6 }).expect(400);
    const attempts = await Promise.all([submit(ready.path, ready.owner), submit(ready.path, ready.owner)]);
    expect(attempts.map((r) => r.status).sort((first, second) => first - second)).toEqual([201, 409]);
    expect(await app.db.select().from(insurerReviews)
      .where(eq(insurerReviews.policyNumber, ready.purchase.policy.policyNumber))).toHaveLength(1);
  });

  it('keeps recently issued purchases reviewable after cancellation', async () => {
    const issued = await fixture();
    const unissued = await fixture(null);
    for (const f of [issued, unissued]) {
      await app.db.update(policies).set({ status: 'CANCELLED', cancelledAt: new Date() })
        .where(eq(policies.policyNumber, f.purchase.policy.policyNumber));
    }
    expect((await app.http.get(issued.path).set(issued.owner).expect(200)).body.canSubmit).toBe(true);
    await submit(issued.path, issued.owner).expect(201);
    await submit(unissued.path, unissued.owner).expect(409);
  });

  it('gates publication, hides private fields, retains the approved version through edits and removes both review and response on withdrawal', async () => {
    const f = await fixture();
    const unrelated = await fixture();
    const submitted = (await submit(f.path, f.owner).expect(201)).body.review;
    await moderate(submitted.id, submitted.pending.id).expect(409);
    expect((await app.http.get(publicPath(f.insurerId)).expect(200)).body.items).toEqual([]);
    await confirmRules();
    await moderate(submitted.id, submitted.pending.id).expect(201);
    await moderate(submitted.id, submitted.pending.id).expect(409);
    const published = (await app.http.get(publicPath(f.insurerId)).expect(200)).body.items[0];
    expect(Object.keys(published).sort()).toEqual(['id', 'publishedAt', 'rating', 'response', 'text']);
    expect(published.text).toBe('They explained my cover clearly.');
    expect(published.publishedAt).toMatch(/^\d{4}-\d{2}$/);
    expect(JSON.stringify(published)).not.toContain(f.purchase.customer.email);
    await app.http.put(base + '/insurer/' + submitted.id + '/response').set(unrelated.insurer)
      .send({ text: 'Other insurer' }).expect(404);
    const response = (await app.http.put(base + '/insurer/' + submitted.id + '/response').set(f.insurer)
      .send({ text: 'Thank you for sharing your experience.' }).expect(200)).body;
    expect((await app.http.get(publicPath(f.insurerId)).expect(200)).body.items[0].response).toBeNull();
    await moderate(submitted.id, response.id).expect(201);
    const edited = (await app.http.patch(f.path).set(f.owner).send({ rating: 4, text: 'They also replied quickly.' }).expect(200)).body;
    expect(edited.review.published.rating).toBe(5);
    expect(edited.review.pending.rating).toBe(4);
    await moderate(submitted.id, edited.review.pending.id).expect(201);
    const current = (await app.http.get(publicPath(f.insurerId)).expect(200)).body.items[0];
    expect(current).toMatchObject({ rating: 4, response: { text: 'Thank you for sharing your experience.' } });
    const delivery = await app.db.select().from(notifications).where(eq(notifications.entityId, submitted.id));
    expect(delivery).toHaveLength(4);
    expect(JSON.stringify(delivery)).not.toContain('They also replied quickly.');
    const audit = await app.db.select().from(auditLogs).where(eq(auditLogs.entityId, submitted.id));
    expect(JSON.stringify(audit)).not.toContain('They also replied quickly.');
    await app.http.delete(f.path).set(f.owner).expect(200);
    await app.http.delete(f.path).set(f.owner).expect(200);
    await submit(f.path, f.owner).expect(409);
    expect((await app.http.get(publicPath(f.insurerId)).expect(200)).body.items).toEqual([]);
  });

  it('blocks direct identifiers and gives a private decision reason while the public list stays empty', async () => {
    const f = await fixture();
    await confirmRules();
    const review = (await submit(f.path, f.owner, 'My email is review@example.com.').expect(201)).body.review;
    await moderate(review.id, review.pending.id).expect(400);
    await moderate(review.id, review.pending.id, 'REJECT', 'IDENTIFYING_INFORMATION').expect(201);
    const customer = (await app.http.get(f.path).set(f.owner).expect(200)).body;
    expect(customer.review.pending).toMatchObject({ status: 'REJECTED', reason: 'IDENTIFYING_INFORMATION' });
    expect((await app.http.get(publicPath(f.insurerId)).expect(200)).body.items).toEqual([]);
  });
});
