import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  approvalRequests,
  insurers,
  paymentRefunds,
  payments,
  policies,
  reconciliationItems,
  staffUsers,
} from '../db/schema.js';
import {
  OPEN_REFUND_STATUSES,
  type ReconciliationKind,
  type ReconciliationOutcome,
  type ReconciliationStatus,
  type RefundStatus,
} from '../common/domain/enums.js';

export type RefundRow = typeof paymentRefunds.$inferSelect;
export type NewRefund = typeof paymentRefunds.$inferInsert;
export type ItemRow = typeof reconciliationItems.$inferSelect;

export interface ItemFilter {
  status?: ReconciliationStatus;
  kind?: ReconciliationKind;
  insurerId?: string;
  ownerStaffId?: string;
  /** The id of the last item on the previous page. */
  after?: { openedAt: Date; id: string };
  limit: number;
}

/** Refunds and the reconciliation items that lead to them. */
@Injectable()
export class RefundsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Payment ownership is immutable; discover it without taking the payment lock before the customer lock. */
  async paymentCustomerId(tx: Transaction, transactionId: string): Promise<string | undefined> {
    const [payment] = await tx.select({ customerId: payments.customerId }).from(payments)
      .where(eq(payments.transactionId, transactionId));
    return payment?.customerId;
  }

  async lockPaymentByTransaction(tx: Transaction, transactionId: string) {
    const [payment] = await tx.select().from(payments).where(eq(payments.transactionId, transactionId)).for('update');
    return payment;
  }

  async lockPayment(tx: Transaction, id: string) {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
    return payment;
  }

  async lockRefund(tx: Transaction, id: string) {
    const [refund] = await tx.select().from(paymentRefunds).where(eq(paymentRefunds.id, id)).for('update');
    return refund;
  }

  async findRefund(id: string) {
    const [refund] = await this.db.select().from(paymentRefunds).where(eq(paymentRefunds.id, id));
    return refund;
  }

  async lockRefundByProviderId(tx: Transaction, paymentId: string, providerRefundId: string) {
    const [refund] = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, paymentId), eq(paymentRefunds.providerRefundId, providerRefundId)))
      .for('update');
    return refund;
  }

  /** The money already returned on a payment. */
  async refundedMinor(tx: Transaction | Database, paymentId: string): Promise<number> {
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${paymentRefunds.amountMinor}), 0)::text` })
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, paymentId), eq(paymentRefunds.status, 'COMPLETED')));
    return Number(row.total);
  }

  async openRefund(tx: Transaction, paymentId: string) {
    const [refund] = await tx
      .select()
      .from(paymentRefunds)
      .where(and(eq(paymentRefunds.paymentId, paymentId), inArray(paymentRefunds.status, OPEN_REFUND_STATUSES)));
    return refund;
  }

  /**
   * A proposal whose approval expired, or was rejected outside the refund's own
   * hook, can never be approved, so it stops blocking a new one.
   */
  async expireAbandoned(tx: Transaction, paymentId: string | null, at: Date) {
    return tx
      .update(paymentRefunds)
      .set({ status: 'EXPIRED', updatedAt: at })
      .where(
        and(
          eq(paymentRefunds.status, 'PROPOSED'),
          paymentId ? eq(paymentRefunds.paymentId, paymentId) : undefined,
          sql`exists (select 1 from ${approvalRequests} where ${approvalRequests.id} = ${paymentRefunds.approvalRequestId} and ${approvalRequests.status} in ('EXPIRED', 'REJECTED'))`,
        ),
      )
      .returning({ id: paymentRefunds.id });
  }

  async insertRefund(tx: Transaction, refund: NewRefund) {
    const [created] = await tx.insert(paymentRefunds).values(refund).returning();
    return created;
  }

  async moveRefund(tx: Transaction, id: string, from: readonly RefundStatus[], patch: Partial<NewRefund>) {
    const [moved] = await tx
      .update(paymentRefunds)
      .set(patch)
      .where(and(eq(paymentRefunds.id, id), inArray(paymentRefunds.status, from)))
      .returning();
    return moved;
  }

  refundsOf(paymentIds: string[]) {
    if (paymentIds.length === 0) return Promise.resolve([] as RefundRow[]);
    return this.db.select().from(paymentRefunds).where(inArray(paymentRefunds.paymentId, paymentIds)).orderBy(asc(paymentRefunds.createdAt));
  }

  /** Approved refunds the send job has not delivered after a grace, and submitted ones whose answer has not come. */
  dueForProvider(submittedBefore: Date, limit: number) {
    return this.db
      .select({ id: paymentRefunds.id, status: paymentRefunds.status })
      .from(paymentRefunds)
      .where(
        or(
          and(eq(paymentRefunds.status, 'APPROVED'), lt(paymentRefunds.approvedAt, submittedBefore)),
          and(eq(paymentRefunds.status, 'SUBMITTED'), lt(paymentRefunds.submittedAt, submittedBefore)),
        ),
      )
      .orderBy(asc(paymentRefunds.updatedAt))
      .limit(limit);
  }

  async providerPaymentIdOf(tx: Transaction, paymentId: string) {
    const [payment] = await tx.select({ providerPaymentId: payments.providerPaymentId }).from(payments).where(eq(payments.id, paymentId));
    return payment?.providerPaymentId ?? null;
  }

  async lockItem(tx: Transaction, id: string) {
    const [item] = await tx.select().from(reconciliationItems).where(eq(reconciliationItems.id, id)).for('update');
    return item;
  }

  async moveItem(tx: Transaction, id: string, patch: Partial<typeof reconciliationItems.$inferInsert>) {
    const [moved] = await tx.update(reconciliationItems).set(patch).where(eq(reconciliationItems.id, id)).returning();
    return moved;
  }

  /** Items still open for a payment, of the given kinds, locked. */
  openItemsFor(tx: Transaction, paymentId: string, kinds: readonly ReconciliationKind[]) {
    return tx
      .select()
      .from(reconciliationItems)
      .where(and(eq(reconciliationItems.paymentId, paymentId), inArray(reconciliationItems.kind, kinds), ne(reconciliationItems.status, 'RESOLVED')))
      .for('update');
  }

  async resolveItem(tx: Transaction, id: string, outcome: ReconciliationOutcome, note: string, at: Date, staffId: string | null) {
    const [resolved] = await tx
      .update(reconciliationItems)
      .set({ status: 'RESOLVED', outcome, resolutionNote: note, resolvedAt: at, resolvedByStaffId: staffId })
      .where(and(eq(reconciliationItems.id, id), ne(reconciliationItems.status, 'RESOLVED')))
      .returning();
    return resolved;
  }

  async cancelFailedPolicy(tx: Transaction, paymentId: string, at: Date) {
    const [cancelled] = await tx
      .update(policies)
      .set({ status: 'CANCELLED', cancelledAt: at })
      .where(and(eq(policies.paymentId, paymentId), eq(policies.status, 'ISSUANCE_FAILED')))
      .returning({ policyNumber: policies.policyNumber });
    return cancelled;
  }

  /** The queue, oldest first, so whatever has waited longest is seen first. */
  listItems(filter: ItemFilter) {
    return this.db
      .select({
        item: reconciliationItems,
        insurerName: insurers.name,
        ownerName: staffUsers.fullName,
        transactionId: payments.transactionId,
        paymentStatus: payments.status,
        paidMinor: payments.amountMinor,
        customerId: payments.customerId,
        providerPaymentId: payments.providerPaymentId,
      })
      .from(reconciliationItems)
      .leftJoin(insurers, eq(insurers.id, reconciliationItems.insurerId))
      .leftJoin(staffUsers, eq(staffUsers.id, reconciliationItems.ownerStaffId))
      .leftJoin(payments, eq(payments.id, reconciliationItems.paymentId))
      .where(
        and(
          filter.status ? eq(reconciliationItems.status, filter.status) : undefined,
          filter.kind ? eq(reconciliationItems.kind, filter.kind) : undefined,
          filter.insurerId ? eq(reconciliationItems.insurerId, filter.insurerId) : undefined,
          filter.ownerStaffId ? eq(reconciliationItems.ownerStaffId, filter.ownerStaffId) : undefined,
          filter.after
            ? or(
                gt(reconciliationItems.openedAt, filter.after.openedAt),
                and(eq(reconciliationItems.openedAt, filter.after.openedAt), gt(reconciliationItems.id, filter.after.id)),
              )
            : undefined,
        ),
      )
      .orderBy(asc(reconciliationItems.openedAt), asc(reconciliationItems.id))
      .limit(filter.limit);
  }

  async findItem(id: string) {
    const [item] = await this.db.select().from(reconciliationItems).where(eq(reconciliationItems.id, id));
    return item;
  }

  /** An active InsurShield administrator, the only kind of person who can own an item. */
  async insurshieldAdmin(tx: Transaction, staffId: string) {
    const [staff] = await tx
      .select({ id: staffUsers.id, fullName: staffUsers.fullName })
      .from(staffUsers)
      .where(and(eq(staffUsers.id, staffId), eq(staffUsers.isActive, true), isNull(staffUsers.insurerId), inArray(staffUsers.role, ['ADMIN', 'SUPER_ADMIN'])));
    return staff;
  }

  latestRefundFor(paymentId: string) {
    return this.db.select().from(paymentRefunds).where(eq(paymentRefunds.paymentId, paymentId)).orderBy(desc(paymentRefunds.createdAt)).limit(1);
  }
}
