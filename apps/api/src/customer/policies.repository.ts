import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { customers, insurerProductVersions, insurerProducts, insurers, payments, policies, quoteRequests, renewalReminders, vehicles } from '../db/schema.js';
import { customerAvailableProductConditions } from '../products/customer-availability.js';
import type { RenewalRequest } from './domain/renewal.js';

export type PolicyRow = typeof policies.$inferSelect;
export type VehicleRow = typeof vehicles.$inferSelect;

export interface PolicyWithParties {
  policy: PolicyRow;
  customer: { fullName: string; email: string; phone: string };
  insurerName: string;
  vehicle: VehicleRow;
  payment: {
    transactionId: string;
    status: (typeof payments.$inferSelect)['status'];
    method: (typeof payments.$inferSelect)['method'];
    amountMinor: number;
    rtsaAnniversaryFeeMinor: number;
    currency: string;
    confirmedAt: Date | null;
  };
  product: { name: string; versionNumber: number } | null;
  /** What the policy was quoted on; null only for a policy with no request behind it. */
  quoted: { vehicleValueMinor: number; vehicleUsage: string } | null;
}

export type PolicyRenewal = RenewalRequest & {
  renewalOfPolicyNumber: string;
  replacementInProgress: boolean;
  closedPurchase: boolean;
};

const PARTIES = {
  policy: policies,
  customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
  insurerName: insurers.name,
  vehicle: vehicles,
  payment: {
    transactionId: payments.transactionId,
    status: payments.status,
    method: payments.method,
    amountMinor: payments.amountMinor,
    rtsaAnniversaryFeeMinor: payments.rtsaAnniversaryFeeMinor,
    currency: payments.currency,
    confirmedAt: payments.confirmedAt,
  },
  product: { name: insurerProductVersions.name, versionNumber: insurerProductVersions.versionNumber },
  quoted: { vehicleValueMinor: quoteRequests.vehicleValueMinor, vehicleUsage: quoteRequests.vehicleUsage },
};

@Injectable()
export class PoliciesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private withParties() {
    return this.db
      .select(PARTIES)
      .from(policies)
      .innerJoin(customers, eq(customers.id, policies.customerId))
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
      .innerJoin(payments, eq(payments.id, policies.paymentId))
      .leftJoin(insurerProductVersions, eq(insurerProductVersions.id, policies.productVersionId))
      .leftJoin(quoteRequests, eq(quoteRequests.id, policies.quoteRequestId));
  }

  listForCustomer(customerId: string): Promise<PolicyWithParties[]> {
    return this.withParties().where(eq(policies.customerId, customerId)).orderBy(desc(policies.receivedAt));
  }

  async findOwned(customerId: string, policyNumber: string): Promise<PolicyWithParties | undefined> {
    const [row] = await this.withParties().where(
      and(eq(policies.policyNumber, policyNumber), eq(policies.customerId, customerId)),
    );
    return row;
  }

  /** Renewal requests started for these policies, newest first. */
  renewalsOf(policyNumbers: string[], tx?: Transaction): Promise<PolicyRenewal[]> {
    if (policyNumbers.length === 0) return Promise.resolve([]);
    return (tx ?? this.db)
      .select({
        id: quoteRequests.id,
        status: quoteRequests.status,
        expiresAt: quoteRequests.expiresAt,
        renewalOfPolicyNumber: quoteRequests.renewalOfPolicyNumber,
        replacementInProgress: sql<boolean>`exists (
          select 1 from ${payments} as attempt
          where attempt."quoteRequestId" = "quote_requests"."id"
            and attempt."status" in ('INITIATED', 'PENDING')
        ) or exists (
          select 1 from ${policies} as replacement
          join ${payments} as funding on replacement."paymentId" = funding."id"
          where replacement."quoteRequestId" = "quote_requests"."id"
            and replacement."status" in ('ACTIVE', 'AWAITING_INSURER_CERTIFICATE')
            and funding."status" = 'CONFIRMED'
        )`,
        closedPurchase: sql<boolean>`exists (
          select 1 from ${payments} as attempt
          where attempt."quoteRequestId" = "quote_requests"."id"
            and attempt."status" in ('CONFIRMED', 'REVERSED')
        )`,
      })
      .from(quoteRequests)
      .where(inArray(quoteRequests.renewalOfPolicyNumber, policyNumbers))
      .orderBy(desc(quoteRequests.submittedAt))
      .then((rows) => rows.filter((row): row is PolicyRenewal => row.renewalOfPolicyNumber !== null));
  }

  /** Active policies ending between `from` and `to`, with what a reminder needs. */
  endingBetween(from: Date, to: Date) {
    return this.db
      .select({
        policyNumber: policies.policyNumber,
        customerId: policies.customerId,
        policyEndDate: policies.policyEndDate,
        insurerName: insurers.name,
      })
      .from(policies)
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .where(and(eq(policies.status, 'ACTIVE'), gte(policies.policyEndDate, from), lte(policies.policyEndDate, to)));
  }

  remindersOf(policyNumbers: string[]) {
    if (policyNumbers.length === 0) return Promise.resolve([]);
    return this.db.select().from(renewalReminders).where(inArray(renewalReminders.policyNumber, policyNumbers));
  }

  /** True only for the first run to record this reminder. */
  async recordReminder(tx: Transaction, reminder: { policyNumber: string; kind: 'DUE' | 'LAPSED'; daysBefore: number }) {
    const [inserted] = await tx.insert(renewalReminders).values(reminder).onConflictDoNothing().returning({ id: renewalReminders.id });
    return Boolean(inserted);
  }

  /**
   * For each bought product version, the newest version of the same product a
   * customer may buy today, if any. The renewal journey starts from it.
   */
  async currentVersionsFor(productVersionIds: string[], now: Date) {
    if (productVersionIds.length === 0) return new Map<string, { id: string; name: string; versionNumber: number }>();
    const bought = await this.db
      .select({ id: insurerProductVersions.id, productId: insurerProductVersions.productId })
      .from(insurerProductVersions)
      .where(inArray(insurerProductVersions.id, productVersionIds));
    const productIds = [...new Set(bought.map((row) => row.productId))];
    const current = await this.db
      .select({
        id: insurerProductVersions.id,
        productId: insurerProducts.id,
        name: insurerProductVersions.name,
        versionNumber: insurerProductVersions.versionNumber,
      })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(...customerAvailableProductConditions(this.db, now, { productIds })))
      .orderBy(desc(insurerProductVersions.versionNumber));
    const newest = new Map<string, { id: string; name: string; versionNumber: number }>();
    for (const version of current) if (!newest.has(version.productId)) newest.set(version.productId, version);
    return new Map(bought.flatMap((row) => (newest.has(row.productId) ? [[row.id, newest.get(row.productId)!] as const] : [])));
  }

  /** The customer's own policy, locked until `tx` ends so only one renewal can be started for it. */
  async lockOwned(tx: Transaction, customerId: string, policyNumber: string): Promise<PolicyRow | undefined> {
    const [policy] = await tx
      .select()
      .from(policies)
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.customerId, customerId)))
      .for('update');
    return policy;
  }

}
