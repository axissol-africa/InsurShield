import { toContract } from '../../common/contract.js';
import { ngweeToKwacha } from '../../common/money.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { RenewalState } from '../domain/renewal.js';
import type { PolicyWithParties } from '../policies.repository.js';

export interface PolicyResponse {
  policyNumber: string;
  insurerPolicyNumber: string | null;
  status: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  insurer: string;
  coverage: string;
  plan: string | null;
  premium: number;
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
    rtsaAnniversaryDate: string | null;
  };
  renewal: RenewalState;
  policyDates: { startDate: string; endDate: string } | null;
  quoteRequestId: string | null;
  insurerQuoteReference: string | null;
  quoteDocument: DocumentRecord | null;
  certificateDocument: DocumentRecord | null;
  paymentProof: {
    transactionId: string;
    status: string;
    method: string;
    amount: number;
    currency: string;
    confirmedAt: string | null;
  };
  receivedAt: string;
  issuedAt: string | null;
}

export function toPolicyResponse(
  { policy, customer, insurerName, vehicle, payment }: PolicyWithParties,
  renewal: RenewalState,
  quoteDocument: DocumentRecord | null,
  certificateDocument: DocumentRecord | null,
): PolicyResponse {
  return {
    policyNumber: policy.policyNumber,
    insurerPolicyNumber: policy.insurerPolicyNumber,
    status: toContract.policyStatus(policy.status),
    customerName: customer.fullName,
    customerEmail: customer.email,
    customerPhone: customer.phone,
    insurer: insurerName,
    coverage: policy.coverage,
    plan: policy.plan,
    premium: ngweeToKwacha(policy.premiumMinor),
    vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
    // The whole vehicle, not just the plate: a renewal carries these forward
    // into the new quote request without asking for them again.
    vehicleDetails: {
      plateNumber: vehicle.plateNumber,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      color: vehicle.color,
      registrationCountry: vehicle.registrationCountry,
      chassisNumber: vehicle.chassisNumber,
      engineNumber: vehicle.engineNumber,
      rtsaAnniversaryDate: vehicle.rtsaAnniversaryDate?.toISOString() ?? null,
    },
    renewal,
    policyDates:
      policy.policyStartDate && policy.policyEndDate
        ? { startDate: policy.policyStartDate.toISOString(), endDate: policy.policyEndDate.toISOString() }
        : null,
    quoteRequestId: policy.quoteRequestId,
    insurerQuoteReference: policy.insurerQuoteReference,
    quoteDocument,
    // Only present once the insurer has issued; that is what makes it Active.
    certificateDocument,
    paymentProof: {
      transactionId: payment.transactionId,
      status: toContract.paymentStatus(payment.status),
      method: toContract.paymentMethod(payment.method),
      amount: ngweeToKwacha(payment.amountMinor),
      currency: payment.currency,
      confirmedAt: payment.confirmedAt?.toISOString() ?? null,
    },
    receivedAt: policy.receivedAt.toISOString(),
    issuedAt: policy.issuedAt?.toISOString() ?? null,
  };
}
