import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { customers, insurers, payments, policies, quoteRequests, vehicles } from '../db/schema.js';
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
    currency: string;
    confirmedAt: Date | null;
  };
}

export type PolicyRenewal = RenewalRequest & { renewalOfPolicyNumber: string };

/** What a renewal carries forward from the request the policy was bought on. */
export interface CarriedForward {
  vehicleValueMinor: number;
  vehicleUsage: string;
  insuranceType: (typeof quoteRequests.$inferSelect)['insuranceType'];
  coverageDuration: (typeof quoteRequests.$inferSelect)['coverageDuration'];
  matchRtsaAnniversary: boolean;
  rtsaRegistrationDate: Date | null;
}

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
    currency: payments.currency,
    confirmedAt: payments.confirmedAt,
  },
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
      .innerJoin(payments, eq(payments.id, policies.paymentId));
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
      })
      .from(quoteRequests)
      .where(inArray(quoteRequests.renewalOfPolicyNumber, policyNumbers))
      .orderBy(desc(quoteRequests.submittedAt))
      .then((rows) => rows.filter((row): row is PolicyRenewal => row.renewalOfPolicyNumber !== null));
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

  async findCarriedForward(tx: Transaction, quoteRequestId: string): Promise<CarriedForward | undefined> {
    const [request] = await tx
      .select({
        vehicleValueMinor: quoteRequests.vehicleValueMinor,
        vehicleUsage: quoteRequests.vehicleUsage,
        insuranceType: quoteRequests.insuranceType,
        coverageDuration: quoteRequests.coverageDuration,
        matchRtsaAnniversary: quoteRequests.matchRtsaAnniversary,
        rtsaRegistrationDate: quoteRequests.rtsaRegistrationDate,
      })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, quoteRequestId));
    return request;
  }
}
