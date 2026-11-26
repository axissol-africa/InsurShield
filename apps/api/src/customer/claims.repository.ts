import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { claimAttachments, claimNotifications, customers, insurers, policies, serviceRequests, vehicles } from '../db/schema.js';

export type ClaimRow = typeof claimNotifications.$inferSelect;
export type NewClaim = typeof claimNotifications.$inferInsert;

export interface ClaimWithParties {
  claim: ClaimRow;
  insurerName: string;
  customerEmail: string | null;
}

export interface AttachmentRow {
  claimNumber: string;
  documentId: string;
}

@Injectable()
export class ClaimsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  listForCustomer(customerId: string): Promise<ClaimWithParties[]> {
    return this.db
      .select({ claim: claimNotifications, insurerName: insurers.name, customerEmail: customers.email })
      .from(claimNotifications)
      .innerJoin(insurers, eq(insurers.id, claimNotifications.insurerId))
      .leftJoin(customers, eq(customers.id, claimNotifications.customerId))
      .where(eq(claimNotifications.customerId, customerId))
      .orderBy(desc(claimNotifications.submittedAt));
  }

  attachmentsOf(claimNumbers: string[]): Promise<AttachmentRow[]> {
    if (claimNumbers.length === 0) return Promise.resolve([]);
    return this.db
      .select({ claimNumber: claimAttachments.claimNumber, documentId: claimAttachments.documentId })
      .from(claimAttachments)
      .where(inArray(claimAttachments.claimNumber, claimNumbers))
      .orderBy(asc(claimAttachments.id));
  }

  async lockOwnedPolicy(tx: Transaction, customerId: string, policyNumber: string) {
    const [record] = await tx.select({
      policy: policies,
      plate: vehicles.plateNumber,
      make: vehicles.make,
      model: vehicles.model,
      year: vehicles.year,
    }).from(policies).innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
      .where(and(eq(policies.customerId, customerId), eq(policies.policyNumber, policyNumber)))
      .for('share', { of: policies });
    if (!record) return undefined;
    if (record.policy.status !== 'CANCELLED') return { ...record, cancellationDay: null };

    // Read after acquiring the policy lock so a cancellation completed while waiting is visible here.
    const [cancellation] = await tx.select({ day: serviceRequests.effectiveDate })
      .from(serviceRequests)
      .where(and(eq(serviceRequests.policyNumber, policyNumber), eq(serviceRequests.type, 'CANCELLATION'),
        eq(serviceRequests.status, 'COMPLETED')))
      .orderBy(asc(serviceRequests.effectiveDate))
      .limit(1);
    return { ...record, cancellationDay: cancellation?.day ?? null };
  }

  /** A share lock prevents the final insurer removal check from racing a submission. */
  async lockInsurer(tx: Transaction, insurerId: string) {
    const [insurer] = await tx.select({ id: insurers.id, name: insurers.name, status: insurers.status, deletedAt: insurers.deletedAt })
      .from(insurers).where(eq(insurers.id, insurerId)).for('share');
    return insurer;
  }

  async insertClaim(tx: Transaction, claim: NewClaim): Promise<ClaimRow> {
    const [created] = await tx.insert(claimNotifications).values(claim).returning();
    return created;
  }

  async insertAttachments(tx: Transaction, claimNumber: string, documentIds: string[]): Promise<void> {
    if (documentIds.length === 0) return;
    await tx.insert(claimAttachments).values(documentIds.map((documentId) => ({ claimNumber, documentId })));
  }
}
