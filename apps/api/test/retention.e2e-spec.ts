import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { RetentionRepository } from '../src/retention/retention.repository.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { buildClaim, buildCustomer, buildDocument, buildPurchasedPolicy, buildStaffUser, unique } from './builders.js';
import { applyMigrationFiles, createScratchDatabase, type ScratchDatabase } from './scratch-database.js';

let scratch: ScratchDatabase;
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let repository: RetentionRepository;
const now = new Date();
const old = new Date(now.getTime() - 3000 * 86_400_000);
const days = defaultRuleValue('DOCUMENT_RETENTION').daysByClass;

beforeAll(async () => {
  scratch = await createScratchDatabase('retention');
  const client = await scratch.connect();
  try { await applyMigrationFiles(client); } finally { await client.end(); }
  pool = new Pool(scratch.config);
  db = drizzle({ client: pool, schema });
  repository = new RetentionRepository(db);
});
afterAll(async () => { await pool?.end(); await scratch?.drop(); });

async function closedPurchase() {
  const built = await buildPurchasedPolicy(db, { customer: await buildCustomer(db, { userId: null }) });
  await db.update(schema.policies).set({ status: 'CANCELLED' }).where(eq(schema.policies.policyNumber, built.policy.policyNumber));
  await db.update(schema.payments).set({ status: 'REVERSED' }).where(eq(schema.payments.id, built.payment.id));
  await db.update(schema.documents).set({ uploadedAt: old }).where(eq(schema.documents.id, built.quotation.id));
  return built;
}
const claim = (id: string) => repository.transaction((tx) => repository.claimDocument(tx, id, days, now));

it('Retention retains a historical reference and tombstone while deleting eligible metadata once', async () => {
  const built = await closedPurchase();
  expect(await claim(built.quotation.id)).not.toBeNull();
  expect(await repository.transaction((tx) => repository.finishDocument(tx, built.quotation.id, now))).toBe(true);
  expect(await repository.transaction((tx) => repository.finishDocument(tx, built.quotation.id, now))).toBe(false);
  expect(await claim(built.quotation.id)).toBeNull();
  const [policy] = await db.select().from(schema.policies).where(eq(schema.policies.policyNumber, built.policy.policyNumber));
  const [document] = await db.select().from(schema.documents).where(eq(schema.documents.id, built.quotation.id));
  expect(policy.quoteDocumentId).toBe(document.id);
  expect(document).toMatchObject({ deletedAt: now, fileName: 'Deleted document', checksumSha256: null, kind: 'QUOTATION', uploadedAt: old });
});

it('releases the aged evidence hold only when the claim is closed', async () => {
  const { customer, insurer, policy } = await closedPurchase();
  const record = await buildClaim(db, { customerId: customer.id, insurerId: insurer.insurer.id, policyNumber: policy.policyNumber });
  const evidence = await buildDocument(db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT', uploadedAt: old });
  await db.insert(schema.claimAttachments).values({ claimNumber: record.claimNumber, documentId: evidence.id });
  expect(await claim(evidence.id)).toBeNull();
  await db.update(schema.claimNotifications).set({ status: 'DECLINED' }).where(eq(schema.claimNotifications.claimNumber, record.claimNumber));
  expect(await claim(evidence.id)).toBeNull();
  await db.update(schema.claimNotifications).set({ status: 'CLOSED' }).where(eq(schema.claimNotifications.claimNumber, record.claimNumber));
  expect(await claim(evidence.id)).not.toBeNull();
  expect(await db.select().from(schema.claimAttachments).where(eq(schema.claimAttachments.claimNumber, record.claimNumber))).toHaveLength(1);
});

it('Retention holds awaiting issuance, live cover through the final Lusaka day, and unsettled payments', async () => {
  const built = await closedPurchase();
  await db.update(schema.policies).set({ status: 'AWAITING_INSURER_CERTIFICATE' }).where(eq(schema.policies.policyNumber, built.policy.policyNumber));
  expect(await claim(built.quotation.id)).toBeNull();
  await db.update(schema.policies).set({ status: 'ACTIVE', policyEndDate: new Date(`${new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka' }).format(now)}T00:00:00+02:00`) }).where(eq(schema.policies.policyNumber, built.policy.policyNumber));
  expect(await claim(built.quotation.id)).toBeNull();
  await db.update(schema.policies).set({ status: 'CANCELLED' }).where(eq(schema.policies.policyNumber, built.policy.policyNumber));
  for (const status of ['INITIATED', 'PENDING', 'CONFIRMED'] as const) {
    await db.update(schema.payments).set({ status }).where(eq(schema.payments.id, built.payment.id));
    expect(await claim(built.quotation.id)).toBeNull();
  }
});

it('Retention holds open claims, service requests and reconciliation, including indirectly owned staff uploads', async () => {
  const built = await closedPurchase();
  const reference = unique('SR');
  await db.insert(schema.serviceRequests).values({ reference, customerId: built.customer.id, insurerId: built.insurer.insurer.id, policyNumber: built.policy.policyNumber, type: 'ASSISTANCE', reason: 'Please help with this policy' });
  expect(await claim(built.quotation.id)).toBeNull();
  await db.update(schema.serviceRequests).set({ status: 'WITHDRAWN' }).where(eq(schema.serviceRequests.reference, reference));
  const [item] = await db.insert(schema.reconciliationItems).values({ kind: 'REFUND_REQUIRED', paymentId: built.payment.id, reason: 'Refund review', evidenceDocumentIds: [built.quotation.id] }).returning();
  expect(await claim(built.quotation.id)).toBeNull();
  await db.update(schema.reconciliationItems).set({ status: 'RESOLVED', outcome: 'NO_ACTION', resolutionNote: 'No action needed', resolvedAt: now, resolvedByStaffId: built.insurer.staff.id }).where(eq(schema.reconciliationItems.id, item.id));
  await buildClaim(db, { customerId: built.customer.id, insurerId: built.insurer.insurer.id, policyNumber: built.policy.policyNumber });
  expect(await claim(built.quotation.id)).toBeNull();
});

it('Retention prevents new holds and attachments after durable intent, and resumes the same object on retry', async () => {
  const built = await closedPurchase();
  expect(await claim(built.quotation.id)).toMatchObject({ storageKey: built.quotation.storageKey });
  await expect(db.update(schema.payments).set({ status: 'PENDING' }).where(eq(schema.payments.id, built.payment.id))).rejects.toThrow();
  await expect(db.update(schema.policies).set({ certificateDocumentId: built.quotation.id }).where(eq(schema.policies.policyNumber, built.policy.policyNumber))).rejects.toThrow();
  expect(await claim(built.quotation.id)).toMatchObject({ storageKey: built.quotation.storageKey });
});

it('Retention skips a document when a competing owner hold has the fence, then observes that committed hold', async () => {
  const built = await closedPurchase();
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 16))', [built.customer.id]);
    expect(await claim(built.quotation.id)).toBeNull();
    await connection.query('UPDATE payments SET status = $1 WHERE id = $2', ['PENDING', built.payment.id]);
    await connection.query('COMMIT');
    expect(await claim(built.quotation.id)).toBeNull();
  } finally { await connection.query('ROLLBACK'); connection.release(); }
});

