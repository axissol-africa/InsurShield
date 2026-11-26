import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { RetentionRepository } from '../src/retention/retention.repository.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { buildClaim, buildDocument, buildInspection, buildPurchasedPolicy, buildQuoteRequest } from './builders.js';
import { buildInspectionPhoto, buildInspectionShot } from './builders/documents.js';
import { applyMigrationFiles, createScratchDatabase, type ScratchDatabase } from './scratch-database.js';

let scratch: ScratchDatabase;
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
const now = new Date();
const old = new Date(now.getTime() - 4000 * 86_400_000);
beforeAll(async () => {
  scratch = await createScratchDatabase('later_inspection');
  const client = await scratch.connect();
  try { await applyMigrationFiles(client); } finally { await client.end(); }
  pool = new Pool(scratch.config);
  db = drizzle({ client: pool, schema });
});
afterAll(async () => { await pool?.end(); await scratch?.drop(); });

async function fixture() {
  const purchase = await buildPurchasedPolicy(db);
  const input = { customerId: purchase.customer.id, insurerId: purchase.insurer.insurer.id };
  const claim = await buildClaim(db, { ...input, policyNumber: purchase.policy.policyNumber });
  const paid = { purpose: 'AFTER_PAYMENT' as const, policyNumber: purchase.policy.policyNumber, method: 'PHYSICAL' as const, stage: 'AFTER_PAYMENT' as const };
  const loss = { purpose: 'CLAIM_ASSESSMENT' as const, policyNumber: purchase.policy.policyNumber, claimNumber: claim.claimNumber, method: 'PHYSICAL' as const };
  return { purchase, input, claim, paid, loss };
}

it('enforces purpose-specific links, including missing stage and forbidden purchase quote links', async () => {
  const { purchase, input, paid, loss } = await fixture();
  for (const invalid of [
    { ...paid, policyNumber: null }, { ...paid, method: null }, { ...paid, stage: null },
    { ...paid, stage: 'BEFORE_PAYMENT' as const }, { ...paid, claimNumber: loss.claimNumber },
    { ...paid, quoteRequestId: purchase.quoteRequest.id }, { ...loss, claimNumber: null },
    { ...loss, stage: 'AFTER_PAYMENT' as const }, { ...loss, quoteRequestId: purchase.quoteRequest.id },
    { purpose: 'GENERAL' as const, policyNumber: paid.policyNumber },
  ]) {
    await expect(buildInspection(db, input, invalid)).rejects.toMatchObject({ cause: { constraint: 'inspections_later_links_check' } });
  }
  await expect(buildInspection(db, { ...input, insurerId: null }, paid)).rejects.toMatchObject({ cause: { constraint: 'inspections_later_links_check' } });
  expect((await buildInspection(db, input, paid)).quoteRequestId).toBeNull();
  expect((await buildInspection(db, input, loss)).stage).toBeNull();
  expect(await buildInspection(db, input)).toMatchObject({ policyNumber: null, claimNumber: null });
});

it('allows one paid root, one successor per later inspection, and one open assessment per claim', async () => {
  const { input, paid, loss } = await fixture();
  const root = await buildInspection(db, input, paid);
  await expect(buildInspection(db, input, paid)).rejects.toMatchObject({ cause: { constraint: 'inspections_policy_root_key' } });
  await buildInspection(db, input, { ...paid, predecessorId: root.id });
  await expect(buildInspection(db, input, { ...paid, predecessorId: root.id })).rejects.toMatchObject({ cause: { constraint: 'inspections_later_successor_key' } });
  const claimInspection = await buildInspection(db, input, loss);
  await expect(buildInspection(db, input, loss)).rejects.toMatchObject({ cause: { constraint: 'inspections_open_claim_key' } });
  await db.update(schema.inspections).set({ status: 'FAILED' }).where(eq(schema.inspections.id, claimInspection.id));
  await buildInspection(db, input, { ...loss, predecessorId: claimInspection.id });
});

it('makes later photos append-only without preventing earlier inspection photo edits', async () => {
  const { input, paid } = await fixture();
  const inspection = await buildInspection(db, input, paid);
  const { photo } = await buildInspectionPhoto(db, { inspectionId: inspection.id, uploader: { customerId: input.customerId } });
  await expect(db.update(schema.inspectionPhotos).set({ slot: 'changed' }).where(eq(schema.inspectionPhotos.id, photo.id))).rejects.toThrow();
  await expect(db.delete(schema.inspectionPhotos).where(eq(schema.inspectionPhotos.id, photo.id))).rejects.toThrow();
  await expect(db.delete(schema.inspections).where(eq(schema.inspections.id, inspection.id))).rejects.toThrow();
  await expect(db.update(schema.inspections).set({ purpose: 'GENERAL', policyNumber: null }).where(eq(schema.inspections.id, inspection.id))).rejects.toThrow();
  const general = await buildInspection(db, input);
  const earlier = await buildInspectionPhoto(db, { inspectionId: general.id, uploader: { customerId: input.customerId } });
  await db.update(schema.inspectionPhotos).set({ slot: 'changed' }).where(eq(schema.inspectionPhotos.id, earlier.photo.id));
  await db.delete(schema.inspectionPhotos).where(eq(schema.inspectionPhotos.id, earlier.photo.id));
});

