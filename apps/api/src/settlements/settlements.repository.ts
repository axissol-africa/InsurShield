import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  insurerQuotes,
  insurers,
  moneyAdjustments,
  paymentRefunds,
  payments,
  policies,
  settlementLines,
  settlements,
} from '../db/schema.js';

export type SettlementRow = typeof settlements.$inferSelect;
export type LineRow = typeof settlementLines.$inferSelect;

/** Cover that stands, or is still being issued: what an insurer is paid for. */
const LIVE_POLICY = ['ACTIVE', 'AWAITING_INSURER_CERTIFICATE'] as const;

@Injectable()
export class SettlementsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async insurerName(tx: Transaction | Database, insurerId: string) {
    const [insurer] = await tx.select({ name: insurers.name }).from(insurers).where(eq(insurers.id, insurerId));
    return insurer?.name;
  }

  async lockForPeriod(tx: Transaction, insurerId: string, period: string) {
    const [found] = await tx
      .select()
      .from(settlements)
      .where(and(eq(settlements.insurerId, insurerId), eq(settlements.period, period)))
      .for('update');
    return found;
  }

  async lock(tx: Transaction, id: string) {
    const [found] = await tx.select().from(settlements).where(eq(settlements.id, id)).for('update');
    return found;
  }

  async remove(tx: Transaction, id: string) {
    await tx.delete(settlements).where(eq(settlements.id, id));
  }

  /**
   * Confirmed payments for this insurer's quotes, not yet settled, up to the
   * end of the period, whose cover stands or is being issued. Earlier ones
   * missed by a previous settlement are picked up, never lost.
   */
  unsettledPayments(tx: Transaction, insurerId: string, before: Date) {
    return tx
      .select({
        id: payments.id,
        transactionId: payments.transactionId,
        confirmedAt: payments.confirmedAt,
        amountBreakdown: payments.amountBreakdown,
        amountMinor: payments.amountMinor,
      })
      .from(payments)
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .innerJoin(policies, eq(policies.paymentId, payments.id))
      .where(
        and(
          eq(insurerQuotes.insurerId, insurerId),
          eq(payments.status, 'CONFIRMED'),
          isNull(payments.settlementId),
          lt(payments.confirmedAt, before),
          inArray(policies.status, LIVE_POLICY),
        ),
      )
      .orderBy(asc(payments.confirmedAt), asc(payments.id));
  }

  /** Completed refunds on cover that stayed live: those come out of the insurer's money. */
  unsettledRefunds(tx: Transaction, insurerId: string, before: Date) {
    return tx
      .select({ id: paymentRefunds.id, amountMinor: paymentRefunds.amountMinor, completedAt: paymentRefunds.completedAt, transactionId: payments.transactionId })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .innerJoin(policies, eq(policies.paymentId, payments.id))
      .where(
        and(
          eq(insurerQuotes.insurerId, insurerId),
          eq(paymentRefunds.status, 'COMPLETED'),
          isNull(paymentRefunds.settlementId),
          lt(paymentRefunds.completedAt, before),
          inArray(policies.status, LIVE_POLICY),
        ),
      )
      .orderBy(asc(paymentRefunds.completedAt), asc(paymentRefunds.id));
  }

  unsettledAdjustments(tx: Transaction, insurerId: string, before: Date) {
    return tx
      .select({ id: moneyAdjustments.id, amountMinor: moneyAdjustments.amountMinor, createdAt: moneyAdjustments.createdAt, kind: moneyAdjustments.kind })
      .from(moneyAdjustments)
      .where(and(eq(moneyAdjustments.insurerId, insurerId), isNull(moneyAdjustments.settlementId), lt(moneyAdjustments.createdAt, before)))
      .orderBy(asc(moneyAdjustments.createdAt), asc(moneyAdjustments.id));
  }

  async insert(tx: Transaction, settlement: typeof settlements.$inferInsert, lines: Omit<typeof settlementLines.$inferInsert, 'settlementId'>[]) {
    const [created] = await tx.insert(settlements).values(settlement).returning();
    if (lines.length > 0) await tx.insert(settlementLines).values(lines.map((line) => ({ ...line, settlementId: created.id })));
    return created;
  }

  async move(tx: Transaction, id: string, patch: Partial<typeof settlements.$inferInsert>) {
    const [moved] = await tx.update(settlements).set(patch).where(eq(settlements.id, id)).returning();
    return moved;
  }

  linesOf(settlementId: string, tx: Transaction | Database = this.db) {
    return tx.select().from(settlementLines).where(eq(settlementLines.settlementId, settlementId)).orderBy(asc(settlementLines.occurredAt), asc(settlementLines.id));
  }

  /** Marks each record settled, only if no settlement has taken it; the counts say whether all were still free. */
  async markSettled(tx: Transaction, settlementId: string, lines: LineRow[]) {
    const ids = (pick: (line: LineRow) => string | null) => lines.map(pick).filter((id): id is string => id !== null);
    const paymentIds = ids((line) => line.paymentId);
    const refundIds = ids((line) => line.refundId);
    const adjustmentIds = ids((line) => line.adjustmentId);
    const paid = paymentIds.length
      ? await tx.update(payments).set({ settlementId }).where(and(inArray(payments.id, paymentIds), isNull(payments.settlementId))).returning({ id: payments.id })
      : [];
    const refunded = refundIds.length
      ? await tx
          .update(paymentRefunds)
          .set({ settlementId })
          .where(and(inArray(paymentRefunds.id, refundIds), isNull(paymentRefunds.settlementId)))
          .returning({ id: paymentRefunds.id })
      : [];
    const adjusted = adjustmentIds.length
      ? await tx
          .update(moneyAdjustments)
          .set({ settlementId })
          .where(and(inArray(moneyAdjustments.id, adjustmentIds), isNull(moneyAdjustments.settlementId)))
          .returning({ id: moneyAdjustments.id })
      : [];
    return paid.length === paymentIds.length && refunded.length === refundIds.length && adjusted.length === adjustmentIds.length;
  }

  list(filter: { insurerId?: string; finalisedOnly?: boolean }) {
    return this.db
      .select({ settlement: settlements, insurerName: insurers.name })
      .from(settlements)
      .innerJoin(insurers, eq(insurers.id, settlements.insurerId))
      .where(
        and(
          filter.insurerId ? eq(settlements.insurerId, filter.insurerId) : undefined,
          filter.finalisedOnly ? eq(settlements.status, 'FINALISED') : undefined,
        ),
      )
      .orderBy(desc(settlements.periodStart), asc(insurers.name));
  }

  async find(id: string) {
    const [found] = await this.db
      .select({ settlement: settlements, insurerName: insurers.name })
      .from(settlements)
      .innerJoin(insurers, eq(insurers.id, settlements.insurerId))
      .where(eq(settlements.id, id));
    return found;
  }

  async insertAdjustment(tx: Transaction, adjustment: typeof moneyAdjustments.$inferInsert) {
    const [created] = await tx.insert(moneyAdjustments).values(adjustment).onConflictDoNothing().returning();
    return created;
  }
}
