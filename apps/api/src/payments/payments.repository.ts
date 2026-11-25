import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  customers,
  insurerQuotes,
  insurers,
  ncdCodes,
  paymentCallbacks,
  payments,
  policies,
  quoteRequests,
  quoteSelections,
  reconciliationItems,
} from '../db/schema.js';
import { OPEN_PAYMENT_STATUSES, type PaymentProviderName, type PaymentStatus } from '../common/domain/enums.js';
import { ncdCodeIssuedTo } from '../customer/ncd-code-ownership.js';

export type NewPayment = typeof payments.$inferInsert;
export type NewPolicy = typeof policies.$inferInsert;
export type PaymentRow = typeof payments.$inferSelect;
export type NewReconciliationItem = typeof reconciliationItems.$inferInsert;

/** A payment as its customer sees it, with the insurer and the policy it led to. */
export type PaymentView = PaymentRow & { insurerName: string; policyNumber: string | null; policyStatus: (typeof policies.$inferSelect)['status'] | null };

@Injectable()
export class PaymentsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private viewQuery(tx: Database | Transaction = this.db) {
    return tx
      .select({ payment: payments, insurerName: insurers.name, policyNumber: policies.policyNumber, policyStatus: policies.status })
      .from(payments)
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .innerJoin(insurers, eq(insurers.id, insurerQuotes.insurerId))
      .leftJoin(policies, eq(policies.paymentId, payments.id));
  }

  private toView(row: { payment: PaymentRow; insurerName: string; policyNumber: string | null; policyStatus: PaymentView['policyStatus'] }): PaymentView {
    return { ...row.payment, insurerName: row.insurerName, policyNumber: row.policyNumber, policyStatus: row.policyStatus };
  }

  /** The payment a key was used for, with what a replay is compared against. */
  async findByKey(idempotencyKey: string): Promise<PaymentView | undefined> {
    const [row] = await this.viewQuery().where(eq(payments.idempotencyKey, idempotencyKey));
    return row && this.toView(row);
  }

  async view(customerId: string, transactionId: string, tx?: Transaction): Promise<PaymentView | undefined> {
    const [row] = await this.viewQuery(tx).where(and(eq(payments.transactionId, transactionId), eq(payments.customerId, customerId)));
    return row && this.toView(row);
  }

  async viewById(id: string, tx?: Transaction): Promise<PaymentView | undefined> {
    const [row] = await this.viewQuery(tx).where(eq(payments.id, id));
    return row && this.toView(row);
  }

  async findRequest(customerId: string, quoteRequestId: string) {
    const [request] = await this.db
      .select({
        id: quoteRequests.id,
        model: quoteRequests.model,
        insuranceType: quoteRequests.insuranceType,
        matchRtsaAnniversary: quoteRequests.matchRtsaAnniversary,
        ncdCode: quoteRequests.ncdCode,
      })
      .from(quoteRequests)
      .where(and(eq(quoteRequests.id, quoteRequestId), eq(quoteRequests.customerId, customerId)));
    return request;
  }

  /** The requested quote is always identified by its immutable ID, never by a display name. */
  async findQuote(quoteRequestId: string, insurerQuoteId: string) {
    const [quote] = await this.db
      .select({
        id: insurerQuotes.id,
        premiumMinor: insurerQuotes.premiumMinor,
        validUntil: insurerQuotes.validUntil,
        conditions: insurerQuotes.conditions,
        addOns: insurerQuotes.addOns,
        insurerId: insurers.id,
        insurerName: insurers.name,
      })
      .from(insurerQuotes)
      .innerJoin(insurers, eq(insurers.id, insurerQuotes.insurerId))
      .where(and(eq(insurerQuotes.quoteRequestId, quoteRequestId), eq(insurerQuotes.id, insurerQuoteId)));
    return quote;
  }

  /** The customer's current choice on the request, held shared so it cannot change under the payment. */
  async selection(tx: Transaction, quoteRequestId: string) {
    const [selection] = await tx
      .select({
        id: quoteSelections.id,
        insurerQuoteId: quoteSelections.insurerQuoteId,
        acceptedConditionCodes: quoteSelections.acceptedConditionCodes,
        selectedAddOnCodes: quoteSelections.selectedAddOnCodes,
      })
      .from(quoteSelections)
      .where(eq(quoteSelections.quoteRequestId, quoteRequestId))
      .for('share');
    return selection;
  }

  /** Held shared until `tx` ends, so the insurer's standing cannot change under the write. */
  async insurerStanding(tx: Transaction, insurerId: string) {
    const [standing] = await tx
      .select({ name: insurers.name, status: insurers.status, licenceExpiry: insurers.licenceExpiry })
      .from(insurers)
      .where(eq(insurers.id, insurerId))
      .for('share');
    return standing;
  }

  /** Locked inside the payment transaction, so a suspension mark is never checked only on a stale outer read. */
  async lockQuote(tx: Transaction, quoteId: string) {
    const [quote] = await tx
      .select({
        id: insurerQuotes.id,
        unpayableAt: insurerQuotes.unpayableAt,
        status: insurerQuotes.status,
        validUntil: insurerQuotes.validUntil,
        premiumMinor: insurerQuotes.premiumMinor,
        insurerId: insurerQuotes.insurerId,
        insurerReference: insurerQuotes.insurerReference,
        documentId: insurerQuotes.documentId,
        productVersionId: insurerQuotes.productVersionId,
      })
      .from(insurerQuotes)
      .where(eq(insurerQuotes.id, quoteId))
      .for('share');
    return quote;
  }

  /** The open or confirmed payment of a request, if it has one. */
  async livePayment(tx: Transaction, quoteRequestId: string, exceptId?: string) {
    const [payment] = await tx
      .select({ id: payments.id, transactionId: payments.transactionId, status: payments.status, idempotencyKey: payments.idempotencyKey })
      .from(payments)
      .where(
        and(
          eq(payments.quoteRequestId, quoteRequestId),
          inArray(payments.status, ['CONFIRMED', ...OPEN_PAYMENT_STATUSES]),
          exceptId ? ne(payments.id, exceptId) : undefined,
        ),
      )
      .orderBy(asc(payments.createdAt))
      .limit(1);
    return payment;
  }

  async insertPayment(tx: Transaction, payment: NewPayment): Promise<PaymentRow> {
    const [created] = await tx.insert(payments).values(payment).returning();
    return created;
  }

  async lockPayment(tx: Transaction, id: string): Promise<PaymentRow | undefined> {
    const [payment] = await tx.select().from(payments).where(eq(payments.id, id)).for('update');
    return payment;
  }

  async lockByProviderId(tx: Transaction, provider: PaymentProviderName, providerPaymentId: string): Promise<PaymentRow | undefined> {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, providerPaymentId)))
      .for('update');
    return payment;
  }

  /** Moves a payment on only when it is still in one of `from`; false when someone else moved it first. */
  async move(tx: Transaction, id: string, from: readonly PaymentStatus[], patch: Partial<NewPayment>): Promise<boolean> {
    const moved = await tx
      .update(payments)
      .set(patch)
      .where(and(eq(payments.id, id), inArray(payments.status, [...from])))
      .returning({ id: payments.id });
    return moved.length === 1;
  }

  async recordStatusCheck(id: string, at: Date): Promise<void> {
    await this.db.update(payments).set({ lastStatusCheckAt: at }).where(eq(payments.id, id));
  }

  /** Open attempts that have had their grace period and were not checked recently, oldest first. */
  async dueForStatusCheck(startedBefore: Date, checkedBefore: Date, limit: number) {
    return this.db
      .select({ id: payments.id })
      .from(payments)
      .where(
        and(
          inArray(payments.status, [...OPEN_PAYMENT_STATUSES]),
          lt(payments.createdAt, startedBefore),
          or(isNull(payments.lastStatusCheckAt), lt(payments.lastStatusCheckAt, checkedBefore)),
        ),
      )
      .orderBy(asc(payments.createdAt), asc(payments.id))
      .limit(limit);
  }

  /** Records a provider event; undefined when this provider already sent that event id. */
  async insertCallback(tx: Transaction, callback: typeof paymentCallbacks.$inferInsert) {
    const [saved] = await tx
      .insert(paymentCallbacks)
      .values(callback)
      .onConflictDoNothing({ target: [paymentCallbacks.provider, paymentCallbacks.eventId] })
      .returning({ id: paymentCallbacks.id });
    return saved;
  }

  async findCallback(tx: Transaction, provider: PaymentProviderName, eventId: string) {
    const [callback] = await tx
      .select({ id: paymentCallbacks.id, envelopeHash: paymentCallbacks.envelopeHash, outcome: paymentCallbacks.outcome })
      .from(paymentCallbacks)
      .where(and(eq(paymentCallbacks.provider, provider), eq(paymentCallbacks.eventId, eventId)));
    return callback;
  }

  async finishCallback(tx: Transaction, id: string, result: { paymentId: string | null; outcome: string; at: Date }) {
    await tx
      .update(paymentCallbacks)
      .set({ paymentId: result.paymentId, outcome: result.outcome, processedAt: result.at })
      .where(eq(paymentCallbacks.id, id));
  }

  /** Opens an item for a person to resolve; the same kind already open for the payment is left as it is. */
  async openItem(tx: Transaction, item: NewReconciliationItem) {
    const [opened] = await tx.insert(reconciliationItems).values(item).onConflictDoNothing().returning({ id: reconciliationItems.id });
    return opened;
  }

  /** Taken before any insert: a concurrent vehicle-snapshot migration is then visible to the policy writer. */
  async lockRequest(tx: Transaction, quoteRequestId: string) {
    const [request] = await tx
      .select({
        id: quoteRequests.id,
        vehicleId: quoteRequests.vehicleId,
        insuranceType: quoteRequests.insuranceType,
        policyStartDate: quoteRequests.policyStartDate,
        policyEndDate: quoteRequests.policyEndDate,
        ncdCode: quoteRequests.ncdCode,
      })
      .from(quoteRequests)
      .where(eq(quoteRequests.id, quoteRequestId))
      .for('update');
    return request;
  }

  async insertPolicy(tx: Transaction, policy: NewPolicy) {
    const [created] = await tx.insert(policies).values(policy).returning({
      policyNumber: policies.policyNumber,
      status: policies.status,
      insurerId: policies.insurerId,
      quoteRequestId: policies.quoteRequestId,
      insurerQuoteId: policies.insurerQuoteId,
      premiumMinor: policies.premiumMinor,
      issuanceDueAt: policies.issuanceDueAt,
    });
    return created;
  }

  async policyForRequest(tx: Transaction, quoteRequestId: string): Promise<string | undefined> {
    const [policy] = await tx
      .select({ policyNumber: policies.policyNumber })
      .from(policies)
      .where(eq(policies.quoteRequestId, quoteRequestId))
      .limit(1);
    return policy?.policyNumber;
  }

  async policyForPayment(tx: Transaction, paymentId: string): Promise<string | undefined> {
    const [policy] = await tx.select({ policyNumber: policies.policyNumber }).from(policies).where(eq(policies.paymentId, paymentId));
    return policy?.policyNumber;
  }

  /** False once the account is closed. Taken first, so a closure under way is waited for and then seen. */
  async lockOpenCustomer(tx: Transaction, customerId: string): Promise<boolean> {
    const [customer] = await tx
      .select({ id: customers.id })
      .from(customers)
      .where(and(eq(customers.id, customerId), isNull(customers.deletedAt)))
      .for('key share');
    return customer !== undefined;
  }

  /** False when the code is not this insurer's, was not issued on this customer's application, or was already redeemed. */
  async redeemNcdCode(
    tx: Transaction,
    code: string,
    owner: { insurerId: string; customerId: string },
    redeemedAt: Date,
  ): Promise<boolean> {
    const redeemed = await tx
      .update(ncdCodes)
      .set({ redeemedAt })
      .where(
        and(
          eq(ncdCodes.code, code),
          eq(ncdCodes.insurerId, owner.insurerId),
          isNull(ncdCodes.redeemedAt),
          ncdCodeIssuedTo(owner.customerId),
        ),
      )
      .returning({ code: ncdCodes.code });
    return redeemed.length === 1;
  }

  /** Whether the code could still be redeemed for this insurer and customer right now. */
  async ncdRedeemable(tx: Transaction, code: string, owner: { insurerId: string; customerId: string }): Promise<boolean> {
    const [found] = await tx
      .select({ code: ncdCodes.code })
      .from(ncdCodes)
      .where(
        and(
          eq(ncdCodes.code, code),
          eq(ncdCodes.insurerId, owner.insurerId),
          isNull(ncdCodes.redeemedAt),
          ncdCodeIssuedTo(owner.customerId),
        ),
      );
    return found !== undefined;
  }

  async isNcdCodeIssuedBy(tx: Transaction, code: string, insurerId: string): Promise<boolean> {
    const [found] = await tx
      .select({ code: ncdCodes.code })
      .from(ncdCodes)
      .where(and(eq(ncdCodes.code, code), eq(ncdCodes.insurerId, insurerId)));
    return found !== undefined;
  }
}
