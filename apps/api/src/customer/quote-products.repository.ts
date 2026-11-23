import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  insurerQuotes,
  insurers,
  payments,
  quoteInformationRequests,
  quoteInternalNotes,
  quoteRequestProductVersions,
  quoteRequests,
  staffUsers,
} from '../db/schema.js';
import type { QuoteProductStatus } from '../common/domain/enums.js';

/** One chosen version with what its workflow needs to decide and to tell people. */
export const versionColumns = {
  id: quoteRequestProductVersions.id,
  quoteRequestId: quoteRequestProductVersions.quoteRequestId,
  productVersionId: quoteRequestProductVersions.productVersionId,
  insurerId: quoteRequestProductVersions.insurerId,
  productName: quoteRequestProductVersions.productName,
  status: quoteRequestProductVersions.status,
  replyDueAt: quoteRequestProductVersions.replyDueAt,
  pausedAt: quoteRequestProductVersions.pausedAt,
  cancelledAt: quoteRequestProductVersions.cancelledAt,
  customerId: quoteRequests.customerId,
  insurerName: insurers.name,
};

export type VersionRow = {
  id: string;
  quoteRequestId: string;
  productVersionId: string;
  insurerId: string;
  productName: string;
  status: QuoteProductStatus;
  replyDueAt: Date | null;
  pausedAt: Date | null;
  cancelledAt: Date | null;
  customerId: string;
  insurerName: string;
};

export type VersionPatch = Partial<
  Pick<
    typeof quoteRequestProductVersions.$inferInsert,
    'replyDueAt' | 'pausedAt' | 'declineReasonCode' | 'declineCustomerNote' | 'cancelledAt' | 'cancelledReason'
  >
>;

export const informationColumns = {
  id: quoteInformationRequests.id,
  quoteRequestId: quoteInformationRequests.quoteRequestId,
  productVersionId: quoteInformationRequests.productVersionId,
  message: quoteInformationRequests.message,
  dueAt: quoteInformationRequests.dueAt,
  createdAt: quoteInformationRequests.createdAt,
  answeredAt: quoteInformationRequests.answeredAt,
  answerText: quoteInformationRequests.answerText,
  closedAt: quoteInformationRequests.closedAt,
};

export type InformationRequestRow = {
  id: string;
  quoteRequestId: string;
  productVersionId: string;
  message: string;
  dueAt: Date;
  createdAt: Date;
  answeredAt: Date | null;
  answerText: string | null;
  closedAt: Date | null;
};

/**
 * The state of each chosen product version, its questions to the customer and
 * the insurer's internal notes. Nothing here decides a transition: the
 * workflow service does, and this only writes what it decided, guarded by the
 * state it decided from.
 */
