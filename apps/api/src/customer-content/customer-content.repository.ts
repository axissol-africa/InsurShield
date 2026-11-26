import { Inject, Injectable } from '@nestjs/common';
import { desc, eq, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { customerContentVersions } from '../db/schema.js';
export type ContentVersion = typeof customerContentVersions.$inferSelect;

@Injectable()
export class CustomerContentRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  transaction<T>(work: (tx: Transaction) => Promise<T>) { return this.db.transaction(work); }
  async lock(tx: Transaction, slug: string) {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'customer-content:' + slug}))`);
    return this.history(slug, tx);
  }
  history(slug: string, tx: Database | Transaction = this.db) {
    return tx.select().from(customerContentVersions).where(eq(customerContentVersions.slug, slug)).orderBy(desc(customerContentVersions.version));
  }
  list(offset: number, limit: number) {
    return this.db.select().from(customerContentVersions).orderBy(desc(customerContentVersions.createdAt), desc(customerContentVersions.id)).offset(offset).limit(limit);
  }
  async publicCandidates(day: string) {
    // Include expired and withdrawn approvals in the latest selection so they
    // suppress older wording; drafts and future approvals do not suppress it.
    return this.db.selectDistinctOn([customerContentVersions.slug]).from(customerContentVersions)
      .where(sql`${customerContentVersions.approvedAt} IS NOT NULL AND (${customerContentVersions.effectiveFrom} <= ${day}::date OR ${customerContentVersions.status} = 'WITHDRAWN')`)
      .orderBy(customerContentVersions.slug, desc(customerContentVersions.version));
  }
  async create(tx: Transaction, values: typeof customerContentVersions.$inferInsert) {
    const [row] = await tx.insert(customerContentVersions).values(values).returning();
    if (!row) throw new Error('Content insert returned no row');
    return row;
  }
  async decide(tx: Transaction, id: string, values: Pick<Partial<ContentVersion>, 'status' | 'approvedAt' | 'approvedByStaffId' | 'withdrawnAt' | 'withdrawnByStaffId' | 'withdrawalReason'>) {
    const [row] = await tx.update(customerContentVersions).set(values).where(eq(customerContentVersions.id, id)).returning();
    if (!row) throw new Error('Locked content version disappeared');
    return row;
  }
}
