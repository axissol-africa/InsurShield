import { toContract } from '../../common/contract.js';
import { ngweeToKwacha } from '../../common/money.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { QuoteRow, RecipientRow, RequestWithParties, SelectedProductVersionRow, PurchaseRow, SelectionRow } from '../quote-requests.repository.js';
import { quoteContentResponse } from '../../insurer-portal/dto/portal.response.js';
import type { InformationRequestRow } from '../quote-products.repository.js';
import { CUSTOMER_STATUS_LABELS, REQUEST_PROGRESS_LABELS, requestProgress } from '../domain/quote-workflow.js';

export type QuoteWithDocument = QuoteRow & { document: DocumentRecord };

export interface InsurerQuoteResponse {
  id: string;
  productVersionId: string | null;
  premium: number;
  notes: string | null;
  insurerReference: string | null;
  validityDays: number;
  sentAt: string;
  validUntil: string;
  extendedAt: string | null;
  /** The quote remains viewable for the customer's records but cannot be paid. */
  unavailableAt: string | null;
  document: DocumentRecord;
  components: Array<{ code: string; label: string; amount: number }>;
  excess: number | null;
  addOns: Array<{ code: string; label: string; price: number; included: boolean; terms: string | null }>;
  conditions: Array<{ code: string; text: string; purchaseCritical: boolean }>;
}

/** A final reply is identified by its immutable quote id, never by insurer name. */
export interface ProductQuoteResponse extends InsurerQuoteResponse {
  insurer: { id: string; name: string };
}

/** An insurer that did not answer before it became unavailable. */
export interface UnavailableInsurerResponse {
  name: string;
  unavailableAt: string;
}

export interface QuoteRequestResponse {
  id: string;
  status: string;
  submittedAt: string;
  expiresAt: string;
  customer: { fullName: string; email: string; phone: string };
  vehicle: string;
  vehicleDetails: {
    plateNumber: string;
    make: string;
    model: string;
    year: string;
    color: string | null;
    registrationCountry: string | null;
    chassisNumber: string | null;
    engineNumber: string | null;
    registrationDate: string | null;
    rtsaAnniversaryDate: string | null;
  };
  vehicleValue: number;
  vehicleUsage: string;
  insuranceType: string;
  coverageDurationId: string;
  matchRtsaAnniversary: boolean;
  rtsaAnniversaryFee: number;
  policyDates: { startDate: string; endDate: string; daysTotal: number | null } | null;
  insurers: string[];
  insurerIds: string[];
  selectedProducts: Array<{
    productVersionId: string;
    insurerId: string;
    insurerName: string;
    productCode: string;
    productVersionNumber: number;
    productName: string;
    coverType: string;
    coverGuide: Record<string, unknown>;
    inspection: { rule: string; timing: string | null; method: string | null };
    unavailableAt: string | null;
    /** Where this product stands with its insurer, and the wording the customer reads for it. */
    status: string;
    statusLabel: string;
    replyDueAt: string | null;
    /** Only the approved customer wording and the insurer's note to the customer; never the internal reason. */
    decline: { reason: string | null; note: string | null } | null;
    informationRequests: Array<{
      id: string;
      message: string;
      dueAt: string;
      askedAt: string;
      answeredAt: string | null;
      answer: string | null;
      open: boolean;
    }>;
  }>;
  insurerQuotes: Record<string, InsurerQuoteResponse>;
  productQuotes: ProductQuoteResponse[];
  unavailableInsurers: UnavailableInsurerResponse[];
  photosCapturedAt: string | null;
  requotedFromId: string | null;
  requotedAs: string | null;
  /** Where the request stands across its chosen products; null for a request from before product selection. */
  progress: string | null;
  progressLabel: string | null;
  /** The quote the customer has chosen, and the conditions they accepted. */
  selection: { insurerQuoteId: string; acceptedConditionCodes: string[]; selectedAddOnCodes: string[]; selectedAt: string } | null;
}

/**
 * Shaped to the `QuoteRequest` type in apps/web/src/api/contracts.js, which
 * keys each reply by insurer name.
 */
