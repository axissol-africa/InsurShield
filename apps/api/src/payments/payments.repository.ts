import { Inject, Injectable } from '@nestjs/common';
import { and, eq, exists, isNull, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerQuotes, insurers, ncdApplications, ncdCodes, payments, policies, quoteRequests } from '../db/schema.js';

export type NewPayment = typeof payments.$inferInsert;
export type NewPolicy = typeof policies.$inferInsert;

const receiptColumns = {
  transactionId: payments.transactionId,
  status: payments.status,
  method: payments.method,
  amountMinor: payments.amountMinor,
  currency: payments.currency,
  confirmedAt: payments.confirmedAt,
  quoteRequestId: payments.quoteRequestId,
  policyNumber: policies.policyNumber,
};

export type ReceiptRow = {
  transactionId: string;
  status: (typeof payments.$inferSelect)['status'];
  method: (typeof payments.$inferSelect)['method'];
  amountMinor: number;
  currency: string;
  confirmedAt: Date | null;
  quoteRequestId: string;
  policyNumber: string | null;
};

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** The payment a key was used for, with what a replay is compared against. */
  async findByKey(idempotencyKey: string) {
    const [payment] = await this.db
      .select({
        ...receiptColumns,
        customerId: payments.customerId,
        insurerName: insurers.name,
      })
      .from(payments)
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .innerJoin(insurers, eq(insurers.id, insurerQuotes.insurerId))
      .leftJoin(policies, eq(policies.paymentId, payments.id))
      .where(eq(payments.idempotencyKey, idempotencyKey));
    return payment;
  }

  async findReceipt(customerId: string, transactionId: string): Promise<ReceiptRow | undefined> {
    const [receipt] = await this.db
      .select(receiptColumns)
      .from(payments)
      .leftJoin(policies, eq(policies.paymentId, payments.id))
      .where(and(eq(payments.transactionId, transactionId), eq(payments.customerId, customerId)));
    return receipt;
  }

  async findRequest(customerId: string, quoteRequestId: string) {
    const [request] = await this.db
      .select({
        id: quoteRequests.id,
        vehicleId: quoteRequests.vehicleId,
        insuranceType: quoteRequests.insuranceType,
        policyStartDate: quoteRequests.policyStartDate,
        policyEndDate: quoteRequests.policyEndDate,
        ncdCode: quoteRequests.ncdCode,
      })
      .from(quoteRequests)
      .where(and(eq(quoteRequests.id, quoteRequestId), eq(quoteRequests.customerId, customerId)));
    return request;
  }

  async findQuote(quoteRequestId: string, insurerName: string) {
    const [quote] = await this.db
      .select({
        id: insurerQuotes.id,
        premiumMinor: insurerQuotes.premiumMinor,
        validUntil: insurerQuotes.validUntil,
        insurerReference: insurerQuotes.insurerReference,
        documentId: insurerQuotes.documentId,
        insurerId: insurers.id,
        insurerName: insurers.name,
      })
      .from(insurerQuotes)
      .innerJoin(insurers, eq(insurers.id, insurerQuotes.insurerId))
      .where(and(eq(insurerQuotes.quoteRequestId, quoteRequestId), eq(insurers.name, insurerName)));
    return quote;
  }

  async findPolicyNumberForRequest(tx: Transaction, quoteRequestId: string): Promise<string | undefined> {
    const [policy] = await tx
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.quoteRequestId, quoteRequestId))
      .limit(1);
    return policy?.policyNumber;
  }

  async insertPayment(tx: Transaction, payment: NewPayment) {
    const [created] = await tx.insert(payments).values(payment).returning();
    return created;
  }

  async insertPolicy(tx: Transaction, policy: NewPolicy) {
    const [created] = await tx.insert(policies).values(policy).returning({ policyNumber: policies.policyNumber });
    return created;
  }

  /** Taken before any insert: the payment's foreign key would otherwise hold a lock this one must wait for. */
  async lockRequest(tx: Transaction, quoteRequestId: string): Promise<void> {
    await tx.select({ id: quoteRequests.id }).from(quoteRequests).where(eq(quoteRequests.id, quoteRequestId)).for('update');
  }

  /** False when the code is not this insurer's, was not issued on this customer's application, or was already redeemed. */
  async redeemNcdCode(
    tx: Transaction,
    code: string,
    owner: { insurerId: string; customerId: string },
    redeemedAt: Date,
  ): Promise<boolean> {
    const issuedToCustomer = tx
      .select({ one: sql`1` })
      .from(ncdApplications)
      .where(and(eq(ncdApplications.approvedCodeId, ncdCodes.code), eq(ncdApplications.customerId, owner.customerId)));
    const redeemed = await tx
      .update(ncdCodes)
      .set({ redeemedAt })
      .where(
        and(
          eq(ncdCodes.code, code),
          eq(ncdCodes.insurerId, owner.insurerId),
          isNull(ncdCodes.redeemedAt),
          exists(issuedToCustomer),
        ),
      )
      .returning({ code: ncdCodes.code });
    return redeemed.length === 1;
  }

  async isNcdCodeIssuedBy(tx: Transaction, code: string, insurerId: string): Promise<boolean> {
    const [found] = await tx
      .select({ code: ncdCodes.code })
      .from(ncdCodes)
      .where(and(eq(ncdCodes.code, code), eq(ncdCodes.insurerId, insurerId)));
    return found !== undefined;
  }
}
