import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, isNull, lt, or, sql } from 'drizzle-orm';
import {
  DATABASE,
  type Database,
  type Transaction,
} from '../db/database.module.js';
import {
  authUsers,
  authVerifications,
  authSignInFailures,
  customers,
  documents,
  staffUsers,
  insurerReviews,
  policies,
  reviewRevisions,
  reviewDecisions,
  reviewAppeals,
} from '../db/schema.js';
import type { DocumentRetentionClass } from '../common/domain/enums.js';

@Injectable()
export class RetentionRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private reviewExpired(now: Date, days: number, appealDays: number) {
    // The latest case-wide closure/unpublication trigger protects related evidence too.
    return sql`greatest(
      ${insurerReviews.createdAt}, ${insurerReviews.withdrawnAt},
      (SELECT max(r."retiredAt") FROM review_revisions r WHERE r."reviewId" = ${insurerReviews.id}),
      (SELECT max(a."decidedAt") FROM review_appeals a JOIN review_decisions d ON d.id = a."decisionId"
       JOIN review_revisions r ON r.id = d."revisionId" WHERE r."reviewId" = ${insurerReviews.id}),
      (SELECT max(d."createdAt") FROM review_decisions d JOIN review_revisions r ON r.id = d."revisionId"
       WHERE r."reviewId" = ${insurerReviews.id})
    ) < ${now.toISOString()}::timestamptz - (${days} * interval '1 day')
    AND NOT EXISTS (SELECT 1 FROM review_decisions d JOIN review_revisions r ON r.id = d."revisionId"
      WHERE r."reviewId" = ${insurerReviews.id}
      AND (d."createdAt" AT TIME ZONE 'Africa/Lusaka')::date + ${appealDays}::integer >= (${now.toISOString()}::timestamptz AT TIME ZONE 'Africa/Lusaka')::date)
    AND NOT EXISTS (SELECT 1 FROM review_appeals a JOIN review_decisions d ON d.id = a."decisionId"
      JOIN review_revisions r ON r.id = d."revisionId" WHERE r."reviewId" = ${insurerReviews.id} AND a."decidedAt" IS NULL)`;
  }

  private revisionCanPurge() {
    // An approved reply stays attached while a removed review can still be restored.
    return sql`${reviewRevisions.purgedAt} IS NULL AND (
      (${reviewRevisions.retiredAt} IS NOT NULL AND ${reviewRevisions.status} IN ('REJECTED', 'REMOVED', 'SUPERSEDED'))
      OR (${reviewRevisions.kind} = 'RESPONSE' AND ${reviewRevisions.status} IN ('PENDING', 'PUBLISHED')
        AND NOT EXISTS (SELECT 1 FROM review_revisions parent
          WHERE parent."reviewId" = ${reviewRevisions.reviewId} AND parent.kind = 'REVIEW' AND parent.status = 'PUBLISHED'))
    )`;
  }

  private noPrivacyHold() {
    return sql`NOT EXISTS (SELECT 1 FROM privacy_requests pr JOIN policies p ON p."customerId" = pr."customerId"
      WHERE p."policyNumber" = ${insurerReviews.policyNumber} AND pr.held)`;
  }

  async reviewCandidates(now: Date, days: number, appealDays: number) {
    const revisions = this.db.select({ id: reviewRevisions.id }).from(reviewRevisions)
      .where(and(eq(reviewRevisions.reviewId, insurerReviews.id), this.revisionCanPurge()));
    return this.db.select({ id: insurerReviews.id }).from(insurerReviews).where(and(
      isNull(insurerReviews.legalHoldAt), this.noPrivacyHold(), this.reviewExpired(now, days, appealDays),
      or(exists(revisions), sql`EXISTS (SELECT 1 FROM review_appeals a JOIN review_decisions d ON d.id = a."decisionId"
        JOIN review_revisions r ON r.id = d."revisionId" WHERE r."reviewId" = ${insurerReviews.id}
        AND a."decidedAt" IS NOT NULL AND a."purgedAt" IS NULL)`),
    )).orderBy(insurerReviews.id).limit(500);
  }

  async purgeReview(tx: Transaction, id: string, now: Date, days: number, appealDays: number) {
    const [review] = await tx.select({ id: insurerReviews.id, customerId: policies.customerId }).from(insurerReviews)
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .where(eq(insurerReviews.id, id)).for('update', { of: insurerReviews });
    if (!review) return { revisions: 0, appeals: 0 };
    const fence = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${review.customerId}, 16)) AS acquired`,
    );
    if (!fence.rows[0]?.acquired) return { revisions: 0, appeals: 0 };
    // Re-read after acquiring the lock: an appeal/hold may have committed while waiting.
    const [eligible] = await tx.select({ id: insurerReviews.id }).from(insurerReviews).where(and(
      eq(insurerReviews.id, id), isNull(insurerReviews.legalHoldAt), this.noPrivacyHold(), this.reviewExpired(now, days, appealDays),
    ));
    if (!eligible) return { revisions: 0, appeals: 0 };
    const revisions = await tx.update(reviewRevisions).set({
      rating: null, text: null, purgedAt: now,
      status: sql`CASE WHEN ${reviewRevisions.status} IN ('PENDING', 'PUBLISHED') THEN 'REMOVED' ELSE ${reviewRevisions.status} END`,
      retiredAt: sql`COALESCE(${reviewRevisions.retiredAt}, ${now.toISOString()}::timestamptz)`,
    }).where(and(eq(reviewRevisions.reviewId, id), this.revisionCanPurge())).returning({ id: reviewRevisions.id });
    const appeals = await tx.update(reviewAppeals).set({ reason: null, evidence: null, outcomeReason: 'Private content expired', purgedAt: now }).where(and(
      isNull(reviewAppeals.purgedAt), sql`${reviewAppeals.decidedAt} IS NOT NULL`,
      sql`${reviewAppeals.decisionId} IN (SELECT ${reviewDecisions.id} FROM ${reviewDecisions}
        JOIN ${reviewRevisions} ON ${reviewRevisions.id} = ${reviewDecisions.revisionId} WHERE ${reviewRevisions.reviewId} = ${id})`,
    )).returning({ id: reviewAppeals.id });
    return { revisions: revisions.length, appeals: appeals.length };
  }

  async documentCandidates(
    days: Record<DocumentRetentionClass, number>,
    now: Date,
  ) {
    return this.db
      .select({ id: documents.id })
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          sql`(${documents.deletionStartedAt} IS NOT NULL OR NOT public.retention_document_held(${documents.id}))`,
          sql`(${documents.deletionStartedAt} IS NOT NULL OR ${documents.uploadedAt} < ${now.toISOString()}::timestamptz -
        ((${JSON.stringify(days)}::jsonb ->> ${documents.retentionClass}::text)::integer * interval '1 day'))`,
        ),
      )
      .orderBy(documents.id)
      .limit(500);
  }

  async claimDocument(
    tx: Transaction,
    id: string,
    days: Record<DocumentRetentionClass, number>,
    now: Date,
  ) {
    // NO KEY UPDATE remains compatible with the FK key-share locks of an attachment.
    const [document] = await tx
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .for('no key update');
    if (!document || document.deletedAt) return null;
    const fence = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${id}, 15)) AS acquired`,
    );
    if (!fence.rows[0]?.acquired) return null;
    const owners = await tx.execute<{ id: string }>(
      sql`SELECT owner AS id FROM public.retention_document_owners(${id}::uuid) owner WHERE owner IS NOT NULL ORDER BY owner`,
    );
    for (const owner of owners.rows) {
      const lock = await tx.execute<{ acquired: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${owner.id}, 16)) AS acquired`,
      );
      if (!lock.rows[0]?.acquired) return null;
    }
    if (document.deletionStartedAt) return document;
    if (
      document.uploadedAt.getTime() >=
      now.getTime() - days[document.retentionClass] * 86_400_000
    )
      return null;
    const { rows } = await tx.execute<{ held: boolean }>(
      sql`SELECT public.retention_document_held(${id}::uuid) AS held`,
    );
    if (rows[0]?.held !== false) return null;
    await tx
      .update(documents)
      .set({ deletionStartedAt: now })
      .where(eq(documents.id, id));
    return document;
  }

  async finishDocument(
    tx: Transaction,
    id: string,
    now: Date,
  ): Promise<boolean> {
    const rows = await tx
      .update(documents)
      .set({
        deletedAt: now,
        fileName: 'Deleted document',
        mimeType: 'application/octet-stream',
        sizeBytes: 0,
        storageKey: `deleted/${id}`,
        checksumSha256: null,
        scannerName: null,
      })
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .returning({ id: documents.id });
    return rows.length === 1;
  }

  async accountCandidates(cutoff: Date) {
    return this.db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          lt(customers.deletedAt, cutoff),
          isNull(customers.anonymisedAt),
          sql`NOT public.retention_customer_held(${customers.id})`,
          sql`NOT EXISTS (SELECT 1 FROM staff_users s WHERE s."userId" = ${customers.userId})`,
        ),
      )
      .orderBy(customers.id)
      .limit(500);
  }

  async anonymise(
    tx: Transaction,
    id: string,
    cutoff: Date,
    now: Date,
  ): Promise<boolean> {
    const [customer] = await tx
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .for('no key update');
    if (
      !customer?.deletedAt ||
      customer.anonymisedAt ||
      customer.deletedAt >= cutoff
    )
      return false;
    const fence = await tx.execute<{ acquired: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(hashtextextended(${id}, 16)) AS acquired`,
    );
    if (!fence.rows[0]?.acquired) return false;
    const { rows } = await tx.execute<{ held: boolean }>(
      sql`SELECT public.retention_customer_held(${id}::uuid) AS held`,
    );
    if (rows[0]?.held !== false) return false;
    if (customer.userId) {
      await tx
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.id, customer.userId))
        .for('update');
      const [staff] = await tx
        .select({ id: staffUsers.id })
        .from(staffUsers)
        .where(eq(staffUsers.userId, customer.userId));
      // An identity linked to staff is not exclusively owned by this customer.
      if (staff) return false;
    }
    await tx
      .update(customers)
      .set({
        fullName: 'Closed account',
        phone: `closed-${id}`,
        email: `closed-${id}@invalid.example`,
        emailVerifiedAt: null,
        userId: null,
        anonymisedAt: now,
      })
      .where(eq(customers.id, id));
    // FK cascades remove sessions, credentials and MFA together; regulatory records remain.
    if (customer.userId) {
      await tx
        .delete(authVerifications)
        .where(
          or(
            eq(authVerifications.value, customer.userId),
            eq(authVerifications.identifier, customer.email),
          ),
        );
      await tx
        .delete(authSignInFailures)
        .where(eq(authSignInFailures.emailKey, customer.email.toLowerCase()));
      await tx.delete(authUsers).where(eq(authUsers.id, customer.userId));
    }
    return true;
  }
}
