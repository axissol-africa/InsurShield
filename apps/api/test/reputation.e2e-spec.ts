import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  insurerReviews,
  insurers,
  platformRuleVersions,
  policies,
  reviewRevisions,
} from '../src/db/schema.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { buildCustomer, buildInsurer, buildPurchasedPolicy, buildStaffUser, type BuiltInsurer } from './builders.js';
import { startApp, type TestApp } from './helpers.js';

const PATH = '/api/v1/insurer-reputation';
const DAY_MS = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY_MS);
const VERSION = 8_180;

describe('Batch 18 verified rating publication', () => {
  let app: TestApp;
  let staffId: string;

  beforeAll(async () => {
    app = await startApp();
    staffId = (await buildStaffUser(app.db, { role: 'ADMIN' })).id;
  });

  afterEach(async () => {
    await app.db.delete(platformRuleVersions).where(eq(platformRuleVersions.createdByStaffId, staffId));
  });

  afterAll(async () => { await app?.close(); });

  async function confirm(key: 'REVIEW_POLICY' | 'REPUTATION_POLICY', effectiveUntil?: Date) {
    await app.db.insert(platformRuleVersions).values({
      key, state: 'CONFIRMED', value: defaultRuleValue(key), versionNumber: VERSION,
      effectiveFrom: ago(1), effectiveUntil, createdByStaffId: staffId, confirmedByStaffId: staffId, confirmedAt: ago(1),
    });
  }

  async function reviewsFor(insurer: BuiltInsurer) {
    const customer = await buildCustomer(app.db);
    return async (rating: number, createdAt = ago(1), status: 'PUBLISHED' | 'PENDING' = 'PUBLISHED') => {
      const { policy } = await buildPurchasedPolicy(app.db, { customer, insurer });
      await app.db.update(policies).set({ status: 'ACTIVE', issuedAt: ago(400) })
        .where(eq(policies.policyNumber, policy.policyNumber));
      const [review] = await app.db.insert(insurerReviews).values({ policyNumber: policy.policyNumber, createdAt }).returning();
      const [revision] = await app.db.insert(reviewRevisions).values({
        reviewId: review.id, version: 1, kind: 'REVIEW', rating, status, text: 'Private fixture text',
        publishedAt: status === 'PUBLISHED' ? ago(0.5) : null,
      }).returning();
      return { review, revision, policy, customer };
    };
  }

  function read(...ids: string[]) {
    return app.http.get(PATH).query({ insurerIds: ids.join(',') });
  }

  it('validates and bounds the batch, then normalises and deduplicates the requested insurer IDs', async () => {
    await app.http.get(PATH).expect(400);
    await read('invalid').expect(400);
    await read(...Array.from({ length: 101 }, () => randomUUID())).expect(400);
    const { insurer } = await buildInsurer(app.db);
    await confirm('REPUTATION_POLICY');
    const { body } = await read(insurer.id.toUpperCase(), randomUUID(), insurer.id).expect(200);
    expect(body.items).toEqual([{ insurerId: insurer.id, rating: null, badges: [] }]);
  });

  it('keeps public ratings off until both methods are approved and hides them when the method expires', async () => {
    const provider = await buildInsurer(app.db);
    await (await reviewsFor(provider))(5);
    await confirm('REVIEW_POLICY');
    expect((await read(provider.insurer.id).expect(200)).body).toEqual({ items: [] });
    await app.db.delete(platformRuleVersions).where(eq(platformRuleVersions.createdByStaffId, staffId));
    await confirm('REPUTATION_POLICY');
    expect((await read(provider.insurer.id).expect(200)).body.items[0].rating).toBeNull();
    await confirm('REVIEW_POLICY');
    expect((await read(provider.insurer.id).expect(200)).body.items[0].rating).toMatchObject({ average: null, reviewCount: 1 });
    await app.db.delete(platformRuleVersions).where(eq(platformRuleVersions.createdByStaffId, staffId));
    await app.db.insert(platformRuleVersions).values({
      key: 'REPUTATION_POLICY', state: 'CONFIRMED', value: defaultRuleValue('REPUTATION_POLICY'), versionNumber: VERSION,
      effectiveFrom: ago(3), effectiveUntil: ago(2), createdByStaffId: staffId, confirmedByStaffId: staffId, confirmedAt: ago(3),
    });
    expect((await read(provider.insurer.id).expect(200)).body).toEqual({ items: [] });
  });

  it('uses the approved revision in the original review window and reacts immediately to withdrawals and publication', async () => {
    await confirm('REVIEW_POLICY');
    await confirm('REPUTATION_POLICY');
    const provider = await buildInsurer(app.db);
    const other = await buildInsurer(app.db);
    const add = await reviewsFor(provider);
    const first = await add(5);
    const second = await add(5);
    for (const rating of [4, 4, 4, 4, 4, 4, 3]) await add(rating);
    await add(5, ago(366));
    await add(5, ago(-1));
    await add(1, ago(1), 'PENDING');
    await (await reviewsFor(other))(1);
    const [replacement] = await app.db.insert(reviewRevisions).values({
      reviewId: first.review.id, version: 2, kind: 'REVIEW', rating: 1, status: 'PENDING',
    }).returning({ id: reviewRevisions.id });
    await app.db.insert(reviewRevisions).values({
      reviewId: first.review.id, version: 1, kind: 'RESPONSE', status: 'PUBLISHED', text: 'Reply', publishedAt: ago(0.5),
    });

    const before = (await read(provider.insurer.id, other.insurer.id).expect(200)).body;
    expect(before.items.map((item: { rating: { reviewCount: number; average: number | null } }) => item.rating))
      .toEqual([
        expect.objectContaining({ reviewCount: 9, average: null, minimumReviews: 10, ruleVersion: VERSION }),
        expect.objectContaining({ reviewCount: 1, average: null }),
      ]);
    expect(JSON.stringify(before)).not.toContain(first.policy.policyNumber);
    expect(JSON.stringify(before)).not.toContain(first.customer.email);
    expect(JSON.stringify(before)).not.toContain('Private fixture text');

    await add(3);
    expect((await read(provider.insurer.id).expect(200)).body.items[0].rating)
      .toMatchObject({ reviewCount: 10, average: 4 });
    const now = new Date();
    await app.db.update(reviewRevisions).set({ status: 'SUPERSEDED', retiredAt: now }).where(eq(reviewRevisions.id, first.revision.id));
    await app.db.update(reviewRevisions).set({ status: 'PUBLISHED', publishedAt: now }).where(eq(reviewRevisions.id, replacement.id));
    expect((await read(provider.insurer.id).expect(200)).body.items[0].rating)
      .toMatchObject({ reviewCount: 10, average: 3.6 });
    await app.db.update(insurerReviews).set({ withdrawnAt: now }).where(eq(insurerReviews.id, second.review.id));
    expect((await read(provider.insurer.id).expect(200)).body.items[0].rating)
      .toMatchObject({ reviewCount: 9, average: null });
    await app.db.update(insurers).set({ status: 'DELETED', deletedAt: now }).where(eq(insurers.id, provider.insurer.id));
    expect((await read(provider.insurer.id).expect(200)).body).toEqual({ items: [] });
  });
});
