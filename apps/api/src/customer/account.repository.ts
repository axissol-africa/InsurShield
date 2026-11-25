import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, inArray, isNull, or } from 'drizzle-orm';
import { OPEN_PAYMENT_STATUSES, OPEN_REFUND_STATUSES, OPEN_SERVICE_REQUEST_STATUSES, type PolicyStatus } from '../common/domain/enums.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { customers, paymentRefunds, payments, policies, quoteRequestDrafts, quoteRequests, serviceRequests } from '../db/schema.js';

/** A paid policy awaiting its certificate is already cover the customer bought. */
const IN_FORCE: PolicyStatus[] = ['AWAITING_INSURER_CERTIFICATE', 'ACTIVE'];

@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Locks the customer until `tx` ends. A payment writing their policy holds a key share of this row, so it is waited for. */
  async lockCustomer(tx: Transaction, customerId: string): Promise<{ userId: string | null } | undefined> {
    const [customer] = await tx
      .select({ userId: customers.userId })
      .from(customers)
      .where(eq(customers.id, customerId))
      .for('update');
    return customer;
  }

  /**
   * The customer's policies in force. Not locked: a renewal or claim holds its policy and then needs the customer
   * row, so a lock here would deadlock. A policy comes into force only through a payment, which the customer lock waits for.
   */
  async policiesInForce(tx: Transaction, customerId: string): Promise<string[]> {
    const rows = await tx
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(
        and(
          eq(policies.customerId, customerId),
          inArray(policies.status, IN_FORCE),
          // Cover whose last day has passed is no longer in force, whatever its status says.
          or(isNull(policies.policyEndDate), gt(policies.policyEndDate, new Date())),
        ),
      )
      .orderBy(asc(policies.policyNumber));
    return rows.map((row) => row.policyNumber);
  }

  async close(tx: Transaction, customerId: string, closedAt: Date): Promise<void> {
    await tx.update(customers).set({ deletedAt: closedAt }).where(eq(customers.id, customerId));
  }

  /** What is still in progress for the customer and would be cut off by closing, by kind. */
  async inProgress(tx: Transaction, customerId: string): Promise<{ serviceRequests: string[]; payments: string[]; refunds: string[] }> {
    const [asked, paying, refunding] = await Promise.all([
      tx
        .select({ reference: serviceRequests.reference })
        .from(serviceRequests)
        .where(and(eq(serviceRequests.customerId, customerId), inArray(serviceRequests.status, [...OPEN_SERVICE_REQUEST_STATUSES])))
        .orderBy(asc(serviceRequests.reference)),
      tx
        .select({ reference: payments.transactionId })
        .from(payments)
        .where(and(eq(payments.customerId, customerId), inArray(payments.status, [...OPEN_PAYMENT_STATUSES])))
        .orderBy(asc(payments.transactionId)),
      tx
        .select({ reference: payments.transactionId })
        .from(paymentRefunds)
        .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
        .where(and(eq(payments.customerId, customerId), inArray(paymentRefunds.status, [...OPEN_REFUND_STATUSES])))
        .orderBy(asc(payments.transactionId)),
    ]);
    return {
      serviceRequests: asked.map((row) => row.reference),
      payments: paying.map((row) => row.reference),
      refunds: refunding.map((row) => row.reference),
    };
  }

  /** Ends the customer's quote requests still open, so no insurer keeps quoting for a closed account. */
  async endOpenRequests(tx: Transaction, customerId: string, at: Date): Promise<{ id: string; status: string }[]> {
    const open = and(eq(quoteRequests.customerId, customerId), inArray(quoteRequests.status, ['SUBMITTED', 'QUOTED']), gt(quoteRequests.expiresAt, at));
    const before = await tx.select({ id: quoteRequests.id, status: quoteRequests.status }).from(quoteRequests).where(open).orderBy(asc(quoteRequests.id)).for('update');
    if (before.length > 0) await tx.update(quoteRequests).set({ status: 'EXPIRED', expiresAt: at }).where(open);
    return before;
  }

  /** Unfinished journeys go: nothing was sent from them. */
  async deleteDrafts(tx: Transaction, customerId: string): Promise<number> {
    const rows = await tx.delete(quoteRequestDrafts).where(eq(quoteRequestDrafts.customerId, customerId)).returning({ id: quoteRequestDrafts.id });
    return rows.length;
  }
}
