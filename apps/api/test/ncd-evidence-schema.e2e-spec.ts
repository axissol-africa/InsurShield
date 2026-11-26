import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../src/db/schema.js';
import { DocumentsRepository } from '../src/documents/documents.repository.js';
import { RetentionRepository } from '../src/retention/retention.repository.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { buildCustomer, buildDocument, buildInsurer, buildNcdCode, buildPurchasedPolicy, buildStaffUser } from './builders.js';
import { buildNcdApplication } from './builders/customer.js';
import { applyMigrationFiles, createScratchDatabase, type ScratchDatabase } from './scratch-database.js';

let scratch: ScratchDatabase;
let pool: Pool;
let db: ReturnType<typeof drizzle<typeof schema>>;
let documents: DocumentsRepository;
let retention: RetentionRepository;
const now = new Date();
const old = new Date(now.getTime() - 3000 * 86_400_000);
const days = defaultRuleValue('DOCUMENT_RETENTION').daysByClass;
beforeAll(async () => {
  scratch = await createScratchDatabase('ncd_evidence');
  const client = await scratch.connect();
  try { await applyMigrationFiles(client); } finally { await client.end(); }
  pool = new Pool(scratch.config);
  db = drizzle({ client: pool, schema });
  documents = new DocumentsRepository(db);
  retention = new RetentionRepository(db);
});
afterAll(async () => { await pool?.end(); await scratch?.drop(); });

async function fixture() {
  const customer = await buildCustomer(db);
  const insurer = await buildInsurer(db);
  const application = await buildNcdApplication(db, { customerId: customer.id, insurerId: insurer.insurer.id });
  const document = await buildDocument(db, { staffId: insurer.staff.id }, { kind: 'NCD_EVIDENCE', uploadedAt: old });
  await db.insert(schema.ncdEvidence).values({ applicationId: application.id, documentId: document.id, verificationRevision: 0 });
  return { customer, insurer, application, document };
}
const claim = (id: string) => db.transaction((tx) => retention.claimDocument(tx, id, days, now));

it('grants owner and assigned insurer access, refuses unrelated readers, and detects an existing reference', async () => {
  const { customer, insurer, document } = await fixture();
  const other = await buildCustomer(db);
  const otherInsurer = await buildInsurer(db);
  for (const [reader, allowed] of [[customer, true], [other, false]] as const) {
    const row = await documents.findVisibleTo({ kind: 'customer', id: reader.id, email: reader.email, emailVerified: true }, document.id);
    expect(row?.id).toBe(allowed ? document.id : undefined);
  }
  for (const [reader, allowed] of [[insurer, true], [otherInsurer, false]] as const) {
    const member = await buildStaffUser(db, { role: 'INSURER_USER', insurerId: reader.insurer.id });
    const row = await documents.findVisibleTo({ kind: 'staff', id: member.id, email: member.email, role: 'INSURER_USER', insurerId: reader.insurer.id }, document.id);
    expect(row?.id).toBe(allowed ? document.id : undefined);
  }
  expect(await db.transaction((tx) => documents.referencedIds(tx, [document.id]))).toEqual(new Set([document.id]));
  expect((await documents.listForCustomer(customer.id)).map((row) => row.id)).toContain(document.id);
});

it('keeps legacy bindings null and evidence single use with historical FK protection', async () => {
  const { application, document } = await fixture();
  expect(application).toMatchObject({ sourcePolicyNumber: null, sourceVehicleId: null, declarationAcceptedAt: null, declarationVersion: null, verificationRevision: 0 });
  await expect(db.insert(schema.ncdEvidence).values({ applicationId: application.id, documentId: document.id, verificationRevision: 1 })).rejects.toThrow();
  await expect(db.delete(schema.ncdApplications).where(eq(schema.ncdApplications.id, application.id))).rejects.toThrow();
  await expect(db.delete(schema.documents).where(eq(schema.documents.id, document.id))).rejects.toThrow();
});

