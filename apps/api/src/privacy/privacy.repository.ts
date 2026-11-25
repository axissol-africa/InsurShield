import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { OPEN_SERVICE_REQUEST_STATUSES, type DocumentRetentionClass } from '../common/domain/enums.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  authUsers,
  consentRecords,
  contactPreferences,
  customers,
  documents,
  marketingConsents,
  notifications,
  payments,
  quoteRequests,
  vehicles,
} from '../db/schema.js';

const OPEN_SERVICE_REQUESTS = sql.raw(`(${OPEN_SERVICE_REQUEST_STATUSES.map((status) => `'${status}'`).join(', ')})`);

export interface ExpiredDocument {
  id: string;
  storageKey: string;
  retentionClass: DocumentRetentionClass;
}

/**
 * What the data lifecycle reads and changes (batch 15 part 3): a customer's
 * own records for their export, documents whose retention period has passed,
 * and closed accounts whose identity is due to be replaced.
 */
@Injectable()
export class PrivacyRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  // ── The export ────────────────────────────────────────────────

  profile(customerId: string) {
    return this.db
      .select({ fullName: customers.fullName, email: customers.email, phone: customers.phone, emailVerifiedAt: customers.emailVerifiedAt, createdAt: customers.createdAt })
      .from(customers)
      .where(eq(customers.id, customerId))
      .then((rows) => rows[0]);
  }

  consents(customerId: string) {
    return this.db
      .select({ privacyVersion: consentRecords.privacyVersion, termsVersion: consentRecords.termsVersion, acceptedAt: consentRecords.acceptedAt })
      .from(consentRecords)
      .where(eq(consentRecords.customerId, customerId))
      .orderBy(asc(consentRecords.acceptedAt));
  }

  marketingConsents(customerId: string) {
    return this.db
      .select({ granted: marketingConsents.granted, recordedAt: marketingConsents.recordedAt })
      .from(marketingConsents)
      .where(eq(marketingConsents.customerId, customerId))
      .orderBy(asc(marketingConsents.recordedAt));
  }

  contactPreferences(customerId: string) {
    return this.db
      .select({ category: contactPreferences.category, channel: contactPreferences.channel, enabled: contactPreferences.enabled })
      .from(contactPreferences)
      .where(eq(contactPreferences.customerId, customerId))
      .orderBy(asc(contactPreferences.category), asc(contactPreferences.channel));
  }

  /** The vehicles named on the customer's own requests. */
  vehicles(customerId: string) {
    return this.db
      .selectDistinct({
        plateNumber: vehicles.plateNumber,
        make: vehicles.make,
        model: vehicles.model,
        year: vehicles.year,
        color: vehicles.color,
        chassisNumber: vehicles.chassisNumber,
        engineNumber: vehicles.engineNumber,
        registrationCountry: vehicles.registrationCountry,
      })
      .from(vehicles)
      .innerJoin(quoteRequests, eq(quoteRequests.vehicleId, vehicles.id))
      .where(eq(quoteRequests.customerId, customerId))
      .orderBy(asc(vehicles.plateNumber));
  }

  /** What the customer paid, with only the masked number they paid from; provider internals stay out. */
  payments(customerId: string) {
    return this.db
      .select({
        transactionId: payments.transactionId,
        quoteRequestId: payments.quoteRequestId,
        status: payments.status,
        method: payments.method,
        amountMinor: payments.amountMinor,
        currency: payments.currency,
        payerMsisdnMasked: payments.payerMsisdnMasked,
        createdAt: payments.createdAt,
        confirmedAt: payments.confirmedAt,
      })
      .from(payments)
      .where(eq(payments.customerId, customerId))
      .orderBy(asc(payments.createdAt));
  }

  notifications(customerId: string) {
    return this.db
      .select({
        subject: notifications.subject,
        body: notifications.body,
        category: notifications.category,
        channel: notifications.channel,
        createdAt: notifications.createdAt,
        readAt: notifications.readAt,
      })
      .from(notifications)
      .where(eq(notifications.customerId, customerId))
      .orderBy(desc(notifications.createdAt));
  }

  /** Files the customer uploaded and that are still kept. */
  uploadedDocuments(customerId: string) {
    return this.db
      .select({ id: documents.id, kind: documents.kind, uploadedAt: documents.uploadedAt })
      .from(documents)
      .where(and(eq(documents.uploadedByCustomerId, customerId), isNull(documents.deletedAt)))
      .orderBy(asc(documents.uploadedAt));
  }

  // ── Documents past their retention period ─────────────────────

  /**
   * Documents of one class uploaded before `cutoff` that nothing still needs
   * (rule 6): not the papers of cover that stands (active, its last day not
   * passed) or is being issued, nor of a
   * policy with an unresolved reconciliation item; not on a claim (no claim is
   * closed before batch 16); not on an open service request; not evidence on
   * an unresolved item; not an insurer's logo or evidence while the insurer
   * exists; not on a draft still kept.
   */
  async expiredDocuments(retentionClass: DocumentRetentionClass, cutoff: Date, limit: number): Promise<ExpiredDocument[]> {
    const { rows } = await this.db.execute<{ id: string; storageKey: string; retentionClass: DocumentRetentionClass }>(sql`
      WITH policy_documents AS (
        SELECT p."policyNumber", x.document_id
        FROM "policies" p
        CROSS JOIN LATERAL (VALUES (p."quoteDocumentId"), (p."certificateDocumentId")) AS x(document_id)
        WHERE x.document_id IS NOT NULL
        UNION ALL
        SELECT p."policyNumber", qr."whiteBookDocumentId"
        FROM "policies" p JOIN "quote_requests" qr ON qr."id" = p."quoteRequestId"
        WHERE qr."whiteBookDocumentId" IS NOT NULL
        UNION ALL
        SELECT p."policyNumber", s."documentId"
        FROM "policies" p JOIN "inspection_shots" s ON s."quoteRequestId" = p."quoteRequestId"
        UNION ALL
        SELECT p."policyNumber", r."documentId"
        FROM "policies" p JOIN "quote_request_product_requirement_documents" r ON r."quoteRequestId" = p."quoteRequestId"
        UNION ALL
        SELECT p."policyNumber", q."documentId"
        FROM "policies" p JOIN "insurer_quotes" q ON q."quoteRequestId" = p."quoteRequestId"
        UNION ALL
        SELECT p."policyNumber", ph."documentId"
        FROM "policies" p
        JOIN "inspections" i ON i."quoteRequestId" = p."quoteRequestId"
        JOIN "inspection_photos" ph ON ph."inspectionId" = i."id"
      ),
      held_policies AS (
        -- Cover still standing, or being issued: its papers are part of a live contract.
        SELECT "policyNumber" FROM "policies"
        WHERE "status" = 'AWAITING_INSURER_CERTIFICATE'
           OR ("status" = 'ACTIVE' AND ("policyEndDate" IS NULL OR "policyEndDate" > now()))
        UNION
        SELECT "policyNumber" FROM "reconciliation_items" WHERE "status" <> 'RESOLVED' AND "policyNumber" IS NOT NULL
      )
      SELECT d."id", d."storageKey", d."retentionClass"
      FROM "documents" d
      WHERE d."deletedAt" IS NULL
        AND d."retentionClass" = ${retentionClass}
        AND d."uploadedAt" < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM policy_documents pd JOIN held_policies hp USING ("policyNumber") WHERE pd.document_id = d."id")
        AND NOT EXISTS (SELECT 1 FROM "claim_attachments" c WHERE c."documentId" = d."id")
        AND NOT EXISTS (
          SELECT 1 FROM "service_request_updates" u JOIN "service_requests" sr ON sr."reference" = u."reference"
          WHERE d."id" = ANY(u."documentIds") AND sr."status" IN ${OPEN_SERVICE_REQUESTS}
        )
        AND NOT EXISTS (SELECT 1 FROM "reconciliation_items" ri WHERE ri."status" <> 'RESOLVED' AND d."id" = ANY(ri."evidenceDocumentIds"))
        AND NOT EXISTS (SELECT 1 FROM "insurers" ins WHERE ins."logoUrl" LIKE '%' || d."id"::text || '%')
        AND NOT EXISTS (
          SELECT 1 FROM "insurer_evidence" e JOIN "insurers" ins ON ins."id" = e."insurerId"
          WHERE e."documentId" = d."id" AND ins."deletedAt" IS NULL
        )
        AND NOT EXISTS (SELECT 1 FROM "quote_request_draft_documents" dd WHERE dd."documentId" = d."id")
      ORDER BY d."uploadedAt", d."id"
      LIMIT ${limit}
    `);
    return rows;
  }

  /** Marks a document whose file is gone. False when another run got there first. */
  async markDeleted(id: string, at: Date): Promise<boolean> {
    const rows = await this.db
      .update(documents)
      .set({ deletedAt: at })
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .returning({ id: documents.id });
    return rows.length > 0;
  }

  // ── Closed accounts ───────────────────────────────────────────

  accountsDueForAnonymising(closedBefore: Date, limit: number) {
    return this.db
      .select({ id: customers.id })
      .from(customers)
      .where(and(isNotNull(customers.deletedAt), lt(customers.deletedAt, closedBefore), isNull(customers.anonymisedAt)))
      .orderBy(asc(customers.deletedAt))
      .limit(limit);
  }

  /**
   * Replaces the identity of one closed account and removes its sign-in. The
   * records under it stay, under their own retention classes; they now point
   * at "Closed account". False when it was already done or reopened meanwhile.
   */
  async anonymise(tx: Transaction, customerId: string, closedBefore: Date, at: Date): Promise<boolean> {
    const [locked] = await tx
      .select({ userId: customers.userId })
      .from(customers)
      .where(and(eq(customers.id, customerId), isNotNull(customers.deletedAt), lt(customers.deletedAt, closedBefore), isNull(customers.anonymisedAt)))
      .for('update');
    if (!locked) return false;
    // Placeholders are unique per account, as the email and phone columns must be.
    await tx
      .update(customers)
      .set({
        fullName: 'Closed account',
        email: `closed-${customerId}@anonymised.invalid`,
        phone: `closed-${customerId}`,
        emailVerifiedAt: null,
        userId: null,
        anonymisedAt: at,
      })
      .where(eq(customers.id, customerId));
    // Sessions, passwords and second factors go with the user, by cascade.
    if (locked.userId) await tx.delete(authUsers).where(eq(authUsers.id, locked.userId));
    return true;
  }
}
