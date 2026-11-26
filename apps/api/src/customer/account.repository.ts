import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { OPEN_PAYMENT_STATUSES, OPEN_REFUND_STATUSES, OPEN_SERVICE_REQUEST_STATUSES, type PolicyStatus } from '../common/domain/enums.js';
import { currentOn } from '../common/domain/lusaka.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { customers, policies, payments, paymentRefunds, serviceRequests, reconciliationItems } from '../db/schema.js';

/** A paid policy awaiting its certificate is already cover the customer bought. */
const IN_FORCE: PolicyStatus[] = ['AWAITING_INSURER_CERTIFICATE', 'ACTIVE'];

@Injectable()
export class AccountRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Originating commands must lock the open customer before their own records. */
  async lockCustomer(tx: Transaction, customerId: string): Promise<{ userId: string | null; deletedAt: Date | null } | undefined> {
    const [customer] = await tx
      .select({ userId: customers.userId, deletedAt: customers.deletedAt })
      .from(customers)
      .where(eq(customers.id, customerId))
      .for('update');
    return customer;
  }

  /**
   * The customer's policies in force. Not locked: a renewal or claim holds its policy and then needs the customer
   * row, so a lock here would deadlock. A policy comes into force only through a payment, which the customer lock waits for.
   */
  async policiesInForce(tx: Transaction, customerId: string, now: Date): Promise<string[]> {
    const rows = await tx
      .select({
        policyNumber: policies.policyNumber,
        endDate: policies.policyEndDate,
        status: policies.status,
      })
      .from(policies)
      .where(and(eq(policies.customerId, customerId), inArray(policies.status, IN_FORCE)))
      .orderBy(asc(policies.policyNumber));
    return rows.filter((row) => row.status === 'AWAITING_INSURER_CERTIFICATE' || currentOn(row.endDate, now)).map((row) => row.policyNumber);
  }

  async hasOpenServiceRequest(tx: Transaction, customerId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: serviceRequests.reference })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.customerId, customerId), inArray(serviceRequests.status, OPEN_SERVICE_REQUEST_STATUSES)))
      .limit(1);
    return rows.length > 0;
  }

  async hasOpenPayment(tx: Transaction, customerId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.customerId, customerId), inArray(payments.status, OPEN_PAYMENT_STATUSES)))
      .limit(1);
    return rows.length > 0;
  }

  async hasOpenRefund(tx: Transaction, customerId: string): Promise<boolean> {
    const rows = await tx
      .select({ id: paymentRefunds.id })
      .from(paymentRefunds)
      .innerJoin(payments, eq(payments.id, paymentRefunds.paymentId))
      .where(and(eq(payments.customerId, customerId), inArray(paymentRefunds.status, OPEN_REFUND_STATUSES)))
      .limit(1);
    if (rows.length > 0) return true;
    // A completed cancellation can owe a refund before finance proposes it.
    const owed = await tx
      .select({ id: reconciliationItems.id })
      .from(reconciliationItems)
      .innerJoin(payments, eq(payments.id, reconciliationItems.paymentId))
      .where(
        and(
          eq(payments.customerId, customerId),
          eq(reconciliationItems.kind, 'REFUND_REQUIRED'),
          inArray(reconciliationItems.status, ['OPEN', 'IN_PROGRESS']),
        ),
      )
      .limit(1);
    return owed.length > 0;
  }

  async close(tx: Transaction, customerId: string, closedAt: Date): Promise<void> {
    await tx.update(customers).set({ deletedAt: closedAt }).where(eq(customers.id, customerId));
  }
}
