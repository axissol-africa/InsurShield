import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { servicesExistingBusinessWhere } from '../common/insurer-standing.js';
import { PERMISSIONS } from '../common/auth/permissions.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  customers,
  insurers,
  payments,
  policies,
  reconciliationItems,
  serviceRequestUpdates,
  serviceRequests,
  staffUsers,
} from '../db/schema.js';
import {
  OPEN_SERVICE_REQUEST_STATUSES,
  type ServiceRequestStatus,
  type StaffRole,
} from '../common/domain/enums.js';

export type ServiceRequestRow = typeof serviceRequests.$inferSelect;
export type NewServiceRequest = typeof serviceRequests.$inferInsert;
export type ServiceRequestUpdateRow = typeof serviceRequestUpdates.$inferSelect;
export type NewServiceRequestUpdate = typeof serviceRequestUpdates.$inferInsert;

/** A request with the names every party reads it by. */
export interface ServiceRequestWithParties {
  request: ServiceRequestRow;
  insurerName: string;
  customer: { fullName: string; email: string; phone: string };
}

/** Roles at an insurer who are told by email that a request is waiting: the ones who may work it. */
const SERVICE_REQUEST_HANDLERS: readonly StaffRole[] = PERMISSIONS['portal:service-request:manage'];

const WITH_PARTIES = {
  request: serviceRequests,
  insurerName: insurers.name,
  customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
};

