import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import { defaultRuleValue } from '../settings/domain/rules.js';
import { RetentionRepository } from '../retention/retention.repository.js';
import { buildCustomer, buildPurchasedPolicy, buildStaffUser } from '../../test/builders.js';
import { applyMigrationFiles, createScratchDatabase, type ScratchDatabase } from '../../test/scratch-database.js';
import { ReviewAppealsRepository } from './review-appeals.repository.js';
import { ReviewAppealsService } from './review-appeals.service.js';

let scratch: ScratchDatabase;
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: ReviewAppealsRepository;
let retention: RetentionRepository;
let service: ReviewAppealsService;
const now = new Date('2035-01-01T12:00:00Z');
const old = new Date('2030-01-01T12:00:00Z');
const settings = { effective: vi.fn(async () => ({ provisional: false, value: defaultRuleValue('REVIEW_POLICY') })) };
const notifications = { notify: vi.fn() };

beforeAll(async () => {
  scratch = await createScratchDatabase('appeals');
  const client = await scratch.connect();
  try { await applyMigrationFiles(client); } finally { await client.end(); }
  pool = new Pool(scratch.config);
  db = drizzle({ client: pool, schema });
  repository = new ReviewAppealsRepository(db);
  retention = new RetentionRepository(db);
  service = new ReviewAppealsService(repository, settings as never, new AuditService(db), notifications as never);
});
afterAll(async () => { await pool?.end(); await scratch?.drop(); });

async function fixture(at = now) {
  const purchase = await buildPurchasedPolicy(db, { customer: await buildCustomer(db, { userId: null }) });
  const moderator = await buildStaffUser(db, { userId: null });
  const reviewer = await buildStaffUser(db, { userId: null });
  const [review] = await db.insert(schema.insurerReviews).values({ policyNumber: purchase.policy.policyNumber, createdAt: at }).returning();
  const [revision] = await db.insert(schema.reviewRevisions).values({ reviewId: review.id, kind: 'REVIEW', version: 1, status: 'REJECTED', rating: 3, text: 'Service could be clearer.', retiredAt: at, createdAt: at }).returning();
  const [decision] = await db.insert(schema.reviewDecisions).values({ revisionId: revision.id, action: 'REJECT', reason: 'MODERATION', moderatorId: moderator.id, createdAt: at }).returning();
  const customer: Principal = { kind: 'customer', id: purchase.customer.id, email: purchase.customer.email, emailVerified: true };
  const admin: Principal = { kind: 'staff', id: reviewer.id, email: reviewer.email, role: 'ADMIN', insurerId: null };
  return { ...purchase, review, revision, decision, customer, admin, moderator };
}
const purge = (id: string) => retention.transaction((tx) => retention.purgeReview(tx, id, now, 365, 30));

