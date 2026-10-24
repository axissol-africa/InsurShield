import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, ne } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { claimAttachments, claimNotifications, customers, insurers, policies } from '../db/schema.js';

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

  /** An insurer a claim can be notified to: any that is not deleted. */
  async findInsurer(tx: Transaction, insurerId: string): Promise<{ id: string; name: string } | undefined> {
    const [insurer] = await tx
      .select({ id: insurers.id, name: insurers.name })
      .from(insurers)
      .where(and(eq(insurers.id, insurerId), ne(insurers.status, 'DELETED')));
    return insurer;
  }

  async findOwnedPolicyNumber(tx: Transaction, customerId: string, policyNumber: string): Promise<string | undefined> {
    const [policy] = await tx
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.customerId, customerId)));
    return policy?.policyNumber;
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
