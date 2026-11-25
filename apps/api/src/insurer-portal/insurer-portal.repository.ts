import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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
  quoteRequestProductVersions,
  quoteRequestRecipients,
  quoteSelections,
  quoteRequests,
  reconciliationItems,
  staffUsers,
  vehicles,
} from '../db/schema.js';
import type { NcdStatus } from '../common/domain/enums.js';

export type NewInsurerQuote = typeof insurerQuotes.$inferInsert;
export type NewNcdCode = typeof ncdCodes.$inferInsert;

const replyColumns = {
  id: insurerQuotes.id,
  quoteRequestId: insurerQuotes.quoteRequestId,
  insurerId: insurerQuotes.insurerId,
  productVersionId: insurerQuotes.productVersionId,
  premiumMinor: insurerQuotes.premiumMinor,
  notes: insurerQuotes.notes,
  insurerReference: insurerQuotes.insurerReference,
  validityDays: insurerQuotes.validityDays,
  sentAt: insurerQuotes.sentAt,
  validUntil: insurerQuotes.validUntil,
  extendedAt: insurerQuotes.extendedAt,
  documentId: insurerQuotes.documentId,
  componentsMinor: insurerQuotes.componentsMinor,
  excessMinor: insurerQuotes.excessMinor,
  addOns: insurerQuotes.addOns,
  conditions: insurerQuotes.conditions,
};

const extensionColumns = {
  id: insurerQuotes.id,
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
  // Who to tell. `toAcknowledgement` maps field by field, so this does not
  // reach the response.
  customerId: claimNotifications.customerId,
};

const decisionColumns = {
  id: ncdApplications.id,
  status: ncdApplications.status,
  decidedAt: ncdApplications.decidedAt,
};

