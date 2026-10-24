import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, ne, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  claimAttachments,
  claimNotifications,
  customers,
  documents,
  inspectionShots,
  insurerQuotes,
  insurers,
  ncdApplications,
  ncdCodes,
  payments,
  policies,
  quoteRequestRecipients,
  quoteRequests,
  vehicles,
} from '../db/schema.js';
import type { NcdStatus } from '../common/domain/enums.js';

export type NewInsurerQuote = typeof insurerQuotes.$inferInsert;
export type NewNcdCode = typeof ncdCodes.$inferInsert;

const replyColumns = {
  premiumMinor: insurerQuotes.premiumMinor,
  notes: insurerQuotes.notes,
  insurerReference: insurerQuotes.insurerReference,
  validityDays: insurerQuotes.validityDays,
  sentAt: insurerQuotes.sentAt,
  validUntil: insurerQuotes.validUntil,
  extendedAt: insurerQuotes.extendedAt,
  documentId: insurerQuotes.documentId,
};

const extensionColumns = {
  premiumMinor: insurerQuotes.premiumMinor,
  validityDays: insurerQuotes.validityDays,
  validUntil: insurerQuotes.validUntil,
  extendedAt: insurerQuotes.extendedAt,
};

const acknowledgementColumns = {
  claimNumber: claimNotifications.claimNumber,
  status: claimNotifications.status,
  receivedAt: claimNotifications.receivedAt,
  insurerClaimReference: claimNotifications.insurerClaimReference,
};

const decisionColumns = {
  id: ncdApplications.id,
  status: ncdApplications.status,
  decidedAt: ncdApplications.decidedAt,
};

