import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, notInArray } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  claimNotifications,
  inspections,
  insurerContacts,
  insurerEvidence,
  insurerIntegrations,
  insurerQuotes,
  insurers,
  ncdApplications,
  payments,
  policies,
  staffUsers,
} from '../db/schema.js';
import { takesNewBusinessWhere } from '../common/insurer-standing.js';
import type { EvidenceReviewState, InsurerStatus } from '../common/domain/enums.js';

export type NewInsurer = Omit<typeof insurers.$inferInsert, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'status'>;
export type InsurerChanges = Partial<NewInsurer>;
export type NewContact = Omit<typeof insurerContacts.$inferInsert, 'insurerId'>;
export type NewEvidence = typeof insurerEvidence.$inferInsert;
export type EvidenceRow = Awaited<ReturnType<InsurersRepository['findEvidence']>>;
export type NewIntegration = Omit<typeof insurerIntegrations.$inferInsert, 'insurerId' | 'clientSecretEncrypted'>;
export type IntegrationRow = NonNullable<Awaited<ReturnType<InsurersRepository['findIntegration']>>>;
export const DELETION_BLOCKER_KINDS = ['policy', 'claim', 'ncd application', 'inspection', 'payment'] as const;
export type DeletionBlockerKind = (typeof DELETION_BLOCKER_KINDS)[number];

// What an unauthenticated visitor may see; the credentials in insurer_integrations are never selected.
const publicColumns = {
  id: insurers.id,
  name: insurers.name,
  tradingName: insurers.tradingName,
  status: insurers.status,
  rateBps: insurers.rateBps,
  quoteValidityDays: insurers.quoteValidityDays,
  coverage: insurers.coverage,
  plan: insurers.plan,
  website: insurers.website,
  logoUrl: insurers.logoUrl,
  ncdAccepted: insurers.ncdAccepted,
  inspectionRule: insurers.inspectionRule,
  inspectionTiming: insurers.inspectionTiming,
  inspectionMethod: insurers.inspectionMethod,
  icon: insurers.icon,
  isBestValue: insurers.isBestValue,
  benefits: insurers.benefits,
};

const staffColumns = {
  ...publicColumns,
  licenceNumber: insurers.licenceNumber,
  licenceExpiry: insurers.licenceExpiry,
  registrationNumber: insurers.registrationNumber,
  tpin: insurers.tpin,
  effectiveFrom: insurers.effectiveFrom,
  renewalDate: insurers.renewalDate,
  approvedAt: insurers.approvedAt,
  activationConditions: insurers.activationConditions,
};

const evidenceColumns = {
  id: insurerEvidence.id,
  kind: insurerEvidence.kind,
  documentId: insurerEvidence.documentId,
  reference: insurerEvidence.reference,
  expiresAt: insurerEvidence.expiresAt,
  state: insurerEvidence.state,
  reviewedAt: insurerEvidence.reviewedAt,
  note: insurerEvidence.note,
  createdAt: insurerEvidence.createdAt,
};

// The client secret is never selected, as the integration credentials never were.
const integrationColumns = {
  apiBaseUrl: insurerIntegrations.apiBaseUrl,
  publicSigningKey: insurerIntegrations.publicSigningKey,
  clientId: insurerIntegrations.clientId,
  quoteCallbackUrl: insurerIntegrations.quoteCallbackUrl,
  claimsCallbackUrl: insurerIntegrations.claimsCallbackUrl,
  policyCallbackUrl: insurerIntegrations.policyCallbackUrl,
  sandboxMode: insurerIntegrations.sandboxMode,
  activatedAt: insurerIntegrations.activatedAt,
};

const contactColumns = {
  tagline: insurerContacts.tagline,
  contactPerson: insurerContacts.contactPerson,
  role: insurerContacts.role,
  phone: insurerContacts.phone,
  mobile: insurerContacts.mobile,
  whatsapp: insurerContacts.whatsapp,
  email: insurerContacts.email,
  address: insurerContacts.address,
  hours: insurerContacts.hours,
};

