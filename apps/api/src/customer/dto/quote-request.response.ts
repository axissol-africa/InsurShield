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
  document: DocumentRecord;
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
  policyDates: { startDate: string; endDate: string; daysTotal: number | null } | null;
  insurers: string[];
  insurerIds: string[];
  insurerQuotes: Record<string, InsurerQuoteResponse>;
  photosCapturedAt: string | null;
  requotedFromId: string | null;
  requotedAs: string | null;
}

/**
 * Shaped to the `QuoteRequest` type in apps/web/src/api/contracts.js, which
 * keys each reply by insurer name.
 */
export function toQuoteRequestResponse(
  { request, customer, vehicle }: RequestWithParties,
  recipients: RecipientRow[],
  quotes: QuoteWithDocument[],
  requotedAs: string | null,
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
    photosCapturedAt: request.photosCapturedAt?.toISOString() ?? null,
    requotedFromId: request.requotedFromId,
    requotedAs,
  };
}
