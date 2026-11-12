import { toContract } from '../../common/contract.js';
import { ngweeToKwacha } from '../../common/money.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { QuoteRow, RecipientRow, RequestWithParties } from '../quote-requests.repository.js';

export type QuoteWithDocument = QuoteRow & { document: DocumentRecord };

export interface InsurerQuoteResponse {
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
  insurerQuotes: Record<string, InsurerQuoteResponse>;
  unavailableInsurers: UnavailableInsurerResponse[];
  photosCapturedAt: string | null;
  requotedFromId: string | null;
  requotedAs: string | null;
}

/**
 * Shaped to the `QuoteRequest` type in apps/web/src/api/contracts.js, which
 * keys each reply by insurer name.
 */
export function toQuoteRequestResponse(
  { request, customer, vehicle, chargedRtsaAnniversaryFeeMinor }: RequestWithParties,
  recipients: RecipientRow[],
  quotes: QuoteWithDocument[],
  requotedAs: string | null,
  currentRtsaAnniversaryFeeMinor: number,
): QuoteRequestResponse {
  const insurerQuotes: Record<string, InsurerQuoteResponse> = {};
  for (const quote of quotes) {
    insurerQuotes[quote.insurerName] = {
      premium: ngweeToKwacha(quote.premiumMinor),
      notes: quote.notes,
      insurerReference: quote.insurerReference,
      validityDays: quote.validityDays,
      sentAt: quote.sentAt.toISOString(),
      validUntil: quote.validUntil.toISOString(),
      extendedAt: quote.extendedAt?.toISOString() ?? null,
      unavailableAt: quote.unpayableAt?.toISOString() ?? null,
      document: quote.document,
    };
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
    insurerQuotes,
    unavailableInsurers: recipients.flatMap((recipient) =>
      recipient.cancelledAt ? [{ name: recipient.insurerName, unavailableAt: recipient.cancelledAt.toISOString() }] : [],
    ),
    photosCapturedAt: request.photosCapturedAt?.toISOString() ?? null,
    requotedFromId: request.requotedFromId,
    requotedAs,
  };
}