it('keeps one report per inspection and one inspection per report document, with restrictive history references', async () => {
  const { input, paid, loss } = await fixture();
  const first = await buildInspection(db, input, paid);
  const second = await buildInspection(db, input, loss);
  const document = await buildDocument(db, { customerId: input.customerId }, { kind: 'INSPECTION_REPORT', retentionClass: 'POLICY_EVIDENCE' });
  const [report] = await db.insert(schema.inspectionReports).values({ inspectionId: first.id, documentId: document.id }).returning();
  expect(report.createdAt).toBeInstanceOf(Date);
  await expect(db.insert(schema.inspectionReports).values({ inspectionId: second.id, documentId: document.id })).rejects.toThrow();
  const other = await buildDocument(db, { customerId: input.customerId });
  await expect(db.insert(schema.inspectionReports).values({ inspectionId: first.id, documentId: other.id })).rejects.toThrow();
  await expect(db.delete(schema.documents).where(eq(schema.documents.id, document.id))).rejects.toThrow();
  await expect(db.delete(schema.inspections).where(eq(schema.inspections.id, first.id))).rejects.toThrow();
});

it('holds claim reports and photos until claim closure, resolves report owners, and fences deleted documents', async () => {
  const { purchase, input, claim, loss } = await fixture();
  await db.update(schema.policies).set({ status: 'CANCELLED' }).where(eq(schema.policies.policyNumber, purchase.policy.policyNumber));
  await db.update(schema.payments).set({ status: 'REVERSED' }).where(eq(schema.payments.id, purchase.payment.id));
  const inspection = await buildInspection(db, input, { ...loss, status: 'FAILED' });
  const report = await buildDocument(db, { staffId: purchase.insurer.staff.id }, { kind: 'CLAIM_ATTACHMENT', uploadedAt: old });
  const photo = await buildDocument(db, { staffId: purchase.insurer.staff.id }, { kind: 'CLAIM_ATTACHMENT', uploadedAt: old });
  await db.insert(schema.inspectionReports).values({ inspectionId: inspection.id, documentId: report.id });
  await db.insert(schema.inspectionPhotos).values({ inspectionId: inspection.id, documentId: photo.id, slot: 'damage' });
  expect(report.retentionClass).toBe('CLAIM_EVIDENCE');
  const owners = await pool.query('SELECT public.retention_document_owners($1::uuid) AS owner', [report.id]);
  expect(owners.rows).toContainEqual({ owner: input.customerId });
  const retention = new RetentionRepository(db);
  const collect = (id: string) => db.transaction((tx) => retention.claimDocument(tx, id, defaultRuleValue('DOCUMENT_RETENTION').daysByClass, now));
  for (const document of [report, photo]) expect(await collect(document.id)).toBeNull();
  await db.update(schema.claimNotifications).set({ status: 'CLOSED' }).where(eq(schema.claimNotifications.claimNumber, claim.claimNumber));
  for (const document of [report, photo]) expect(await collect(document.id)).not.toBeNull();
  const another = await buildInspection(db, input);
  await expect(db.insert(schema.inspectionReports).values({ inspectionId: another.id, documentId: photo.id })).rejects.toThrow();
});

it('protects purchased quote shots while preserving edits on unpurchased quotes', async () => {
  const { purchase, input } = await fixture();
  const purchased = await buildInspectionShot(db, { quoteRequestId: purchase.quoteRequest.id, uploader: { customerId: input.customerId } });
  await expect(db.update(schema.inspectionShots).set({ capturedAt: old }).where(eq(schema.inspectionShots.id, purchased.shot.id))).rejects.toThrow();
  await expect(db.delete(schema.inspectionShots).where(eq(schema.inspectionShots.id, purchased.shot.id))).rejects.toThrow();
  // A linked policy still protects the original evidence after a reversal.
  await db.update(schema.payments).set({ status: 'REVERSED' }).where(eq(schema.payments.id, purchase.payment.id));
  await expect(db.delete(schema.inspectionShots).where(eq(schema.inspectionShots.id, purchased.shot.id))).rejects.toThrow();
  const quote = await buildQuoteRequest(db, { customerId: input.customerId, insurerIds: [input.insurerId] });
  const editable = await buildInspectionShot(db, { quoteRequestId: quote.quoteRequest.id, uploader: { customerId: input.customerId } });
  await db.update(schema.inspectionShots).set({ capturedAt: old }).where(eq(schema.inspectionShots.id, editable.shot.id));
  await db.delete(schema.inspectionShots).where(eq(schema.inspectionShots.id, editable.shot.id));
});

it('seeds the required inspection notice for both channels with the agreed placeholders', async () => {
  const rows = await db.select().from(schema.notificationTemplates).where(eq(schema.notificationTemplates.key, 'inspection.required'));
  expect(rows.map((row) => row.channel).sort((a, b) => a.localeCompare(b))).toEqual(['EMAIL', 'IN_APP']);
  for (const row of rows) {
    expect(row.mandatory).toBe(true);
    expect(row.body.match(/{{.*?}}/g)).toEqual(['{{reference}}', '{{purpose}}']);
  }
});

it('seeds mandatory report-publication notices using only the reference placeholder', async () => {
  const rows = await db.select().from(schema.notificationTemplates).where(eq(schema.notificationTemplates.key, 'inspection.report_ready'));
  expect(rows.map((row) => row.channel).sort((a, b) => a.localeCompare(b))).toEqual(['EMAIL', 'IN_APP']);
  for (const row of rows) {
    expect(row.mandatory).toBe(true);
    expect(row.body.match(/{{.*?}}/g)).toEqual(['{{reference}}']);
  }
});