@Injectable()
export class QuoteProductsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private versions(tx: Database | Transaction) {
    return tx
      .select(versionColumns)
      .from(quoteRequestProductVersions)
      .innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestProductVersions.quoteRequestId))
      .innerJoin(insurers, eq(insurers.id, quoteRequestProductVersions.insurerId));
  }

  /**
   * Locks one chosen version. `scope` limits it to the insurer the caller acts
   * for or the customer who owns the request, so a foreign id finds nothing.
   */
  async lock(
    tx: Transaction,
    quoteRequestId: string,
    productVersionId: string,
    scope: { insurerId: string } | { customerId: string },
  ): Promise<VersionRow | undefined> {
    const [row] = await this.versions(tx)
      .where(
        and(
          eq(quoteRequestProductVersions.quoteRequestId, quoteRequestId),
          eq(quoteRequestProductVersions.productVersionId, productVersionId),
          'insurerId' in scope
            ? eq(quoteRequestProductVersions.insurerId, scope.insurerId)
            : eq(quoteRequests.customerId, scope.customerId),
        ),
      )
      .for('update', { of: quoteRequestProductVersions });
    return row;
  }

  /** Writes `to` only if the version is still in `from`; false when another writer moved it first. */
  async move(
    tx: Transaction,
    id: string,
    from: QuoteProductStatus,
    to: QuoteProductStatus,
    at: Date,
    patch: VersionPatch = {},
  ): Promise<boolean> {
    const moved = await tx
      .update(quoteRequestProductVersions)
      .set({ ...patch, status: to, statusChangedAt: at })
      .where(and(eq(quoteRequestProductVersions.id, id), eq(quoteRequestProductVersions.status, from)))
      .returning({ id: quoteRequestProductVersions.id });
    return moved.length === 1;
  }

  /** Versions past their reply due date with the clock running, oldest first. */
  dueForTimeOut(now: Date, limit: number, tx: Database | Transaction = this.db): Promise<VersionRow[]> {
    return this.versions(tx)
      .where(
        and(
          inArray(quoteRequestProductVersions.status, ['SUBMITTED', 'INSURER_PROCESSING']),
          isNull(quoteRequestProductVersions.pausedAt),
          isNotNull(quoteRequestProductVersions.replyDueAt),
          lte(quoteRequestProductVersions.replyDueAt, now),
        ),
      )
      .orderBy(asc(quoteRequestProductVersions.replyDueAt), asc(quoteRequestProductVersions.id))
      .limit(limit);
  }

  /** Quoted versions whose quote's validity has passed without a confirmed payment. */
  dueForExpiry(now: Date, limit: number, tx: Database | Transaction = this.db): Promise<VersionRow[]> {
    const confirmed = tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.insurerQuoteId, insurerQuotes.id), eq(payments.status, 'CONFIRMED')));
    return this.versions(tx)
      .innerJoin(
        insurerQuotes,
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestProductVersions.quoteRequestId),
          eq(insurerQuotes.productVersionId, quoteRequestProductVersions.productVersionId),
        ),
      )
      .where(
        and(
          eq(quoteRequestProductVersions.status, 'QUOTED'),
          lte(insurerQuotes.validUntil, now),
          sql`NOT EXISTS (${confirmed})`,
        ),
      )
      .orderBy(asc(insurerQuotes.validUntil), asc(quoteRequestProductVersions.id))
      .limit(limit);
  }

  /** Whether the version's quote has passed its validity with no confirmed payment. */
  async isLapsedUnpaid(tx: Transaction, versionId: string, now: Date): Promise<boolean> {
    const confirmed = tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.insurerQuoteId, insurerQuotes.id), eq(payments.status, 'CONFIRMED')));
    const [lapsed] = await tx
      .select({ id: quoteRequestProductVersions.id })
      .from(quoteRequestProductVersions)
      .innerJoin(
        insurerQuotes,
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestProductVersions.quoteRequestId),
          eq(insurerQuotes.productVersionId, quoteRequestProductVersions.productVersionId),
        ),
      )
      .where(and(eq(quoteRequestProductVersions.id, versionId), lte(insurerQuotes.validUntil, now), sql`NOT EXISTS (${confirmed})`));
    return lapsed !== undefined;
  }

  /** An insurer's versions that decision 24 may still cancel, locked, with whether each was paid for. */
  async lockCancellableForInsurer(tx: Transaction, insurerId: string) {
    const confirmed = tx
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .where(
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestProductVersions.quoteRequestId),
          eq(insurerQuotes.productVersionId, quoteRequestProductVersions.productVersionId),
          eq(payments.status, 'CONFIRMED'),
        ),
      );
    return tx
      .select({ ...versionColumns, paid: sql<boolean>`EXISTS (${confirmed})` })
      .from(quoteRequestProductVersions)
      .innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestProductVersions.quoteRequestId))
      .innerJoin(insurers, eq(insurers.id, quoteRequestProductVersions.insurerId))
      .where(and(eq(quoteRequestProductVersions.insurerId, insurerId), isNull(quoteRequestProductVersions.cancelledAt)))
      .orderBy(asc(quoteRequestProductVersions.quoteRequestId), asc(quoteRequestProductVersions.productVersionId))
      .for('update', { of: quoteRequestProductVersions });
  }

  /** Marks a version cancelled under decision 24 without changing its state, for one that was paid. */
  async markCancelled(tx: Transaction, id: string, cancelledAt: Date): Promise<void> {
    await tx
      .update(quoteRequestProductVersions)
      .set({ cancelledAt, cancelledReason: 'INSURER_SUSPENDED' })
      .where(eq(quoteRequestProductVersions.id, id));
  }

  // ── Information requests ───────────────────────────────────────

  async insertInformationRequest(
    tx: Transaction,
    request: typeof quoteInformationRequests.$inferInsert,
  ): Promise<InformationRequestRow> {
    const [created] = await tx.insert(quoteInformationRequests).values(request).returning(informationColumns);
    return created;
  }

  async lockOpenInformationRequest(
    tx: Transaction,
    quoteRequestId: string,
    productVersionId: string,
  ): Promise<InformationRequestRow | undefined> {
    const [open] = await tx
      .select(informationColumns)
      .from(quoteInformationRequests)
      .where(
        and(
          eq(quoteInformationRequests.quoteRequestId, quoteRequestId),
          eq(quoteInformationRequests.productVersionId, productVersionId),
          isNull(quoteInformationRequests.closedAt),
        ),
      )
      .for('update');
    return open;
  }

  async answerInformationRequest(tx: Transaction, id: string, answerText: string, at: Date) {
    const [answered] = await tx
      .update(quoteInformationRequests)
      .set({ answerText, answeredAt: at, closedAt: at })
      .where(and(eq(quoteInformationRequests.id, id), isNull(quoteInformationRequests.closedAt)))
      .returning(informationColumns);
    return answered;
  }

  /** Closes the version's open question unanswered, because the version moved on without it. */
  async closeOpenInformationRequest(tx: Transaction, quoteRequestId: string, productVersionId: string, at: Date) {
    await tx
      .update(quoteInformationRequests)
      .set({ closedAt: at })
      .where(
        and(
          eq(quoteInformationRequests.quoteRequestId, quoteRequestId),
          eq(quoteInformationRequests.productVersionId, productVersionId),
          isNull(quoteInformationRequests.closedAt),
        ),
      );
  }

  /** The questions asked on these requests; only `insurerId`'s when it is given. */
  informationRequestsFor(
    quoteRequestIds: string[],
    insurerId?: string,
    tx: Database | Transaction = this.db,
  ): Promise<InformationRequestRow[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return tx
      .select(informationColumns)
      .from(quoteInformationRequests)
      .where(
        and(
          inArray(quoteInformationRequests.quoteRequestId, quoteRequestIds),
          insurerId === undefined ? undefined : eq(quoteInformationRequests.insurerId, insurerId),
        ),
      )
      .orderBy(asc(quoteInformationRequests.createdAt), asc(quoteInformationRequests.id));
  }

  // ── Internal notes ─────────────────────────────────────────────

  async insertNote(tx: Transaction, note: typeof quoteInternalNotes.$inferInsert) {
    const [created] = await tx
      .insert(quoteInternalNotes)
      .values(note)
      .returning({ id: quoteInternalNotes.id, body: quoteInternalNotes.body, createdAt: quoteInternalNotes.createdAt });
    return created;
  }

  notesFor(quoteRequestId: string, productVersionId: string, insurerId: string) {
    return this.db
      .select({
        id: quoteInternalNotes.id,
        body: quoteInternalNotes.body,
        authorName: staffUsers.fullName,
        createdAt: quoteInternalNotes.createdAt,
      })
      .from(quoteInternalNotes)
      .leftJoin(staffUsers, eq(staffUsers.id, quoteInternalNotes.authorStaffId))
      .where(
        and(
          eq(quoteInternalNotes.quoteRequestId, quoteRequestId),
          eq(quoteInternalNotes.productVersionId, productVersionId),
          eq(quoteInternalNotes.insurerId, insurerId),
        ),
      )
      .orderBy(desc(quoteInternalNotes.createdAt), desc(quoteInternalNotes.id));
  }
}