/** Every query takes the insurer the caller acts for and reaches only that insurer's rows. */
/** The policy a renewal request renews, and who insured it. */
const previousPolicies = alias(policies, 'previous_policies');
const previousInsurers = alias(insurers, 'previous_insurers');

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
        model: quoteRequests.model,
        status: quoteRequests.status,
        deliveryStatus: quoteRequestRecipients.status,
        submittedAt: quoteRequests.submittedAt,
        expiresAt: quoteRequests.expiresAt,
        vehicleValueMinor: quoteRequests.vehicleValueMinor,
        vehicleUsage: quoteRequests.vehicleUsage,
        insuranceType: quoteRequests.insuranceType,
        coverageDuration: quoteRequests.coverageDuration,
        cancelledAt: quoteRequestRecipients.cancelledAt,
        policyStartDate: quoteRequests.policyStartDate,
        policyEndDate: quoteRequests.policyEndDate,
        coverageDays: quoteRequests.coverageDays,
        photosCapturedAt: quoteRequests.photosCapturedAt,
        whiteBookDocumentId: quoteRequests.whiteBookDocumentId,
        customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
        vehicle: {
          plateNumber: vehicles.plateNumber,
          make: vehicles.make,
          model: vehicles.model,
          year: vehicles.year,
          chassisNumber: vehicles.chassisNumber,
        },
        reply: replyColumns,
        renewalOf: { policyNumber: previousPolicies.policyNumber, endDate: previousPolicies.policyEndDate, insurerName: previousInsurers.name },
      })
      .from(quoteRequestRecipients)
      .innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestRecipients.quoteRequestId))
      .innerJoin(customers, eq(customers.id, quoteRequests.customerId))
      .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
      .leftJoin(previousPolicies, eq(previousPolicies.policyNumber, quoteRequests.renewalOfPolicyNumber))
      .leftJoin(previousInsurers, eq(previousInsurers.id, previousPolicies.insurerId))
      .leftJoin(
        insurerQuotes,
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequests.id),
          eq(insurerQuotes.insurerId, insurerId),
          isNull(insurerQuotes.productVersionId),
          eq(insurerQuotes.status, 'ACTIVE'),
        ),
      )
      .where(eq(quoteRequestRecipients.insurerId, insurerId))
      .orderBy(desc(quoteRequests.submittedAt), asc(quoteRequests.id));
  }

  /**
   * A recipient is a delivery address, not a quote. One insurer may therefore
   * receive several selected products and issue one final quote per version.
   */
  selectedProductsForRequests(insurerId: string, quoteRequestIds: string[]) {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        quoteRequestId: quoteRequestProductVersions.quoteRequestId,
        productVersionId: quoteRequestProductVersions.productVersionId,
        productCode: quoteRequestProductVersions.productCode,
        productVersionNumber: quoteRequestProductVersions.productVersionNumber,
        productName: quoteRequestProductVersions.productName,
        coverType: quoteRequestProductVersions.coverType,
        coverGuide: quoteRequestProductVersions.coverGuide,
        inspectionRule: quoteRequestProductVersions.inspectionRule,
        inspectionTiming: quoteRequestProductVersions.inspectionTiming,
        inspectionMethod: quoteRequestProductVersions.inspectionMethod,
        cancelledAt: quoteRequestProductVersions.cancelledAt,
        status: quoteRequestProductVersions.status,
        replyDueAt: quoteRequestProductVersions.replyDueAt,
        pausedAt: quoteRequestProductVersions.pausedAt,
        declineReasonCode: quoteRequestProductVersions.declineReasonCode,
        declineCustomerNote: quoteRequestProductVersions.declineCustomerNote,
        priority: quoteRequestProductVersions.priority,
        owner: { id: staffUsers.id, fullName: staffUsers.fullName },
        reply: replyColumns,
      })
      .from(quoteRequestProductVersions)
      .leftJoin(staffUsers, eq(staffUsers.id, quoteRequestProductVersions.assignedStaffId))
      .leftJoin(
        insurerQuotes,
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestProductVersions.quoteRequestId),
          eq(insurerQuotes.productVersionId, quoteRequestProductVersions.productVersionId),
          eq(insurerQuotes.insurerId, insurerId),
          eq(insurerQuotes.status, 'ACTIVE'),
        ),
      )
      .where(
        and(
          eq(quoteRequestProductVersions.insurerId, insurerId),
          inArray(quoteRequestProductVersions.quoteRequestId, quoteRequestIds),
        ),
      )
      .orderBy(asc(quoteRequestProductVersions.productName), asc(quoteRequestProductVersions.productVersionNumber));
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
        model: quoteRequests.model,
        expiresAt: quoteRequests.expiresAt,
        quoteValidityDays: insurers.quoteValidityDays,
        vehicleValueMinor: quoteRequests.vehicleValueMinor,
        coverageDuration: quoteRequests.coverageDuration,
        // Who to tell, and whose name to tell them, when the quote lands.
        customerId: quoteRequests.customerId,
        insurerName: insurers.name,
        cancelledAt: quoteRequestRecipients.cancelledAt,
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

  /** Held shared until `tx` ends, so the insurer's standing cannot change under the write. */
  async insurerStanding(tx: Transaction, insurerId: string) {
    const [standing] = await tx
      .select({ name: insurers.name, status: insurers.status, licenceExpiry: insurers.licenceExpiry })
      .from(insurers)
      .where(eq(insurers.id, insurerId))
      .for('share');
    return standing;
  }

  /**
   * Whether these records exist for anybody, asked only after a scoped lookup
   * found nothing, so a reach into another insurer's records can be told from a
   * mistyped reference. The answer never reaches the caller: the response is
   * the same either way, and only the audit differs.
   */
  async quoteRequestExists(id: string, tx: Database | Transaction = this.db): Promise<boolean> {
    const [found] = await tx.select({ id: quoteRequests.id }).from(quoteRequests).where(eq(quoteRequests.id, id));
    return found !== undefined;
  }

  async policyExists(policyNumber: string, tx: Database | Transaction = this.db): Promise<boolean> {
    const [found] = await tx
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.policyNumber, policyNumber));
    return found !== undefined;
  }

  async claimExists(claimNumber: string, tx: Database | Transaction = this.db): Promise<boolean> {
    const [found] = await tx
      .select({ claimNumber: claimNotifications.claimNumber })
      .from(claimNotifications)
      .where(eq(claimNotifications.claimNumber, claimNumber));
    return found !== undefined;
  }

  async ncdApplicationExists(id: string, tx: Database | Transaction = this.db): Promise<boolean> {
    const [found] = await tx
      .select({ id: ncdApplications.id })
      .from(ncdApplications)
      .where(eq(ncdApplications.id, id));
    return found !== undefined;
  }

  async hasQuote(
    quoteRequestId: string,
    insurerId: string,
    productVersionId: string | null,
    tx: Database | Transaction = this.db,
  ): Promise<boolean> {
    const [quote] = await tx
      .select({ id: insurerQuotes.id })
      .from(insurerQuotes)
      .where(
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestId),
          eq(insurerQuotes.insurerId, insurerId),
          productVersionId === null
            ? isNull(insurerQuotes.productVersionId)
            : eq(insurerQuotes.productVersionId, productVersionId),
          eq(insurerQuotes.status, 'ACTIVE'),
        ),
      );
    return quote !== undefined;
  }

  async insertQuote(tx: Transaction, quote: NewInsurerQuote) {
    const [created] = await tx.insert(insurerQuotes).values(quote).returning(replyColumns);
    return created;
  }

  /** False when the request was marked expired meanwhile or was not sent to the insurer. */
  async markQuoted(tx: Transaction, quoteRequestId: string, insurerId: string, acknowledgedAt: Date): Promise<boolean> {
    const sentToInsurer = tx
      .select({ id: quoteRequestRecipients.id })
      .from(quoteRequestRecipients)
      .where(
        and(eq(quoteRequestRecipients.quoteRequestId, quoteRequests.id), eq(quoteRequestRecipients.insurerId, insurerId)),
      );
    const quoted = await tx
      .update(quoteRequests)
      .set({ status: 'QUOTED' })
      .where(and(eq(quoteRequests.id, quoteRequestId), ne(quoteRequests.status, 'EXPIRED'), exists(sentToInsurer)))
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
  async extendOpenQuote(
    tx: Transaction,
    quoteRequestId: string,
    insurerId: string,
    productVersionId: string | null,
    extraDays: number,
    now: Date,
  ) {
    const [extended] = await tx
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
          productVersionId === null
            ? isNull(insurerQuotes.productVersionId)
            : eq(insurerQuotes.productVersionId, productVersionId),
          eq(insurerQuotes.status, 'ACTIVE'),
          isNull(insurerQuotes.unpayableAt),
          gte(insurerQuotes.validUntil, now),
        ),
      )
      .returning(extensionColumns);
    return extended;
  }

  /**
   * Locks this insurer's current quote for a chosen version, with whether it
   * was chosen or paid for, so a withdrawal or replacement decides on facts
   * that cannot change under it.
   */
  async lockActiveQuote(tx: Transaction, quoteRequestId: string, insurerId: string, productVersionId: string) {
    const [quote] = await tx
      .select({ ...replyColumns, unpayableAt: insurerQuotes.unpayableAt })
      .from(insurerQuotes)
      .where(
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestId),
          eq(insurerQuotes.insurerId, insurerId),
          eq(insurerQuotes.productVersionId, productVersionId),
          eq(insurerQuotes.status, 'ACTIVE'),
        ),
      )
      .for('update');
    if (!quote) return undefined;
    const [selected] = await tx
      .select({ id: quoteSelections.id })
      .from(quoteSelections)
      .where(eq(quoteSelections.insurerQuoteId, quote.id))
      .for('share');
    const [paid] = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.insurerQuoteId, quote.id), eq(payments.status, 'CONFIRMED')));
    return { ...quote, selected: selected !== undefined, paid: paid !== undefined };
  }

  async withdrawQuote(tx: Transaction, quoteId: string, reason: string, at: Date): Promise<void> {
    await tx
      .update(insurerQuotes)
      .set({ status: 'WITHDRAWN', withdrawnAt: at, withdrawnReason: reason })
      .where(and(eq(insurerQuotes.id, quoteId), eq(insurerQuotes.status, 'ACTIVE')));
  }

  /**
   * Marks the old quote replaced before the new one is inserted, so only one
   * is ever current. It points at itself until `linkReplacement` names the new one.
   */
  async supersedeQuote(tx: Transaction, quoteId: string): Promise<void> {
    await tx
      .update(insurerQuotes)
      .set({ status: 'SUPERSEDED', supersededById: quoteId })
      .where(and(eq(insurerQuotes.id, quoteId), eq(insurerQuotes.status, 'ACTIVE')));
  }

  async linkReplacement(tx: Transaction, oldQuoteId: string, newQuoteId: string): Promise<void> {
    await tx.update(insurerQuotes).set({ supersededById: newQuoteId }).where(eq(insurerQuotes.id, oldQuoteId));
  }

  async quoteAvailability(
    quoteRequestId: string,
    insurerId: string,
    productVersionId: string | null,
    tx: Database | Transaction = this.db,
  ) {
    const [quote] = await tx
      .select({ unpayableAt: insurerQuotes.unpayableAt })
      .from(insurerQuotes)
      .where(
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestId),
          eq(insurerQuotes.insurerId, insurerId),
          productVersionId === null
            ? isNull(insurerQuotes.productVersionId)
            : eq(insurerQuotes.productVersionId, productVersionId),
          eq(insurerQuotes.status, 'ACTIVE'),
        ),
      );
    return quote;
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
        issuanceDueAt: policies.issuanceDueAt,
        issuanceAcceptedAt: policies.issuanceAcceptedAt,
        issuanceFailedAt: policies.issuanceFailedAt,
        issuanceFailureReason: policies.issuanceFailureReason,
        customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
        vehicle: { plateNumber: vehicles.plateNumber, make: vehicles.make, model: vehicles.model, year: vehicles.year },
        payment: {
          transactionId: payments.transactionId,
          status: payments.status,
          method: payments.method,
          amountMinor: payments.amountMinor,
          rtsaAnniversaryFeeMinor: payments.rtsaAnniversaryFeeMinor,
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
      .select({
        status: policies.status,
        customerId: policies.customerId,
        insurerName: insurers.name,
        paymentId: policies.paymentId,
        premiumMinor: policies.premiumMinor,
        insurerPolicyNumber: policies.insurerPolicyNumber,
        issuanceAcceptedAt: policies.issuanceAcceptedAt,
        amountMinor: payments.amountMinor,
      })
      .from(policies)
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .innerJoin(payments, eq(payments.id, policies.paymentId))
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.insurerId, insurerId)))
      .for('update', { of: policies });
    return policy;
  }

  /** The insurer takes on issuing: recorded once, with its policy number when it has one. */
  async acceptIssuance(tx: Transaction, policyNumber: string, at: Date, insurerPolicyNumber: string | null) {
    const [accepted] = await tx
      .update(policies)
      .set({ issuanceAcceptedAt: at, ...(insurerPolicyNumber ? { insurerPolicyNumber } : {}) })
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.status, 'AWAITING_INSURER_CERTIFICATE')))
      .returning({ policyNumber: policies.policyNumber, issuanceAcceptedAt: policies.issuanceAcceptedAt, insurerPolicyNumber: policies.insurerPolicyNumber });
    return accepted;
  }

  async failIssuance(tx: Transaction, policyNumber: string, at: Date, reason: string) {
    const [failed] = await tx
      .update(policies)
      .set({ status: 'ISSUANCE_FAILED', issuanceFailedAt: at, issuanceFailureReason: reason })
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.status, 'AWAITING_INSURER_CERTIFICATE')))
      .returning({ policyNumber: policies.policyNumber, status: policies.status });
    return failed;
  }

  /** A late policy that is now issued closes its overdue item: there is nothing left to chase. */
  resolveOverdue(tx: Transaction, paymentId: string, at: Date) {
    return tx
      .update(reconciliationItems)
      .set({ status: 'RESOLVED', outcome: 'ISSUED', resolvedAt: at, resolutionNote: 'The insurer issued the policy.' })
      .where(and(eq(reconciliationItems.kind, 'ISSUANCE_OVERDUE'), eq(reconciliationItems.paymentId, paymentId), ne(reconciliationItems.status, 'RESOLVED')))
      .returning({ id: reconciliationItems.id });
  }

  /** Once per kind and payment while open; undefined when one is already open. */
  async openReconciliationItem(tx: Transaction, item: typeof reconciliationItems.$inferInsert) {
    const [opened] = await tx.insert(reconciliationItems).values(item).onConflictDoNothing().returning({ id: reconciliationItems.id });
    return opened;
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
      // Issuing without a separate acceptance accepts it at the same moment.
      .set({ ...issue, status: 'ACTIVE', issuanceAcceptedAt: sql`coalesce(${policies.issuanceAcceptedAt}, ${issue.issuedAt})` })
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
  /** The insurer's own name, for wording a message the customer will read. */
  async insurerName(tx: Transaction, insurerId: string): Promise<string> {
    const [found] = await tx.select({ name: insurers.name }).from(insurers).where(eq(insurers.id, insurerId));
    return found?.name ?? 'Your insurer';
  }

  async acknowledgeClaim(
    tx: Transaction,
    claimNumber: string,
    insurerId: string,
    receipt: { receivedAt: Date; insurerClaimReference?: string },
  ) {
    const [acknowledged] = await tx
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
        customerId: ncdApplications.customerId,
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