@Injectable()
export class ServiceRequestsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private withParties(tx: Transaction | Database = this.db) {
    return tx
      .select(WITH_PARTIES)
      .from(serviceRequests)
      .innerJoin(insurers, eq(insurers.id, serviceRequests.insurerId))
      .innerJoin(customers, eq(customers.id, serviceRequests.customerId));
  }

  /** The customer's own policy, locked so two requests about it cannot interleave. */
  async lockOwnedPolicy(tx: Transaction, customerId: string, policyNumber: string) {
    const [policy] = await tx
      .select({
        policyNumber: policies.policyNumber,
        status: policies.status,
        insurerId: policies.insurerId,
        insurerName: insurers.name,
        policyEndDate: policies.policyEndDate,
      })
      .from(policies)
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.customerId, customerId)))
      .for('update', { of: policies });
    return policy;
  }

  async lockServicingInsurer(tx: Transaction, insurerId: string): Promise<boolean> {
    const [insurer] = await tx.select({ id: insurers.id }).from(insurers)
      .where(and(eq(insurers.id, insurerId), isNull(insurers.deletedAt), ...servicesExistingBusinessWhere())).for('share');
    return Boolean(insurer);
  }

  /** Whether a cancellation of this policy is already in hand. */
  async openCancellation(tx: Transaction, policyNumber: string): Promise<boolean> {
    const [open] = await tx
      .select({ reference: serviceRequests.reference })
      .from(serviceRequests)
      .where(
        and(
          eq(serviceRequests.policyNumber, policyNumber),
          eq(serviceRequests.type, 'CANCELLATION'),
          inArray(serviceRequests.status, [...OPEN_SERVICE_REQUEST_STATUSES]),
        ),
      )
      .limit(1);
    return Boolean(open);
  }

  async coverOf(tx: Transaction, policyNumber: string) {
    const [cover] = await tx
      .select({ startDate: policies.policyStartDate, endDate: policies.policyEndDate })
      .from(policies)
      .where(eq(policies.policyNumber, policyNumber));
    return cover;
  }

  async insert(tx: Transaction, request: NewServiceRequest): Promise<ServiceRequestRow> {
    const [created] = await tx.insert(serviceRequests).values(request).returning();
    return created;
  }

  async addUpdate(tx: Transaction, update: NewServiceRequestUpdate): Promise<ServiceRequestUpdateRow> {
    const [created] = await tx.insert(serviceRequestUpdates).values(update).returning();
    return created;
  }

  listForCustomer(customerId: string): Promise<ServiceRequestWithParties[]> {
    return this.withParties()
      .where(eq(serviceRequests.customerId, customerId))
      .orderBy(desc(serviceRequests.createdAt), desc(serviceRequests.reference));
  }

  /**
   * An insurer's queue: open requests first, then the rest, each oldest first,
   * so whatever has waited longest is at the top.
   */
  listForInsurer(insurerId: string, status?: ServiceRequestStatus): Promise<ServiceRequestWithParties[]> {
    const open = sql`CASE WHEN ${inArray(serviceRequests.status, [...OPEN_SERVICE_REQUEST_STATUSES])} THEN 0 ELSE 1 END`;
    return this.withParties()
      .where(and(eq(serviceRequests.insurerId, insurerId), status ? eq(serviceRequests.status, status) : undefined))
      .orderBy(open, asc(serviceRequests.createdAt), asc(serviceRequests.reference));
  }

  listAll(filter: { status?: ServiceRequestStatus; insurerId?: string }): Promise<ServiceRequestWithParties[]> {
    return this.withParties()
      .where(
        and(
          filter.status ? eq(serviceRequests.status, filter.status) : undefined,
          filter.insurerId ? eq(serviceRequests.insurerId, filter.insurerId) : undefined,
        ),
      )
      .orderBy(asc(serviceRequests.createdAt), asc(serviceRequests.reference))
      .limit(500);
  }

  async find(reference: string, tx: Transaction | Database = this.db): Promise<ServiceRequestWithParties | undefined> {
    const [found] = await this.withParties(tx).where(eq(serviceRequests.reference, reference));
    return found;
  }

  /** Locks the request row; the parties' names come with it. */
  async lock(tx: Transaction, reference: string): Promise<ServiceRequestWithParties | undefined> {
    const [found] = await this.withParties(tx).where(eq(serviceRequests.reference, reference)).for('update', { of: serviceRequests });
    return found;
  }

  /** Moves the request only if it is still where the caller found it. */
  async move(
    tx: Transaction,
    reference: string,
    from: readonly ServiceRequestStatus[],
    patch: Partial<NewServiceRequest> & { status: ServiceRequestStatus },
  ): Promise<ServiceRequestRow | undefined> {
    const [moved] = await tx
      .update(serviceRequests)
      .set(patch)
      .where(and(eq(serviceRequests.reference, reference), inArray(serviceRequests.status, [...from])))
      .returning();
    return moved;
  }

  async touch(tx: Transaction, reference: string): Promise<void> {
    await tx.update(serviceRequests).set({ updatedAt: new Date() }).where(eq(serviceRequests.reference, reference));
  }

  /** Every entry on these requests, oldest first, with the staff name for the insurer's and InsurShield's view. */
  updatesOf(references: string[], tx: Transaction | Database = this.db) {
    if (references.length === 0) return Promise.resolve([]);
    return tx
      .select({ update: serviceRequestUpdates, staffName: staffUsers.fullName })
      .from(serviceRequestUpdates)
      .leftJoin(staffUsers, and(eq(serviceRequestUpdates.authorKind, 'INSURER'), eq(staffUsers.id, serviceRequestUpdates.authorId)))
      .where(inArray(serviceRequestUpdates.reference, references))
      .orderBy(asc(serviceRequestUpdates.createdAt), asc(serviceRequestUpdates.id));
  }

  /** What was paid for the policy and is still the customer's to be refunded. */
  async paymentOf(tx: Transaction, policyNumber: string) {
    const [payment] = await tx
      .select({ id: payments.id, amountMinor: payments.amountMinor, transactionId: payments.transactionId })
      .from(policies)
      .innerJoin(payments, eq(payments.id, policies.paymentId))
      .where(eq(policies.policyNumber, policyNumber));
    return payment;
  }

  /** Ends cover in force. Nothing else cancels a policy that was issued. */
  async cancelPolicy(tx: Transaction, policyNumber: string, at: Date) {
    const [cancelled] = await tx
      .update(policies)
      .set({ status: 'CANCELLED', cancelledAt: at })
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.status, 'ACTIVE')))
      .returning({ policyNumber: policies.policyNumber });
    return cancelled;
  }

  async openRefundItem(tx: Transaction, item: typeof reconciliationItems.$inferInsert) {
    const [opened] = await tx.insert(reconciliationItems).values(item).onConflictDoNothing().returning({ id: reconciliationItems.id });
    return opened;
  }

  /** The insurer's people who work service requests, for the email that one is waiting. */
  handlersOf(tx: Transaction, insurerId: string) {
    return tx
      .select({ id: staffUsers.id, email: staffUsers.email })
      .from(staffUsers)
      .where(and(eq(staffUsers.insurerId, insurerId), eq(staffUsers.isActive, true), inArray(staffUsers.role, [...SERVICE_REQUEST_HANDLERS])))
      .orderBy(asc(staffUsers.email));
  }
}