/** Every query takes the insurer the caller acts for and reaches only that insurer's rows. */
@Injectable()
export class InsurerPortalRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  // ── Quote requests ──────────────────────────────────────────────

  /** Requests delivered to the insurer, newest first, each with the insurer's own reply when there is one. */
  listRequests(insurerId: string) {
    return this.db
      .select({
        id: quoteRequests.id,
        status: quoteRequests.status,
        deliveryStatus: quoteRequestRecipients.status,
        submittedAt: quoteRequests.submittedAt,
        expiresAt: quoteRequests.expiresAt,
        vehicleValueMinor: quoteRequests.vehicleValueMinor,
        vehicleUsage: quoteRequests.vehicleUsage,
        insuranceType: quoteRequests.insuranceType,
        coverageDuration: quoteRequests.coverageDuration,
        policyStartDate: quoteRequests.policyStartDate,
        policyEndDate: quoteRequests.policyEndDate,
        coverageDays: quoteRequests.coverageDays,
        photosCapturedAt: quoteRequests.photosCapturedAt,
        customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
        vehicle: {
          plateNumber: vehicles.plateNumber,
          make: vehicles.make,
          model: vehicles.model,
          year: vehicles.year,
          chassisNumber: vehicles.chassisNumber,
        },
        reply: replyColumns,
      })
      .from(quoteRequestRecipients)
      .innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestRecipients.quoteRequestId))
      .innerJoin(customers, eq(customers.id, quoteRequests.customerId))
      .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
      .leftJoin(
        insurerQuotes,
        and(eq(insurerQuotes.quoteRequestId, quoteRequests.id), eq(insurerQuotes.insurerId, insurerId)),
      )
      .where(eq(quoteRequestRecipients.insurerId, insurerId))
      .orderBy(desc(quoteRequests.submittedAt), asc(quoteRequests.id));
  }

  /** The shots of those requests that were sent to the insurer. */
  shotKeys(insurerId: string, quoteRequestIds: string[]) {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({ quoteRequestId: inspectionShots.quoteRequestId, shotKey: inspectionShots.shotKey })
      .from(inspectionShots)
      .innerJoin(
        quoteRequestRecipients,
        and(
          eq(quoteRequestRecipients.quoteRequestId, inspectionShots.quoteRequestId),
          eq(quoteRequestRecipients.insurerId, insurerId),
        ),
      )
      .where(inArray(inspectionShots.quoteRequestId, quoteRequestIds))
      .orderBy(asc(inspectionShots.capturedAt), asc(inspectionShots.id));
  }

  /**
   * Locks the insurer's delivery of the request, so its final quotes are decided one at a time. Undefined when the
   * request was not sent to the insurer.
   */
  async lockDelivery(tx: Transaction, quoteRequestId: string, insurerId: string) {
    const [delivery] = await tx
      .select({
        status: quoteRequests.status,
        expiresAt: quoteRequests.expiresAt,
        quoteValidityDays: insurers.quoteValidityDays,
      })
      .from(quoteRequestRecipients)
      .innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestRecipients.quoteRequestId))
      .innerJoin(insurers, eq(insurers.id, quoteRequestRecipients.insurerId))
      .where(
        and(eq(quoteRequestRecipients.quoteRequestId, quoteRequestId), eq(quoteRequestRecipients.insurerId, insurerId)),
      )
      .for('update', { of: quoteRequestRecipients });
    return delivery;
  }

  async hasQuote(quoteRequestId: string, insurerId: string, tx: Database | Transaction = this.db): Promise<boolean> {
    const [quote] = await tx
      .select({ id: insurerQuotes.id })
      .from(insurerQuotes)
      .where(and(eq(insurerQuotes.quoteRequestId, quoteRequestId), eq(insurerQuotes.insurerId, insurerId)));
    return quote !== undefined;
  }

  async insertQuote(tx: Transaction, quote: NewInsurerQuote) {
    const [created] = await tx.insert(insurerQuotes).values(quote).returning(replyColumns);
    return created;
  }

  /** False when the request was marked expired meanwhile. */
  async markQuoted(tx: Transaction, quoteRequestId: string, insurerId: string, acknowledgedAt: Date): Promise<boolean> {
    const quoted = await tx
      .update(quoteRequests)
      .set({ status: 'QUOTED' })
      .where(and(eq(quoteRequests.id, quoteRequestId), ne(quoteRequests.status, 'EXPIRED')))
      .returning({ id: quoteRequests.id });
    if (quoted.length !== 1) return false;
    await tx
      .update(quoteRequestRecipients)
      .set({ status: 'ACKNOWLEDGED', acknowledgedAt })
      .where(
        and(eq(quoteRequestRecipients.quoteRequestId, quoteRequestId), eq(quoteRequestRecipients.insurerId, insurerId)),
      );
    return true;
  }

  /** Extends the insurer's quote unless it expired before `now`; undefined when nothing was extended. */
  async extendOpenQuote(quoteRequestId: string, insurerId: string, extraDays: number, now: Date) {
    const [extended] = await this.db
      .update(insurerQuotes)
      .set({
        validUntil: sql`${insurerQuotes.validUntil} + make_interval(secs => ${extraDays * 86_400})`,
        validityDays: sql`${insurerQuotes.validityDays} + ${extraDays}`,
        extendedAt: now,
      })
      .where(
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestId),
          eq(insurerQuotes.insurerId, insurerId),
          gte(insurerQuotes.validUntil, now),
        ),
      )
      .returning(extensionColumns);
    return extended;
  }

  // ── Paid policies ───────────────────────────────────────────────

  listPolicies(insurerId: string) {
    return this.db
      .select({
        policyNumber: policies.policyNumber,
        insurerPolicyNumber: policies.insurerPolicyNumber,
        status: policies.status,
        coverage: policies.coverage,
        plan: policies.plan,
        premiumMinor: policies.premiumMinor,
        policyStartDate: policies.policyStartDate,
        policyEndDate: policies.policyEndDate,
        quoteRequestId: policies.quoteRequestId,
        insurerQuoteReference: policies.insurerQuoteReference,
        quoteDocumentId: policies.quoteDocumentId,
        certificateDocumentId: policies.certificateDocumentId,
        receivedAt: policies.receivedAt,
        issuedAt: policies.issuedAt,
        customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
        vehicle: { plateNumber: vehicles.plateNumber, make: vehicles.make, model: vehicles.model, year: vehicles.year },
        payment: {
          transactionId: payments.transactionId,
          status: payments.status,
          method: payments.method,
          amountMinor: payments.amountMinor,
          currency: payments.currency,
          confirmedAt: payments.confirmedAt,
        },
      })
      .from(policies)
      .innerJoin(customers, eq(customers.id, policies.customerId))
      .innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
      .innerJoin(payments, eq(payments.id, policies.paymentId))
      .where(eq(policies.insurerId, insurerId))
      .orderBy(desc(policies.receivedAt), asc(policies.policyNumber));
  }

  /** Locks the insurer's policy, so its certificate is issued once. Undefined when the insurer has no such policy. */
  async lockPolicy(tx: Transaction, policyNumber: string, insurerId: string) {
    const [policy] = await tx
      .select({ status: policies.status })
      .from(policies)
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.insurerId, insurerId)))
      .for('update');
    return policy;
  }

  /** Undefined unless the policy was still awaiting its certificate. */
  async activatePolicy(
    tx: Transaction,
    policyNumber: string,
    insurerId: string,
    issue: { certificateDocumentId: string; insurerPolicyNumber: string | null; issuedAt: Date },
  ) {
    const [activated] = await tx
      .update(policies)
      .set({ ...issue, status: 'ACTIVE' })
      .where(
        and(
          eq(policies.policyNumber, policyNumber),
          eq(policies.insurerId, insurerId),
          eq(policies.status, 'AWAITING_INSURER_CERTIFICATE'),
        ),
      )
      .returning({
        policyNumber: policies.policyNumber,
        insurerPolicyNumber: policies.insurerPolicyNumber,
        status: policies.status,
        issuedAt: policies.issuedAt,
      });
    return activated;
  }

  // ── Claims ──────────────────────────────────────────────────────

  listClaims(insurerId: string) {
    return this.db
      .select()
      .from(claimNotifications)
      .where(eq(claimNotifications.insurerId, insurerId))
      .orderBy(desc(claimNotifications.submittedAt), asc(claimNotifications.claimNumber));
  }

  /** The attachments of those claims that were sent to the insurer, in upload order. */
  attachmentIds(insurerId: string, claimNumbers: string[]) {
    if (claimNumbers.length === 0) return Promise.resolve([]);
    return this.db
      .select({ claimNumber: claimAttachments.claimNumber, documentId: claimAttachments.documentId })
      .from(claimAttachments)
      .innerJoin(
        claimNotifications,
        and(
          eq(claimNotifications.claimNumber, claimAttachments.claimNumber),
          eq(claimNotifications.insurerId, insurerId),
        ),
      )
      .innerJoin(documents, eq(documents.id, claimAttachments.documentId))
      .where(inArray(claimAttachments.claimNumber, claimNumbers))
      .orderBy(asc(documents.uploadedAt), asc(documents.id));
  }

  /** Undefined unless the claim was still waiting to be acknowledged. */
  async acknowledgeClaim(
    claimNumber: string,
    insurerId: string,
    receipt: { receivedAt: Date; insurerClaimReference?: string },
  ) {
    const [acknowledged] = await this.db
      .update(claimNotifications)
      .set({ ...receipt, status: 'RECEIVED_BY_INSURER' })
      .where(
        and(
          eq(claimNotifications.claimNumber, claimNumber),
          eq(claimNotifications.insurerId, insurerId),
          eq(claimNotifications.status, 'NOTIFIED'),
        ),
      )
      .returning(acknowledgementColumns);
    return acknowledged;
  }

  async findAcknowledgement(claimNumber: string, insurerId: string) {
    const [claim] = await this.db
      .select(acknowledgementColumns)
      .from(claimNotifications)
      .where(and(eq(claimNotifications.claimNumber, claimNumber), eq(claimNotifications.insurerId, insurerId)));
    return claim;
  }

  // ── No-claim discount ───────────────────────────────────────────

  listNcdApplications(insurerId: string) {
    return this.db
      .select({
        id: ncdApplications.id,
        applicationNumber: ncdApplications.applicationNumber,
        policyNumber: ncdApplications.policyNumber,
        fullName: ncdApplications.fullName,
        phone: ncdApplications.phone,
        yearsClaimFree: ncdApplications.yearsClaimFree,
        status: ncdApplications.status,
        approvedCode: ncdApplications.approvedCodeId,
        submittedAt: ncdApplications.submittedAt,
        decidedAt: ncdApplications.decidedAt,
      })
      .from(ncdApplications)
      .where(eq(ncdApplications.insurerId, insurerId))
      .orderBy(desc(ncdApplications.submittedAt), asc(ncdApplications.id));
  }

  /** Locks the insurer's application, so it is decided one request at a time. */
  async lockNcdApplication(tx: Transaction, applicationId: string, insurerId: string) {
    const [application] = await tx
      .select({
        applicationNumber: ncdApplications.applicationNumber,
        status: ncdApplications.status,
        yearsClaimFree: ncdApplications.yearsClaimFree,
      })
      .from(ncdApplications)
      .where(and(eq(ncdApplications.id, applicationId), eq(ncdApplications.insurerId, insurerId)))
      .for('update');
    return application;
  }

  /** False when the code is already taken; the transaction carries on unharmed either way. */
  async insertNcdCode(tx: Transaction, code: NewNcdCode): Promise<boolean> {
    const inserted = await tx
      .insert(ncdCodes)
      .values(code)
      .onConflictDoNothing({ target: ncdCodes.code })
      .returning({ code: ncdCodes.code });
    return inserted.length === 1;
  }

  /** Undefined unless the application still had the status `from`. */
  async decideNcdApplication(
    tx: Transaction,
    applicationId: string,
    insurerId: string,
    from: NcdStatus,
    decision: { status: NcdStatus; decidedAt: Date | null; approvedCodeId?: string },
  ) {
    const [decided] = await tx
      .update(ncdApplications)
      .set(decision)
      .where(
        and(
          eq(ncdApplications.id, applicationId),
          eq(ncdApplications.insurerId, insurerId),
          eq(ncdApplications.status, from),
        ),
      )
      .returning(decisionColumns);
    return decided;
  }
}