type Executor = Database | Transaction;

export type PublicInsurerRow = Awaited<ReturnType<InsurersRepository['listTakingNewBusiness']>>[number];
export type InsurerRow = NonNullable<Awaited<ReturnType<InsurersRepository['find']>>>;
export type ContactRow = NonNullable<InsurerRow['contact']>;

@Injectable()
export class InsurersRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async listTakingNewBusiness(now: Date) {
    return this.db
      .select({ ...publicColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(and(...takesNewBusinessWhere(now)))
      .orderBy(asc(insurers.name));
  }

  async listNotDeleted() {
    return this.db
      .select({ ...staffColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(ne(insurers.status, 'DELETED'))
      .orderBy(asc(insurers.name));
  }

  /** Deleted insurers stay out of the normal admin list until a super admin asks to restore one. */
  async listDeleted() {
    return this.db
      .select({ ...staffColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(eq(insurers.status, 'DELETED'))
      .orderBy(asc(insurers.name));
  }

  async find(id: string, executor: Executor = this.db) {
    const [row] = await executor
      .select({ ...staffColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(eq(insurers.id, id));
    return row;
  }

  /** Locks the insurer before an audited lifecycle or profile change. */
  async lock(tx: Transaction, id: string) {
    const [row] = await tx
      .select({ ...staffColumns, contact: contactColumns })
      .from(insurers)
      .leftJoin(insurerContacts, eq(insurerContacts.insurerId, insurers.id))
      .where(eq(insurers.id, id))
      .for('update', { of: insurers });
    return row;
  }

  // ── The onboarding record ───────────────────────────────────────

  /** What the activation rule needs to judge, in the order a reviewer reads it. */
  evidenceOf(insurerId: string, executor: Executor = this.db) {
    return executor
      .select({ ...evidenceColumns, reviewedByName: staffUsers.fullName })
      .from(insurerEvidence)
      .leftJoin(staffUsers, eq(staffUsers.id, insurerEvidence.reviewedBy))
      .where(eq(insurerEvidence.insurerId, insurerId))
      .orderBy(asc(insurerEvidence.kind), asc(insurerEvidence.createdAt));
  }

  async insertEvidence(tx: Transaction, evidence: NewEvidence) {
    const [created] = await tx.insert(insurerEvidence).values(evidence).returning(evidenceColumns);
    return created;
  }

  /** Scoped by insurer as well as id, so one insurer's review cannot touch another's. */
  async reviewEvidence(
    tx: Transaction,
    evidenceId: string,
    insurerId: string,
    review: { state: EvidenceReviewState; reviewedBy: string; reviewedAt: Date; note: string | null },
  ) {
    const [reviewed] = await tx
      .update(insurerEvidence)
      .set({ ...review, updatedAt: review.reviewedAt })
      .where(and(eq(insurerEvidence.id, evidenceId), eq(insurerEvidence.insurerId, insurerId)))
      .returning(evidenceColumns);
    return reviewed;
  }

  async findEvidence(insurerId: string, evidenceId: string, executor: Executor = this.db) {
    const [found] = await executor
      .select({ ...evidenceColumns, reviewedByName: staffUsers.fullName })
      .from(insurerEvidence)
      .leftJoin(staffUsers, eq(staffUsers.id, insurerEvidence.reviewedBy))
      .where(and(eq(insurerEvidence.id, evidenceId), eq(insurerEvidence.insurerId, insurerId)));
    return found;
  }

  /** One row per insurer, replaced whole: a technical model is captured, not patched. */
  async saveIntegration(tx: Transaction, insurerId: string, model: NewIntegration) {
    const [saved] = await tx
      .insert(insurerIntegrations)
      .values({ ...model, insurerId })
      .onConflictDoUpdate({
        target: insurerIntegrations.insurerId,
        set: { ...model, updatedAt: new Date() },
      })
      .returning(integrationColumns);
    return saved;
  }

  findIntegration(insurerId: string, executor: Executor = this.db) {
    return executor
      .select(integrationColumns)
      .from(insurerIntegrations)
      .where(eq(insurerIntegrations.insurerId, insurerId))
      .then((rows) => rows[0]);
  }

  async insert(tx: Transaction, insurer: NewInsurer, contact: NewContact): Promise<InsurerRow> {
    const [row] = await tx.insert(insurers).values(insurer).returning(staffColumns);
    const [stored] = await tx
      .insert(insurerContacts)
      .values({ ...contact, insurerId: row.id })
      .returning(contactColumns);
    return { ...row, contact: stored };
  }

  /** Changes an insurer that is not deleted; undefined when there is none. */
  async update(tx: Transaction, id: string, changes: InsurerChanges & { status?: InsurerStatus; deletedAt?: Date | null }) {
    const [row] = await tx
      .update(insurers)
      .set({ ...changes, updatedAt: new Date() })
      .where(and(eq(insurers.id, id), ne(insurers.status, 'DELETED')))
      .returning(staffColumns);
    return row;
  }

  /**
   * Restore only the currently deleted record. The condition makes concurrent
   * restores deterministic: exactly one request changes its state.
   */
  async restoreDeleted(tx: Transaction, id: string) {
    const [row] = await tx
      .update(insurers)
      .set({ status: 'INACTIVE', deletedAt: null, updatedAt: new Date() })
      .where(and(eq(insurers.id, id), eq(insurers.status, 'DELETED')))
      .returning(staffColumns);
    return row;
  }

  /** Writes the fields given; on an existing contact, fields left undefined keep their value. */
  async upsertContact(tx: Transaction, insurerId: string, contact: NewContact): Promise<ContactRow> {
    const [row] = await tx
      .insert(insurerContacts)
      .values({ ...contact, insurerId })
      .onConflictDoUpdate({ target: insurerContacts.insurerId, set: contact })
      .returning(contactColumns);
    return row;
  }

  async findContact(tx: Transaction, insurerId: string): Promise<ContactRow | null> {
    const [row] = await tx.select(contactColumns).from(insurerContacts).where(eq(insurerContacts.insurerId, insurerId));
    return row ?? null;
  }

  /**
   * A soft-deleted insurer can no longer sign in, so it cannot be left with
   * customer work that its staff still need to service. Historical completed
   * NCD and inspection records do not block the transition; active policy and
   * claim records do because the current schema has no terminal state for them.
   */
  async deletionBlockers(tx: Transaction, insurerId: string): Promise<DeletionBlockerKind[]> {
    const [policy, claim, ncd, inspection, payment] = await Promise.all([
      tx.select({ id: policies.policyNumber }).from(policies).where(eq(policies.insurerId, insurerId)).limit(1),
      tx
        .select({ id: claimNotifications.claimNumber })
        .from(claimNotifications)
        .where(eq(claimNotifications.insurerId, insurerId))
        .limit(1),
      tx
        .select({ id: ncdApplications.id })
        .from(ncdApplications)
        .where(
          and(
            eq(ncdApplications.insurerId, insurerId),
            inArray(ncdApplications.status, ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED']),
          ),
        )
        .limit(1),
      tx
        .select({ id: inspections.id })
        .from(inspections)
        .where(
          and(
            eq(inspections.insurerId, insurerId),
            notInArray(inspections.status, ['COMPLETED', 'APPROVED', 'FAILED']),
          ),
        )
        .limit(1),
      tx
        .select({ id: payments.id })
        .from(payments)
        .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
        .where(and(eq(insurerQuotes.insurerId, insurerId), eq(payments.status, 'PENDING')))
        .limit(1),
    ]);
    return [
      ...(policy.length ? ['policy' as const] : []),
      ...(claim.length ? ['claim' as const] : []),
      ...(ncd.length ? ['ncd application' as const] : []),
      ...(inspection.length ? ['inspection' as const] : []),
      ...(payment.length ? ['payment' as const] : []),
    ];
  }
}