it.each(['APPROVED', 'REJECTED'] as const)('holds evidence throughout review and releases it after %s without removing history', async (status) => {
  const { application, document } = await fixture();
  for (const open of ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'] as const) {
    await db.update(schema.ncdApplications).set({ status: open }).where(eq(schema.ncdApplications.id, application.id));
    expect(await claim(document.id)).toBeNull();
  }
  await db.update(schema.ncdApplications).set({ status }).where(eq(schema.ncdApplications.id, application.id));
  expect(await claim(document.id)).not.toBeNull();
  await expect(db.update(schema.ncdApplications).set({ status: 'UNDER_REVIEW' }).where(eq(schema.ncdApplications.id, application.id))).rejects.toThrow();
  expect(await db.select().from(schema.ncdEvidence).where(eq(schema.ncdEvidence.documentId, document.id))).toHaveLength(1);
});

it('refuses attachments after deletion intent and preserves direct uploaded document ownership', async () => {
  const { customer, application } = await fixture();
  const document = await buildDocument(db, { customerId: customer.id }, { kind: 'NCD_EVIDENCE', uploadedAt: old });
  await db.update(schema.ncdApplications).set({ status: 'REJECTED' }).where(eq(schema.ncdApplications.id, application.id));
  expect(await documents.findVisibleTo({ kind: 'customer', id: customer.id, email: customer.email, emailVerified: true }, document.id)).toBeDefined();
  expect(await claim(document.id)).not.toBeNull();
  await expect(db.insert(schema.ncdEvidence).values({ applicationId: application.id, documentId: document.id, verificationRevision: 0 })).rejects.toThrow();
});

it('reserves a code once across open payments, releasing the unique slot on a terminal status', async () => {
  const first = await buildPurchasedPolicy(db);
  const second = await buildPurchasedPolicy(db);
  const code = await buildNcdCode(db, { insurerId: first.insurer.insurer.id });
  expect(first.payment.reservedNcdCode).toBeNull();
  await db.update(schema.payments).set({ status: 'PENDING', reservedNcdCode: code.code }).where(eq(schema.payments.id, first.payment.id));
  await expect(db.update(schema.payments).set({ status: 'INITIATED', reservedNcdCode: code.code }).where(eq(schema.payments.id, second.payment.id))).rejects.toThrow();
  await db.update(schema.payments).set({ status: 'FAILED' }).where(eq(schema.payments.id, first.payment.id));
  await db.update(schema.payments).set({ status: 'INITIATED', reservedNcdCode: code.code }).where(eq(schema.payments.id, second.payment.id));
});

it('seeds the NCD workflow messages in both channels using only the insurer variable', async () => {
  const rows = await db.select().from(schema.notificationTemplates);
  for (const key of ['ncd.submitted', 'ncd.review_started', 'ncd.verification_requested', 'ncd.evidence_submitted']) {
    const templates = rows.filter((row) => row.key === key);
    expect(templates.map((row) => row.channel).sort((a, b) => a.localeCompare(b))).toEqual(['EMAIL', 'IN_APP']);
    for (const template of templates) {
      expect(template.body.match(/{{.*?}}/g)).toEqual(['{{insurer}}']);
      expect(template.body).toContain('Sign in');
    }
  }
});

it('requires NCD read permission for a same-insurer reader but preserves an independent policy relation', async () => {
  const { customer, insurer, document } = await fixture();
  const member = await buildStaffUser(db, { role: 'QUOTE_OFFICER', insurerId: insurer.insurer.id });
  const principal = { kind: 'staff' as const, id: member.id, email: member.email, role: member.role, insurerId: member.insurerId };
  expect(await documents.findVisibleTo(principal, document.id)).toBeUndefined();
  const purchase = await buildPurchasedPolicy(db, { customer, insurer });
  await db.update(schema.policies).set({ quoteDocumentId: document.id }).where(eq(schema.policies.policyNumber, purchase.policy.policyNumber));
  expect((await documents.findVisibleTo(principal, document.id))?.id).toBe(document.id);
});

it('stores exact insurer quote NCD percentages, accepting null and boundaries only within 0..100', async () => {
  const purchase = await buildPurchasedPolicy(db);
  const quoteId = purchase.payment.insurerQuoteId;
  for (const percentage of [null, 0, 37, 100]) {
    const [quote] = await db.update(schema.insurerQuotes).set({ ncdPercentage: percentage })
      .where(eq(schema.insurerQuotes.id, quoteId)).returning();
    expect(quote.ncdPercentage).toBe(percentage);
  }
  for (const percentage of [-1, 101]) {
    await expect(db.update(schema.insurerQuotes).set({ ncdPercentage: percentage })
      .where(eq(schema.insurerQuotes.id, quoteId))).rejects.toThrow();
  }
});
