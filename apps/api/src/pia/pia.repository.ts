import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { piaConfig, piaConfigHistory, staffUsers } from '../db/schema.js';

const CURRENT = 'current';

@Injectable()
export class PiaRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async find(executor: Database | Transaction = this.db) {
    const [row] = await executor
      .select({ piaRateBps: piaConfig.piaRateBps, updatedAt: piaConfig.updatedAt, updatedBy: staffUsers.fullName })
      .from(piaConfig)
      .leftJoin(staffUsers, eq(staffUsers.id, piaConfig.updatedByStaffId))
      .where(eq(piaConfig.id, CURRENT));
    return row;
  }

  async lockCurrent(tx: Transaction) {
    const [row] = await tx
      .select({ piaRateBps: piaConfig.piaRateBps })
      .from(piaConfig)
      .where(eq(piaConfig.id, CURRENT))
      .for('update');
    return row;
  }

  async save(tx: Transaction, piaRateBps: number, updatedByStaffId: string): Promise<void> {
    await tx
      .insert(piaConfig)
      .values({ id: CURRENT, piaRateBps, updatedByStaffId })
      .onConflictDoUpdate({ target: piaConfig.id, set: { piaRateBps, updatedByStaffId, updatedAt: new Date() } });
  }

  async appendHistory(
    tx: Transaction,
    value: { piaRateBps: number; previousRateBps: number | null; changedByStaffId: string },
  ): Promise<void> {
    await tx.insert(piaConfigHistory).values(value);
  }
}

export type PiaRow = NonNullable<Awaited<ReturnType<PiaRepository['find']>>>;
