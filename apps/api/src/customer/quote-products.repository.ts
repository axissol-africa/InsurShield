import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
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
  vehicles,
} from '../db/schema.js';
import type { QuotePriority, QuoteProductStatus, StaffRole } from '../common/domain/enums.js';
import { OPEN_QUOTE_PRODUCT_STATUSES } from './domain/quote-workflow.js';

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
  assignedStaffId: quoteRequestProductVersions.assignedStaffId,
  priority: quoteRequestProductVersions.priority,
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
  assignedStaffId: string | null;
  priority: QuotePriority;
  customerId: string;
  insurerName: string;
};

/** Filters for the insurer's queue. Every one narrows; none widens past the insurer. */
export interface QueueFilter {
  statuses?: QuoteProductStatus[];
  ownerStaffId?: string | null;
  priority?: QuotePriority;
  search?: string;
}

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

  /** Assigns a version to a staff member, or clears it with null. */
  async assign(tx: Transaction, id: string, staffId: string | null, at: Date): Promise<void> {
    await tx
      .update(quoteRequestProductVersions)
      .set({ assignedStaffId: staffId, assignedAt: staffId ? at : null })
      .where(eq(quoteRequestProductVersions.id, id));
  }

  async setPriority(tx: Transaction, id: string, priority: QuotePriority): Promise<void> {
    await tx.update(quoteRequestProductVersions).set({ priority }).where(eq(quoteRequestProductVersions.id, id));
  }

  /** An active staff member of `insurerId`, with their role and email; undefined for anyone else. */
  async insurerStaffMember(insurerId: string, staffId: string, tx: Database | Transaction = this.db) {
    const [staff] = await tx
      .select({ id: staffUsers.id, fullName: staffUsers.fullName, email: staffUsers.email, role: staffUsers.role })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, staffId), eq(staffUsers.insurerId, insurerId), eq(staffUsers.isActive, true)));
    return staff;
  }

  /** The active staff of `insurerId` holding one of `roles`, for a warning nobody owns yet. */
  insurerStaffWithRoles(insurerId: string, roles: StaffRole[], tx: Database | Transaction = this.db) {
    return tx
      .select({ id: staffUsers.id, email: staffUsers.email })
      .from(staffUsers)
      .where(and(eq(staffUsers.insurerId, insurerId), eq(staffUsers.isActive, true), inArray(staffUsers.role, roles)))
      .orderBy(asc(staffUsers.email));
  }

  /**
   * Open versions whose clock is running and whose due date falls within
   * `hoursBeforeDue`, not yet warned. A breached one is still warned once.
   */
  dueForWarning(now: Date, hoursBeforeDue: number, limit: number, tx: Database | Transaction = this.db) {
    return this.versions(tx)
      .where(
        and(
          inArray(quoteRequestProductVersions.status, ['SUBMITTED', 'INSURER_PROCESSING']),
          isNull(quoteRequestProductVersions.pausedAt),
          isNull(quoteRequestProductVersions.slaWarnedAt),
          isNotNull(quoteRequestProductVersions.replyDueAt),
          lte(quoteRequestProductVersions.replyDueAt, new Date(now.getTime() + hoursBeforeDue * 3_600_000)),
          gt(quoteRequestProductVersions.replyDueAt, now),
        ),
      )
      .orderBy(asc(quoteRequestProductVersions.replyDueAt), asc(quoteRequestProductVersions.id))
      .limit(limit);
  }

  /** Marks the warning sent; false when another sweep marked it first. */
  async markWarned(tx: Transaction, id: string, at: Date): Promise<boolean> {
    const marked = await tx
      .update(quoteRequestProductVersions)
      .set({ slaWarnedAt: at })
      .where(and(eq(quoteRequestProductVersions.id, id), isNull(quoteRequestProductVersions.slaWarnedAt)))
      .returning({ id: quoteRequestProductVersions.id });
    return marked.length === 1;
  }

  /** This insurer's open chosen products, most urgent first, one row each. */
  queue(insurerId: string, filter: QueueFilter, limit: number) {
    const search = filter.search?.trim();
    return this.db
      .select({
        id: quoteRequestProductVersions.id,
        quoteRequestId: quoteRequestProductVersions.quoteRequestId,
        productVersionId: quoteRequestProductVersions.productVersionId,
        productName: quoteRequestProductVersions.productName,
        productVersionNumber: quoteRequestProductVersions.productVersionNumber,
        status: quoteRequestProductVersions.status,
        priority: quoteRequestProductVersions.priority,
        replyDueAt: quoteRequestProductVersions.replyDueAt,
        pausedAt: quoteRequestProductVersions.pausedAt,
        assignedAt: quoteRequestProductVersions.assignedAt,
        owner: { id: staffUsers.id, fullName: staffUsers.fullName },
        submittedAt: quoteRequests.submittedAt,
        plateNumber: vehicles.plateNumber,
        vehicle: sql<string>`trim(${vehicles.year} || ' ' || ${vehicles.make} || ' ' || ${vehicles.model})`,
      })
      .from(quoteRequestProductVersions)
      .innerJoin(quoteRequests, eq(quoteRequests.id, quoteRequestProductVersions.quoteRequestId))
      .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
      .leftJoin(staffUsers, eq(staffUsers.id, quoteRequestProductVersions.assignedStaffId))
      .where(
        and(
          eq(quoteRequestProductVersions.insurerId, insurerId),
          inArray(quoteRequestProductVersions.status, filter.statuses ?? [...OPEN_QUOTE_PRODUCT_STATUSES]),
          filter.ownerStaffId === undefined
            ? undefined
            : filter.ownerStaffId === null
              ? isNull(quoteRequestProductVersions.assignedStaffId)
              : eq(quoteRequestProductVersions.assignedStaffId, filter.ownerStaffId),
          filter.priority ? eq(quoteRequestProductVersions.priority, filter.priority) : undefined,
          search
            ? or(ilike(quoteRequests.id, `%${escapeLike(search)}%`), ilike(vehicles.plateNumber, `%${escapeLike(search)}%`))
            : undefined,
        ),
      )
      .orderBy(
        desc(sql`${quoteRequestProductVersions.priority} = 'HIGH'`),
        sql`${quoteRequestProductVersions.replyDueAt} ASC NULLS LAST`,
        asc(quoteRequestProductVersions.id),
      )
      .limit(limit);
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
          eq(insurerQuotes.status, 'ACTIVE'),
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
          eq(insurerQuotes.status, 'ACTIVE'),
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

/** A search typed by a person matches literally, never as a LIKE pattern. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
