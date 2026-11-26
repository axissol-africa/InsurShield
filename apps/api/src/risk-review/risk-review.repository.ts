import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerQuotes, reconciliationItems, riskReviewFlags, staffUsers } from '../db/schema.js';
import type { WorkflowType } from './domain/risk-review.js';
import type { ListRiskQuery } from './dto/risk-review.dto.js';
export type RiskReviewRow = typeof riskReviewFlags.$inferSelect;
@Injectable()
export class RiskReviewRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  transaction<T>(work: (tx: Transaction) => Promise<T>) { return this.db.transaction(work); }
  list(query: ListRiskQuery) {
    return this.db.select().from(riskReviewFlags).where(and(
      query.status ? eq(riskReviewFlags.status, query.status) : undefined,
      query.cursor ? gt(riskReviewFlags.id, query.cursor) : undefined,
    )).orderBy(asc(riskReviewFlags.id)).limit((query.limit ?? 50) + 1);
  }
  async referenceExists(tx: Transaction, type: WorkflowType, id: string) {
    const table = type === 'QUOTE' ? insurerQuotes : reconciliationItems;
    return (await tx.select({ id: table.id }).from(table).where(eq(table.id, id)).for('key share')).length === 1;
  }
  async activeAdmin(tx: Transaction, id: string) {
    return (await tx.select({ id: staffUsers.id }).from(staffUsers).where(and(
      eq(staffUsers.id, id), eq(staffUsers.isActive, true), isNull(staffUsers.insurerId), inArray(staffUsers.role, ['ADMIN', 'SUPER_ADMIN']),
    )).for('share')).length === 1;
  }
  async create(tx: Transaction, values: typeof riskReviewFlags.$inferInsert) {
    const [row] = await tx.insert(riskReviewFlags).values(values).returning();
    return row;
  }
  async lock(tx: Transaction, id: string) {
    const [row] = await tx.select().from(riskReviewFlags).where(eq(riskReviewFlags.id, id)).for('update');
    return row;
  }
  async update(tx: Transaction, row: RiskReviewRow, values: Partial<typeof riskReviewFlags.$inferInsert>) {
    const [updated] = await tx.update(riskReviewFlags).set({ ...values, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(riskReviewFlags.id, row.id), eq(riskReviewFlags.version, row.version))).returning();
    return updated;
  }
}
