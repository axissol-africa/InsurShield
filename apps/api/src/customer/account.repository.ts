import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { PolicyStatus } from '../common/domain/enums.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { customers, policies } from '../db/schema.js';

/** A paid policy awaiting its certificate is already cover the customer bought. */
const IN_FORCE: PolicyStatus[] = ['AWAITING_INSURER_CERTIFICATE', 'ACTIVE'];

@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Locks the customer until `tx` ends. A payment writing their policy holds a key share of this row, so it is waited for. */
  async lockCustomer(tx: Transaction, customerId: string): Promise<void> {
    await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for('update');
  }

  /**
   * The customer's policies in force. Not locked: a renewal or claim holds its policy and then needs the customer
   * row, so a lock here would deadlock. A policy comes into force only through a payment, which the customer lock waits for.
   */
  async policiesInForce(tx: Transaction, customerId: string): Promise<string[]> {
    const rows = await tx
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(and(eq(policies.customerId, customerId), inArray(policies.status, IN_FORCE)))
      .orderBy(asc(policies.policyNumber));
    return rows.map((row) => row.policyNumber);
  }

  async close(tx: Transaction, customerId: string, closedAt: Date): Promise<void> {
    await tx.update(customers).set({ deletedAt: closedAt }).where(eq(customers.id, customerId));
  }
}