it('scopes joins and private appeal text by owner and party', async () => {
  const f = await fixture();
  const other = await fixture();
  await expect(service.create({ decisionId: f.decision.id, reason: 'Private reason' }, other.customer, 'CUSTOMER', now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  const appeal = await service.create({ decisionId: f.decision.id, reason: 'Private reason', evidence: 'Private evidence' }, f.customer, 'CUSTOMER', now);
  expect(await service.list(other.customer, 'CUSTOMER')).toEqual([]);
  expect(await service.list({ kind: 'staff', id: f.insurer.staff.id, email: f.insurer.staff.email, role: 'INSURER_ADMIN', insurerId: f.insurer.insurer.id }, 'INSURER')).toEqual([]);
  expect(await service.list(f.customer, 'CUSTOMER')).toEqual([expect.objectContaining({ id: appeal.id, evidence: 'Private evidence' })]);
  const audit = await db.select().from(schema.auditLogs).where(eq(schema.auditLogs.entityId, appeal.id));
  expect(JSON.stringify(audit)).not.toContain('Private evidence');
});

it('serializes duplicate appeals under the parent lock', async () => {
  const f = await fixture();
  let unlock!: () => void;
  let locked!: () => void;
  let secondAttempt!: () => void;
  const gate = new Promise<void>((resolve) => { unlock = resolve; });
  const acquired = new Promise<void>((resolve) => { locked = resolve; });
  const attempted = new Promise<void>((resolve) => { secondAttempt = resolve; });
  const original = repository.lockReview.bind(repository);
  let transactions = 0;
  const originalTransaction = repository.transaction.bind(repository);
  const transactionSpy = vi.spyOn(repository, 'transaction').mockImplementation((work) => {
    if (++transactions === 2) secondAttempt();
    return originalTransaction(work);
  });
  let calls = 0;
  const spy = vi.spyOn(repository, 'lockReview').mockImplementation(async (tx, id) => {
    const ordinal = ++calls;
    const row = await original(tx, id);
    if (ordinal === 1) { locked(); await gate; }
    return row;
  });
  try {
    const first = service.create({ decisionId: f.decision.id, reason: 'First' }, f.customer, 'CUSTOMER', now);
    await acquired;
    const second = service.create({ decisionId: f.decision.id, reason: 'Second' }, f.customer, 'CUSTOMER', now);
    const results = Promise.allSettled([first, second]);
    await attempted;
    unlock();
    expect((await results).map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await service.list(f.customer, 'CUSTOMER')).toHaveLength(1);
  } finally { unlock(); spy.mockRestore(); transactionSpy.mockRestore(); }
});

it('restores only with an independent moderator and preserves auditable decisions', async () => {
  const f = await fixture();
  const appeal = await service.create({ decisionId: f.decision.id, reason: 'Please reconsider' }, f.customer, 'CUSTOMER', now);
  await expect(service.resolve(appeal.id, { outcome: 'OVERTURNED', reason: 'Valid criticism' }, { ...f.admin, id: f.moderator.id }, now)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await service.resolve(appeal.id, { outcome: 'OVERTURNED', reason: 'Valid criticism' }, f.admin, new Date(now.getTime() + 1000))).toMatchObject({ applied: true });
  const [revision] = await db.select().from(schema.reviewRevisions).where(eq(schema.reviewRevisions.id, f.revision.id));
  expect(revision.status).toBe('PUBLISHED');
  expect(await db.select().from(schema.reviewDecisions).where(eq(schema.reviewDecisions.revisionId, f.revision.id))).toHaveLength(2);
});

it('refuses an appeal marked decided without a valid outcome', async () => {
  const f = await fixture();
  await expect(db.insert(schema.reviewAppeals).values({
    decisionId: f.decision.id, party: 'CUSTOMER', reason: 'Private reason', dueAt: '2035-01-15',
    decidedAt: now, decidedBy: f.admin.id, outcomeReason: 'A decision was recorded.',
  })).rejects.toMatchObject({ cause: { code: '23514', constraint: 'review_appeals_outcome_check' } });
});

it('holds private content for open appeals, legal holds, and the latest closure trigger, then purges only private fields', async () => {
  const f = await fixture(old);
  const appeal = await service.create({ decisionId: f.decision.id, reason: 'Private reason', evidence: 'Private evidence' }, f.customer, 'CUSTOMER', old);
  expect(await purge(f.review.id)).toEqual({ revisions: 0, appeals: 0 });
  await service.resolve(appeal.id, { outcome: 'UPHELD', reason: 'Private explanation' }, f.admin, now);
  expect(await purge(f.review.id)).toEqual({ revisions: 0, appeals: 0 });
  await db.update(schema.reviewAppeals).set({ decidedAt: old }).where(eq(schema.reviewAppeals.id, appeal.id));
  await service.legalHold(f.review.id, true, f.admin, now);
  expect(await purge(f.review.id)).toEqual({ revisions: 0, appeals: 0 });
  await service.legalHold(f.review.id, false, f.admin, now);
  expect(await purge(f.review.id)).toEqual({ revisions: 1, appeals: 1 });
  expect(await purge(f.review.id)).toEqual({ revisions: 0, appeals: 0 });
  const [purged] = await db.select().from(schema.reviewAppeals).where(eq(schema.reviewAppeals.id, appeal.id));
  expect(purged).toMatchObject({ reason: null, evidence: null, outcomeReason: 'Private content expired', outcome: 'UPHELD', purgedAt: now });
  expect(await db.select().from(schema.reviewDecisions).where(eq(schema.reviewDecisions.id, f.decision.id))).toHaveLength(1);
});

it('retains published and pending text while purging a retired revision', async () => {
  const f = await fixture(old);
  await db.insert(schema.reviewRevisions).values([
    { reviewId: f.review.id, kind: 'REVIEW', version: 2, status: 'PUBLISHED', rating: 4, text: 'Published', publishedAt: old, createdAt: old },
    { reviewId: f.review.id, kind: 'REVIEW', version: 3, status: 'PENDING', rating: 5, text: 'Pending', createdAt: old },
  ]);
  expect(await purge(f.review.id)).toEqual({ revisions: 1, appeals: 0 });
  const revisions = await repository.transaction((tx) => repository.revisions(tx, f.review.id));
  expect(revisions.find((row) => row.version === 2)?.text).toBe('Published');
  expect(revisions.find((row) => row.version === 3)?.text).toBe('Pending');
  expect(revisions.find((row) => row.version === 1)).toMatchObject({ rating: null, text: null, purgedAt: now });
});

it('expires a reply hidden by removal of its parent review', async () => {
  const f = await fixture(old);
  await db.update(schema.reviewRevisions).set({ status: 'PUBLISHED', publishedAt: old, retiredAt: null })
    .where(eq(schema.reviewRevisions.id, f.revision.id));
  const [reply] = await db.insert(schema.reviewRevisions).values({
    reviewId: f.review.id, kind: 'RESPONSE', version: 1, status: 'PUBLISHED',
    text: 'A published reply', publishedAt: old, createdAt: old,
  }).returning();
  await db.insert(schema.reviewRevisions).values({
    reviewId: f.review.id, kind: 'RESPONSE', version: 2, status: 'PENDING',
    text: 'A pending reply', createdAt: old,
  });
  expect(await purge(f.review.id)).toEqual({ revisions: 0, appeals: 0 });
  expect(await retention.reviewCandidates(now, 365, 30)).not.toContainEqual({ id: f.review.id });
  await db.update(schema.reviewRevisions).set({ status: 'REMOVED', retiredAt: old })
    .where(eq(schema.reviewRevisions.id, f.revision.id));
  expect(await retention.reviewCandidates(now, 365, 30)).toContainEqual({ id: f.review.id });
  expect(await purge(f.review.id)).toEqual({ revisions: 3, appeals: 0 });
  const [retired] = await db.select().from(schema.reviewRevisions).where(eq(schema.reviewRevisions.id, reply.id));
  expect(retired).toMatchObject({ status: 'REMOVED', text: null, purgedAt: now });
});

it('purge waits for a concurrent legal hold and rechecks it after the parent lock', async () => {
  const f = await fixture(old);
  let release!: () => void;
  let locked!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const acquired = new Promise<void>((resolve) => { locked = resolve; });
  const original = repository.setHold.bind(repository);
  const spy = vi.spyOn(repository, 'setHold').mockImplementation(async (...args) => {
    await original(...args);
    locked();
    await gate;
  });
  try {
    const hold = service.legalHold(f.review.id, true, f.admin, now);
    await acquired;
    const purging = purge(f.review.id);
    release();
    await hold;
    expect(await purging).toEqual({ revisions: 0, appeals: 0 });
    const [revision] = await db.select().from(schema.reviewRevisions).where(eq(schema.reviewRevisions.id, f.revision.id));
    expect(revision.text).toBe('Service could be clearer.');
  } finally { release(); spy.mockRestore(); }
});


it('leaves the appeal open when restoration would bypass provisional policy or identifying-text moderation', async () => {
  const f = await fixture();
  const appeal = await service.create({ decisionId: f.decision.id, reason: 'Please reconsider' }, f.customer, 'CUSTOMER', now);
  settings.effective.mockResolvedValueOnce({ provisional: true, value: defaultRuleValue('REVIEW_POLICY') });
  await expect(service.resolve(appeal.id, { outcome: 'OVERTURNED', reason: 'Reconsidered' }, f.admin, now)).rejects.toMatchObject({ code: 'REVIEW_POLICY_PROVISIONAL' });
  await db.update(schema.reviewRevisions).set({ text: 'Contact me at private@example.invalid' }).where(eq(schema.reviewRevisions.id, f.revision.id));
  await expect(service.resolve(appeal.id, { outcome: 'OVERTURNED', reason: 'Reconsidered' }, f.admin, now)).rejects.toMatchObject({ code: 'REVIEW_IDENTIFYING_INFORMATION' });
  const [record] = await db.select().from(schema.reviewAppeals).where(eq(schema.reviewAppeals.id, appeal.id));
  const [revision] = await db.select().from(schema.reviewRevisions).where(eq(schema.reviewRevisions.id, f.revision.id));
  expect(record.decidedAt).toBeNull();
  expect(revision.status).toBe('REJECTED');
  expect(await db.select().from(schema.reviewDecisions).where(eq(schema.reviewDecisions.revisionId, f.revision.id))).toHaveLength(1);
});
