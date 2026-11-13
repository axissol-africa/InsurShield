import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { authVerifications, customers, supportPasswordResetAttempts } from '../db/schema.js';

export interface SupportResetTarget {
  id: string;
  email: string;
  userId: string | null;
}

@Injectable()
export class SupportPasswordResetRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /**
   * The actor lock serialises that administrator's total quota. The customer
   * row lock serialises every administrator's requests for one customer, so
   * concurrent clicks cannot both pass a count taken before either insert.
   */
  async lockRateBuckets(tx: Transaction, staffId: string): Promise<void> {
    await tx.execute(sql`
      SELECT pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended(${`support-password-reset:staff:${staffId}`}, 0)
      )
    `);
  }

  async lockOpenCustomer(tx: Transaction, customerId: string): Promise<SupportResetTarget | undefined> {
    const [customer] = await tx
      .select({ id: customers.id, email: customers.email, userId: customers.userId })
      .from(customers)
      .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
      .for('update');
    return customer;
  }

  async attemptsForCustomerSince(tx: Transaction, customerId: string, since: Date): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(supportPasswordResetAttempts)
      .where(and(
        eq(supportPasswordResetAttempts.customerId, customerId),
        gte(supportPasswordResetAttempts.createdAt, since),
      ));
    return row.total;
  }

  async attemptsForStaffSince(tx: Transaction, staffId: string, since: Date): Promise<number> {
    const [row] = await tx
      .select({ total: count() })
      .from(supportPasswordResetAttempts)
      .where(and(
        eq(supportPasswordResetAttempts.requestedByStaffId, staffId),
        gte(supportPasswordResetAttempts.createdAt, since),
      ));
    return row.total;
  }

  async createAttempt(tx: Transaction, input: { customerId: string; staffId: string; reason: string }) {
    const [attempt] = await tx
      .insert(supportPasswordResetAttempts)
      .values({ customerId: input.customerId, requestedByStaffId: input.staffId, reason: input.reason })
      .returning({ id: supportPasswordResetAttempts.id, createdAt: supportPasswordResetAttempts.createdAt });
    return attempt;
  }

  async createToken(tx: Transaction, input: { userId: string; token: string; expiresAt: Date }) {
    const [verification] = await tx
      .insert(authVerifications)
      .values({
        identifier: `reset-password:${input.token}`,
        value: input.userId,
        expiresAt: input.expiresAt,
      })
      .returning({ id: authVerifications.id });
    return verification;
  }

  async deleteToken(tx: Transaction, verificationId: string): Promise<void> {
    await tx.delete(authVerifications).where(eq(authVerifications.id, verificationId));
  }

  async markDelivered(tx: Transaction, input: { id: string; provider: string; providerReference: string; deliveredAt: Date }) {
    await tx
      .update(supportPasswordResetAttempts)
      .set({
        deliveryStatus: 'DELIVERED',
        deliveryProvider: input.provider,
        deliveryReference: input.providerReference,
        deliveredAt: input.deliveredAt,
      })
      .where(eq(supportPasswordResetAttempts.id, input.id));
  }

  async markFailed(tx: Transaction, id: string, failedAt: Date): Promise<void> {
    await tx
      .update(supportPasswordResetAttempts)
      .set({ deliveryStatus: 'FAILED', failedAt })
      .where(eq(supportPasswordResetAttempts.id, id));
  }
}