export function toQuoteRequestResponse(
  { request, customer, vehicle, chargedRtsaAnniversaryFeeMinor }: RequestWithParties,
  recipients: RecipientRow[],
  quotes: QuoteWithDocument[],
  selectedProducts: SelectedProductVersionRow[],
  requotedAs: string | null,
  currentRtsaAnniversaryFeeMinor: number,
  informationRequests: InformationRequestRow[] = [],
  declineCustomerText: ReadonlyMap<string, string> = new Map(),
  selection: SelectionRow | null = null,
  purchase: PurchaseRow | null = null,
): QuoteRequestResponse {
  const insurerQuotes: Record<string, InsurerQuoteResponse> = {};
  const productQuotes: ProductQuoteResponse[] = [];
  for (const quote of quotes) {
    const response = {
      id: quote.id,
      productVersionId: quote.productVersionId,
      premium: ngweeToKwacha(quote.premiumMinor),
      notes: quote.notes,
      insurerReference: quote.insurerReference,
      validityDays: quote.validityDays,
      sentAt: quote.sentAt.toISOString(),
      validUntil: quote.validUntil.toISOString(),
      extendedAt: quote.extendedAt?.toISOString() ?? null,
      unavailableAt: quote.unpayableAt?.toISOString() ?? null,
      document: quote.document,
      ...quoteContentResponse(quote),
    };
    // Existing browser clients still read their historical replies by insurer
    // name. New selected-product replies are intentionally separate because a
    // single insurer may return more than one quote for the same request.
    if (quote.productVersionId === null) insurerQuotes[quote.insurerName] = response;
    else productQuotes.push({ ...response, productVersionId: quote.productVersionId, insurer: { id: quote.insurerId, name: quote.insurerName } });
  }

  return {
    id: request.id,
    status: toContract.quoteRequestStatus(request.status),
    submittedAt: request.submittedAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    customer: { fullName: customer.fullName, email: customer.email, phone: customer.phone },
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
    vehicleDetails: {
      plateNumber: vehicle.plateNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      registrationCountry: vehicle.registrationCountry,
      chassisNumber: vehicle.chassisNumber,
      engineNumber: vehicle.engineNumber,
      registrationDate: vehicle.registrationDate?.toISOString() ?? null,
      rtsaAnniversaryDate: vehicle.rtsaAnniversaryDate?.toISOString() ?? null,
    },
    vehicleValue: ngweeToKwacha(request.vehicleValueMinor),
    vehicleUsage: request.vehicleUsage,
    insuranceType: toContract.insuranceType(request.insuranceType),
    coverageDurationId: toContract.coverageDuration(request.coverageDuration),
    matchRtsaAnniversary: request.matchRtsaAnniversary,
    // A confirmed payment is a financial record. Keep showing the fee that was
    // actually charged even if an administrator changes the setting later.
    rtsaAnniversaryFee: ngweeToKwacha(
      chargedRtsaAnniversaryFeeMinor ?? (request.matchRtsaAnniversary ? currentRtsaAnniversaryFeeMinor : 0),
    ),
    policyDates:
      request.policyStartDate && request.policyEndDate
        ? {
            startDate: request.policyStartDate.toISOString(),
            endDate: request.policyEndDate.toISOString(),
            daysTotal: request.coverageDays,
          }
        : null,
    insurers: recipients.map((recipient) => recipient.insurerName),
    insurerIds: recipients.map((recipient) => recipient.insurerId),
    selectedProducts: selectedProducts.map((selection) => ({
      productVersionId: selection.productVersionId,
      insurerId: selection.insurerId,
      insurerName: selection.insurerName,
      productCode: selection.productCode,
      productVersionNumber: selection.productVersionNumber,
      productName: selection.productName,
      coverType: toContract.insuranceType(selection.coverType),
      coverGuide: selection.coverGuide,
      inspection: {
        rule: selection.inspectionRule,
        timing: selection.inspectionTiming,
        method: selection.inspectionMethod,
      },
      unavailableAt: selection.cancelledAt?.toISOString() ?? null,
      status: selection.status,
      statusLabel: CUSTOMER_STATUS_LABELS[selection.status],
      replyDueAt: selection.replyDueAt?.toISOString() ?? null,
      decline: selection.declineReasonCode
        ? { reason: declineCustomerText.get(selection.declineReasonCode) ?? null, note: selection.declineCustomerNote }
        : null,
      informationRequests: informationRequests
        .filter((asked) => asked.productVersionId === selection.productVersionId)
        .map((asked) => ({
          id: asked.id,
          message: asked.message,
          dueAt: asked.dueAt.toISOString(),
          askedAt: asked.createdAt.toISOString(),
          answeredAt: asked.answeredAt?.toISOString() ?? null,
          answer: asked.answerText,
          open: asked.closedAt === null,
        })),
    })),
    insurerQuotes,
    productQuotes,
    unavailableInsurers: recipients.flatMap((recipient) =>
      recipient.cancelledAt ? [{ name: recipient.insurerName, unavailableAt: recipient.cancelledAt.toISOString() }] : [],
    ),
    photosCapturedAt: request.photosCapturedAt?.toISOString() ?? null,
    requotedFromId: request.requotedFromId,
    requotedAs,
    ...progressOf(selectedProducts, selection, purchase),
    selection: selection
      ? {
          insurerQuoteId: selection.insurerQuoteId,
          acceptedConditionCodes: selection.acceptedConditionCodes,
          selectedAddOnCodes: selection.selectedAddOnCodes,
          selectedAt: selection.selectedAt.toISOString(),
        }
      : null,
  };
}

function progressOf(selectedProducts: SelectedProductVersionRow[], selection: SelectionRow | null, purchase: PurchaseRow | null) {
  const progress = requestProgress(selectedProducts.map((selected) => selected.status), selection !== null, purchase);
  return { progress, progressLabel: progress ? REQUEST_PROGRESS_LABELS[progress] : null };
}