it('Retention filters holds before the candidate limit', async () => {
  const built = await closedPurchase();
  await db.update(schema.payments).set({ status: 'PENDING' }).where(eq(schema.payments.id, built.payment.id));
  await db.insert(schema.documents).values(Array.from({ length: 501 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`, kind: 'QUOTATION' as const,
    fileName: 'held.pdf', mimeType: 'application/pdf', sizeBytes: 1, storageKey: unique('held'),
    retentionClass: 'POLICY_EVIDENCE' as const, uploadedAt: old, uploadedByCustomerId: built.customer.id,
  })));
  const customer = await buildCustomer(db, { userId: null });
  const document = await buildDocument(db, { customerId: customer.id }, { uploadedAt: old });
  expect((await repository.documentCandidates(days, now)).map((row) => row.id)).toContain(document.id);
});

it('Retention anonymises closed accounts once, retains regulatory records and cascades sign-in removal', async () => {
  const customer = await buildCustomer(db, { deletedAt: old });
  const document = await buildDocument(db, { customerId: customer.id });
  await db.insert(schema.consentRecords).values({ customerId: customer.id, privacyVersion: '1', termsVersion: '1' });
  const cutoff = new Date(now.getTime() - 2555 * 86_400_000);
  expect(await repository.transaction((tx) => repository.anonymise(tx, customer.id, cutoff, now))).toBe(true);
  expect(await repository.transaction((tx) => repository.anonymise(tx, customer.id, cutoff, now))).toBe(false);
  const [retained] = await db.select().from(schema.customers).where(eq(schema.customers.id, customer.id));
  expect(retained).toMatchObject({ fullName: 'Closed account', userId: null, anonymisedAt: now });
  expect(await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, customer.userId!))).toHaveLength(0);
  expect(await db.select().from(schema.authAccounts).where(eq(schema.authAccounts.userId, customer.userId!))).toHaveLength(0);
  expect(await db.select().from(schema.consentRecords).where(eq(schema.consentRecords.customerId, customer.id))).toHaveLength(1);
  expect(await db.select().from(schema.documents).where(eq(schema.documents.id, document.id))).toHaveLength(1);
});

it('Retention does not remove a shared staff identity', async () => {
  const customer = await buildCustomer(db, { deletedAt: old });
  await buildStaffUser(db, { userId: customer.userId, withMfa: false });
  expect(await repository.transaction((tx) => repository.anonymise(tx, customer.id, now, now))).toBe(false);
  expect(await db.select().from(schema.authUsers).where(eq(schema.authUsers.id, customer.userId!))).toHaveLength(1);
});
