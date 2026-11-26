import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, notExists, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { customerAvailableProductConditions } from '../products/customer-availability.js';
import {
  customers,
  inspectionShots,
  insurerProductVersions,
  insurerProducts,
  insurerQuotes,
  insurers,
  payments,
  policies,
  productVersionRequirements,
  quoteRequestRecipients,
  quoteRequestProductRequirementAnswers,
  quoteRequestProductRequirementDeclarations,
  quoteRequestProductRequirementDocuments,
  quoteRequestProductVersions,
  quoteRequests,
  quoteSelections,
  vehicles,
  type QuoteAddOn,
  type QuoteComponent,
  type QuoteCondition,
} from '../db/schema.js';
import {
  OPEN_PAYMENT_STATUSES,
  type CoverageDuration,
  type InsuranceType,
  type InspectionMethod,
  type InspectionRule,
  type InspectionTiming,
  type PaymentStatus,
  type PolicyStatus,
  type QuoteProductStatus,
} from '../common/domain/enums.js';

export type QuoteRequestRow = typeof quoteRequests.$inferSelect;
export type NewQuoteRequest = typeof quoteRequests.$inferInsert;
export type VehicleRow = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export interface RequestWithParties {
  request: QuoteRequestRow;
  customer: { fullName: string; email: string; phone: string };
  vehicle: VehicleRow;
  chargedRtsaAnniversaryFeeMinor: number | null;
}

export interface RecipientRow {
  quoteRequestId: string;
  insurerId: string;
  insurerName: string;
  cancelledAt: Date | null;
}

export interface QuoteRow {
  id: string;
  quoteRequestId: string;
  insurerId: string;
  productVersionId: string | null;
  insurerName: string;
  premiumMinor: number;
  ncdPercentage: number | null;
  notes: string | null;
  insurerReference: string | null;
  validityDays: number;
  sentAt: Date;
  validUntil: Date;
  extendedAt: Date | null;
  documentId: string;
  unpayableAt: Date | null;
  componentsMinor: QuoteComponent[];
  excessMinor: number | null;
  addOns: QuoteAddOn[];
  conditions: QuoteCondition[];
}

export interface SelectionRow {
  quoteRequestId: string;
  insurerQuoteId: string;
  acceptedConditionCodes: string[];
  selectedAddOnCodes: string[];
  selectedAt: Date;
}

/** The latest payment attempt on a request and the policy it led to, if any. */
export interface PurchaseRow {
  quoteRequestId: string;
  paymentStatus: PaymentStatus;
  policyStatus: PolicyStatus | null;
}

/** Immutable customer-facing product terms captured at selection time. */
export interface SelectedProductVersionRow {
  quoteRequestId: string;
  productVersionId: string;
  insurerId: string;
  insurerName: string;
  productCode: string;
  productVersionNumber: number;
  productName: string;
  coverType: InsuranceType;
  coverGuide: Record<string, unknown>;
  inspectionRule: InspectionRule;
  inspectionTiming: InspectionTiming | null;
  inspectionMethod: InspectionMethod | null;
  cancelledAt: Date | null;
  status: QuoteProductStatus;
  replyDueAt: Date | null;
  declineReasonCode: string | null;
  declineCustomerNote: string | null;
}

export type AvailableProductVersion = Omit<
  SelectedProductVersionRow,
  'quoteRequestId' | 'cancelledAt' | 'status' | 'replyDueAt' | 'declineReasonCode' | 'declineCustomerNote'
> & {
  productId: string;
  allowedDurations: CoverageDuration[];
};

export interface RequoteLink {
  requotedFromId: string;
  id: string;
}

export interface NewShot {
  shotKey: string;
  documentId: string;
}

export interface ProductRequirementRow {
  productVersionId: string;
  key: string;
  kind: string;
  label: string;
  helpText: string | null;
  required: boolean;
  config: Record<string, unknown>;
  displayOrder: number;
}

export interface NewProductRequirementAnswer {
  productVersionId: string;
  requirementKey: string;
  value: string | number | boolean;
}

export interface NewProductRequirementDeclaration {
  productVersionId: string;
  requirementKey: string;
}

export interface NewProductRequirementDocument {
  productVersionId: string;
  requirementKey: string;
  documentId: string;
}

const PARTIES = {
  request: quoteRequests,
  customer: { fullName: customers.fullName, email: customers.email, phone: customers.phone },
  vehicle: vehicles,
  chargedRtsaAnniversaryFeeMinor: payments.rtsaAnniversaryFeeMinor,
};

@Injectable()
export class QuoteRequestsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  private on(tx?: Transaction): Database | Transaction {
    return tx ?? this.db;
  }

  listForCustomer(customerId: string): Promise<RequestWithParties[]> {
    return this.db
      .select(PARTIES)
      .from(quoteRequests)
      .innerJoin(customers, eq(customers.id, quoteRequests.customerId))
      .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
      .leftJoin(
        payments,
        and(eq(payments.quoteRequestId, quoteRequests.id), eq(payments.status, 'CONFIRMED')),
      )
      .where(eq(quoteRequests.customerId, customerId))
      .orderBy(desc(quoteRequests.submittedAt));
  }

  async findOwned(customerId: string, id: string, tx?: Transaction): Promise<RequestWithParties | undefined> {
    const [row] = await this.on(tx)
      .select(PARTIES)
      .from(quoteRequests)
      .innerJoin(customers, eq(customers.id, quoteRequests.customerId))
      .innerJoin(vehicles, eq(vehicles.id, quoteRequests.vehicleId))
      .leftJoin(
        payments,
        and(eq(payments.quoteRequestId, quoteRequests.id), eq(payments.status, 'CONFIRMED')),
      )
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.customerId, customerId)));
    return row;
  }

  recipientsOf(quoteRequestIds: string[], tx?: Transaction): Promise<RecipientRow[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({
        quoteRequestId: quoteRequestRecipients.quoteRequestId,
        insurerId: quoteRequestRecipients.insurerId,
        insurerName: insurers.name,
        cancelledAt: quoteRequestRecipients.cancelledAt,
      })
      .from(quoteRequestRecipients)
      .innerJoin(insurers, eq(insurers.id, quoteRequestRecipients.insurerId))
      .where(inArray(quoteRequestRecipients.quoteRequestId, quoteRequestIds))
      .orderBy(asc(insurers.name));
  }

  quotesOf(quoteRequestIds: string[], tx?: Transaction): Promise<QuoteRow[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({
        id: insurerQuotes.id,
        quoteRequestId: insurerQuotes.quoteRequestId,
        insurerId: insurerQuotes.insurerId,
        productVersionId: insurerQuotes.productVersionId,
        insurerName: insurers.name,
        premiumMinor: insurerQuotes.premiumMinor,
        ncdPercentage: insurerQuotes.ncdPercentage,
        notes: insurerQuotes.notes,
        insurerReference: insurerQuotes.insurerReference,
        validityDays: insurerQuotes.validityDays,
        sentAt: insurerQuotes.sentAt,
        validUntil: insurerQuotes.validUntil,
        extendedAt: insurerQuotes.extendedAt,
        documentId: insurerQuotes.documentId,
        unpayableAt: insurerQuotes.unpayableAt,
        componentsMinor: insurerQuotes.componentsMinor,
        excessMinor: insurerQuotes.excessMinor,
        addOns: insurerQuotes.addOns,
        conditions: insurerQuotes.conditions,
      })
      .from(insurerQuotes)
      .innerJoin(insurers, eq(insurers.id, insurerQuotes.insurerId))
      // A withdrawn or replaced quote is history for the audit trail, not an offer.
      .where(and(inArray(insurerQuotes.quoteRequestId, quoteRequestIds), eq(insurerQuotes.status, 'ACTIVE')))
      .orderBy(asc(insurers.name));
  }

  selectionsOf(quoteRequestIds: string[], tx?: Transaction): Promise<SelectionRow[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({
        quoteRequestId: quoteSelections.quoteRequestId,
        insurerQuoteId: quoteSelections.insurerQuoteId,
        acceptedConditionCodes: quoteSelections.acceptedConditionCodes,
        selectedAddOnCodes: quoteSelections.selectedAddOnCodes,
        selectedAt: quoteSelections.selectedAt,
      })
      .from(quoteSelections)
      .where(inArray(quoteSelections.quoteRequestId, quoteRequestIds));
  }

  /**
   * Each request's purchase as it stands: a confirmed payment wins over later
   * attempts, otherwise the newest attempt counts.
   */
  async purchasesOf(quoteRequestIds: string[], tx?: Transaction): Promise<PurchaseRow[]> {
    if (quoteRequestIds.length === 0) return [];
    const rows = await this.on(tx)
      .selectDistinctOn([payments.quoteRequestId], {
        quoteRequestId: payments.quoteRequestId,
        paymentStatus: payments.status,
        policyStatus: policies.status,
      })
      .from(payments)
      .leftJoin(policies, eq(policies.paymentId, payments.id))
      .where(inArray(payments.quoteRequestId, quoteRequestIds))
      .orderBy(
        asc(payments.quoteRequestId),
        sql`CASE WHEN ${payments.status} IN ('CONFIRMED', 'REVERSED') THEN 0 ELSE 1 END`,
        desc(payments.createdAt),
        desc(payments.id),
      );
    return rows;
  }

  /** Payment attempts still open on an insurer's quotes, for decision 24 to stop at the provider. */
  async openPaymentsForInsurer(tx: Transaction, insurerId: string) {
    return tx
      .select({ id: payments.id })
      .from(payments)
      .innerJoin(insurerQuotes, eq(insurerQuotes.id, payments.insurerQuoteId))
      .where(and(eq(insurerQuotes.insurerId, insurerId), inArray(payments.status, [...OPEN_PAYMENT_STATUSES])));
  }

  /** Whether the request has a payment that is still open or already confirmed, which fixes its choice. */
  async lockedPurchase(tx: Transaction, quoteRequestId: string) {
    const [payment] = await tx
      .select({ status: payments.status, transactionId: payments.transactionId })
      .from(payments)
      .where(and(eq(payments.quoteRequestId, quoteRequestId), inArray(payments.status, ['CONFIRMED', ...OPEN_PAYMENT_STATUSES])))
      .limit(1);
    return payment;
  }

  /** Locks an offer this customer can still choose on this request, with its conditions. */
  async lockSelectableQuote(tx: Transaction, quoteRequestId: string, insurerQuoteId: string) {
    const [quote] = await tx
      .select({
        id: insurerQuotes.id,
        status: insurerQuotes.status,
        validUntil: insurerQuotes.validUntil,
        unpayableAt: insurerQuotes.unpayableAt,
        conditions: insurerQuotes.conditions,
        addOns: insurerQuotes.addOns,
      })
      .from(insurerQuotes)
      .where(and(eq(insurerQuotes.quoteRequestId, quoteRequestId), eq(insurerQuotes.id, insurerQuoteId)))
      .for('share');
    return quote;
  }

  /** Records the customer's choice, replacing any earlier one for the request. */
  async upsertSelection(tx: Transaction, selection: typeof quoteSelections.$inferInsert) {
    const [saved] = await tx
      .insert(quoteSelections)
      .values(selection)
      .onConflictDoUpdate({
        target: quoteSelections.quoteRequestId,
        set: {
          insurerQuoteId: selection.insurerQuoteId,
          acceptedConditionCodes: selection.acceptedConditionCodes,
          selectedAddOnCodes: selection.selectedAddOnCodes ?? [],
          selectedAt: selection.selectedAt,
          customerId: selection.customerId,
        },
      })
      .returning({ insurerQuoteId: quoteSelections.insurerQuoteId });
    return saved;
  }

  async previousSelection(tx: Transaction, quoteRequestId: string) {
    const [previous] = await tx
      .select({ insurerQuoteId: quoteSelections.insurerQuoteId })
      .from(quoteSelections)
      .where(eq(quoteSelections.quoteRequestId, quoteRequestId))
      .for('update');
    return previous;
  }

  selectedProductVersionsOf(quoteRequestIds: string[], tx?: Transaction): Promise<SelectedProductVersionRow[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({
        quoteRequestId: quoteRequestProductVersions.quoteRequestId,
        productVersionId: quoteRequestProductVersions.productVersionId,
        insurerId: quoteRequestProductVersions.insurerId,
        insurerName: insurers.name,
        productCode: quoteRequestProductVersions.productCode,
        productVersionNumber: quoteRequestProductVersions.productVersionNumber,
        productName: quoteRequestProductVersions.productName,
        coverType: quoteRequestProductVersions.coverType,
        coverGuide: quoteRequestProductVersions.coverGuide,
        inspectionRule: quoteRequestProductVersions.inspectionRule,
        inspectionTiming: quoteRequestProductVersions.inspectionTiming,
        inspectionMethod: quoteRequestProductVersions.inspectionMethod,
        cancelledAt: quoteRequestProductVersions.cancelledAt,
        status: quoteRequestProductVersions.status,
        replyDueAt: quoteRequestProductVersions.replyDueAt,
        declineReasonCode: quoteRequestProductVersions.declineReasonCode,
        declineCustomerNote: quoteRequestProductVersions.declineCustomerNote,
      })
      .from(quoteRequestProductVersions)
      .innerJoin(insurers, eq(insurers.id, quoteRequestProductVersions.insurerId))
      .where(inArray(quoteRequestProductVersions.quoteRequestId, quoteRequestIds))
      .orderBy(asc(insurers.name), asc(quoteRequestProductVersions.productName));
  }

  /**
   * Selected versions are read under a share lock, so a withdrawal or insurer
   * deactivation that is already in flight cannot commit between eligibility
   * validation and creating the request which records the selection.
   */
  selectedAvailableProductVersions(
    tx: Transaction,
    productVersionIds: string[],
    insuranceType: InsuranceType,
    now: Date,
  ): Promise<AvailableProductVersion[]> {
    if (productVersionIds.length === 0) return Promise.resolve([]);
    return tx
      .select({
        productId: insurerProducts.id,
        productVersionId: insurerProductVersions.id,
        insurerId: insurers.id,
        insurerName: insurers.name,
        productCode: insurerProducts.code,
        productVersionNumber: insurerProductVersions.versionNumber,
        productName: insurerProductVersions.name,
        coverType: insurerProductVersions.coverType,
        coverGuide: insurerProductVersions.coverGuide,
        inspectionRule: insurerProductVersions.inspectionRule,
        inspectionTiming: insurerProductVersions.inspectionTiming,
        inspectionMethod: insurerProductVersions.inspectionMethod,
        allowedDurations: insurerProductVersions.allowedDurations,
      })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(...customerAvailableProductConditions(tx, now, { coverType: insuranceType, productVersionIds })))
      .for('share');
  }

  /** All current versions for selected product identities, used to refuse ambiguity rather than picking one at random. */
  currentVersionsForProducts(
    tx: Transaction,
    productIds: string[],
    insuranceType: InsuranceType,
    now: Date,
  ) {
    if (productIds.length === 0) return Promise.resolve([]);
    return tx
      .select({ productId: insurerProducts.id, productVersionId: insurerProductVersions.id })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(...customerAvailableProductConditions(tx, now, { coverType: insuranceType, productIds })))
      .for('share');
  }

  /** The requests that were sent again, and the new request each became. */
  requoteLinksOf(quoteRequestIds: string[], tx?: Transaction): Promise<RequoteLink[]> {
    if (quoteRequestIds.length === 0) return Promise.resolve([]);
    return this.on(tx)
      .select({ requotedFromId: quoteRequests.requotedFromId, id: quoteRequests.id })
      .from(quoteRequests)
      .where(inArray(quoteRequests.requotedFromId, quoteRequestIds))
      .then((links) => links.filter((link): link is RequoteLink => link.requotedFromId !== null));
  }

  /** The customer's own request, locked until `tx` ends so it is sent again at most once. */
  async lockOwned(tx: Transaction, customerId: string, id: string): Promise<QuoteRequestRow | undefined> {
    const [request] = await tx
      .select()
      .from(quoteRequests)
      .where(and(eq(quoteRequests.id, id), eq(quoteRequests.customerId, customerId)))
      .for('update');
    return request;
  }

  async insertVehicle(tx: Transaction, vehicle: NewVehicle): Promise<VehicleRow> {
    const [created] = await tx.insert(vehicles).values(vehicle).returning();
    return created;
  }

  /** The code only when it was issued on this customer's own application. */
  async insertRequest(tx: Transaction, request: NewQuoteRequest): Promise<QuoteRequestRow> {
    const [created] = await tx.insert(quoteRequests).values(request).returning();
    return created;
  }

  async insertRecipients(tx: Transaction, quoteRequestId: string, insurerIds: string[]): Promise<void> {
    if (insurerIds.length === 0) return;
    await tx
      .insert(quoteRequestRecipients)
      .values(insurerIds.map((insurerId) => ({ quoteRequestId, insurerId, status: 'PENDING' as const })));
  }

  async insertSelectedProductVersions(
    tx: Transaction,
    quoteRequestId: string,
    selected: Array<AvailableProductVersion & Pick<typeof quoteRequestProductVersions.$inferInsert, 'status' | 'replyDueAt' | 'pausedAt'>>,
  ) {
    if (selected.length === 0) return [];
    return tx.insert(quoteRequestProductVersions).values(
      selected.map((version) => ({
        quoteRequestId,
        productVersionId: version.productVersionId,
        insurerId: version.insurerId,
        productCode: version.productCode,
        productVersionNumber: version.productVersionNumber,
        productName: version.productName,
        coverType: version.coverType,
        coverGuide: version.coverGuide,
        inspectionRule: version.inspectionRule,
        inspectionTiming: version.inspectionTiming,
        inspectionMethod: version.inspectionMethod,
        status: version.status,
        replyDueAt: version.replyDueAt,
        pausedAt: version.pausedAt,
      })),
    ).returning({
      id: quoteRequestProductVersions.id,
      productVersionId: quoteRequestProductVersions.productVersionId,
      status: quoteRequestProductVersions.status,
    });
  }

  productRequirementsForVersions(
    tx: Transaction,
    productVersionIds: string[],
  ): Promise<ProductRequirementRow[]> {
    if (productVersionIds.length === 0) return Promise.resolve([]);
    return tx
      .select({
        productVersionId: productVersionRequirements.productVersionId,
        key: productVersionRequirements.key,
        kind: productVersionRequirements.kind,
        label: productVersionRequirements.label,
        helpText: productVersionRequirements.helpText,
        required: productVersionRequirements.required,
        config: productVersionRequirements.config,
        displayOrder: productVersionRequirements.displayOrder,
      })
      .from(productVersionRequirements)
      .where(inArray(productVersionRequirements.productVersionId, productVersionIds))
      .orderBy(asc(productVersionRequirements.displayOrder), asc(productVersionRequirements.key));
  }

  async insertProductRequirementAnswers(
    tx: Transaction,
    quoteRequestId: string,
    answers: NewProductRequirementAnswer[],
  ): Promise<void> {
    if (answers.length === 0) return;
    await tx.insert(quoteRequestProductRequirementAnswers).values(
      answers.map((answer) => ({ quoteRequestId, ...answer })),
    );
  }

  async insertProductRequirementDeclarations(
    tx: Transaction,
    quoteRequestId: string,
    declarations: NewProductRequirementDeclaration[],
  ): Promise<void> {
    if (declarations.length === 0) return;
    await tx.insert(quoteRequestProductRequirementDeclarations).values(
      declarations.map((declaration) => ({ quoteRequestId, ...declaration })),
    );
  }

  async insertProductRequirementDocuments(
    tx: Transaction,
    quoteRequestId: string,
    documents: NewProductRequirementDocument[],
  ): Promise<void> {
    if (documents.length === 0) return;
    await tx.insert(quoteRequestProductRequirementDocuments).values(
      documents.map((document) => ({ quoteRequestId, ...document })),
    );
  }

  async insertShots(tx: Transaction, quoteRequestId: string, shots: NewShot[]): Promise<void> {
    if (shots.length === 0) return;
    await tx.insert(inspectionShots).values(shots.map((shot) => ({ quoteRequestId, ...shot })));
  }

  /**
   * Marks delivery rows that never received a final quote. This deliberately
   * leaves `status` alone: delivery and cancellation answer different facts.
   */
  async cancelUnansweredForSuspension(tx: Transaction, insurerId: string, cancelledAt: Date) {
    const finalQuote = tx
      .select({ id: insurerQuotes.id })
      .from(insurerQuotes)
      .where(
        and(
          eq(insurerQuotes.quoteRequestId, quoteRequestRecipients.quoteRequestId),
          eq(insurerQuotes.insurerId, quoteRequestRecipients.insurerId),
        ),
      );
    return tx
      .update(quoteRequestRecipients)
      .set({ cancelledAt, cancelledReason: 'INSURER_SUSPENDED' })
      .where(
        and(
          eq(quoteRequestRecipients.insurerId, insurerId),
          isNull(quoteRequestRecipients.cancelledAt),
          notExists(finalQuote),
        ),
      )
      .returning({ quoteRequestId: quoteRequestRecipients.quoteRequestId });
  }

  /** Final quotes without a confirmed payment stay visible as history but may no longer be paid. */
  async markUnpaidQuotesUnavailable(tx: Transaction, insurerId: string, unpayableAt: Date) {
    const confirmedPayment = tx
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.insurerQuoteId, insurerQuotes.id), eq(payments.status, 'CONFIRMED')));
    return tx
      .update(insurerQuotes)
      .set({ unpayableAt, unpayableReason: 'INSURER_SUSPENDED' })
      .where(
        and(eq(insurerQuotes.insurerId, insurerId), isNull(insurerQuotes.unpayableAt), notExists(confirmedPayment)),
      )
      .returning({ id: insurerQuotes.id });
  }

  async customersForRequests(tx: Transaction, quoteRequestIds: string[]) {
    if (quoteRequestIds.length === 0) return [];
    return tx
      .select({ quoteRequestId: quoteRequests.id, customerId: quoteRequests.customerId })
      .from(quoteRequests)
      .where(inArray(quoteRequests.id, quoteRequestIds));
  }

  /** Stable captured proof that follows the request if it is sent again. */
  shotsForRequest(tx: Transaction, quoteRequestId: string): Promise<NewShot[]> {
    return tx
      .select({ shotKey: inspectionShots.shotKey, documentId: inspectionShots.documentId })
      .from(inspectionShots)
      .where(eq(inspectionShots.quoteRequestId, quoteRequestId))
      .orderBy(asc(inspectionShots.capturedAt), asc(inspectionShots.id));
  }
}
