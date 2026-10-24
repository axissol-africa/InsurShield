import { toContract } from '../../common/contract.js';
import { ngweeToKwacha } from '../../common/money.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { InsurerPortalRepository } from '../insurer-portal.repository.js';

type Rows<K extends keyof InsurerPortalRepository> = Awaited<ReturnType<InsurerPortalRepository[K]>>;
type RequestRow = Rows<'listRequests'>[number];
type ReplyRow = NonNullable<RequestRow['reply']>;
type ExtensionRow = NonNullable<Rows<'extendOpenQuote'>>;
type PolicyRow = Rows<'listPolicies'>[number];
type IssuedRow = NonNullable<Rows<'activatePolicy'>>;
type ClaimRow = Rows<'listClaims'>[number];
type AcknowledgementRow = NonNullable<Rows<'acknowledgeClaim'>>;
type NcdApplicationRow = Rows<'listNcdApplications'>[number];
type NcdDecisionRow = NonNullable<Rows<'decideNcdApplication'>>;

const iso = (date: Date | null) => date?.toISOString() ?? null;

const vehicleLabel = (vehicle: { year: string; make: string; model: string }) =>
  `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim();

export function toReply(reply: ReplyRow, document: DocumentRecord) {
  return {
    premium: ngweeToKwacha(reply.premiumMinor),
    notes: reply.notes,
    insurerReference: reply.insurerReference,
    validityDays: reply.validityDays,
    sentAt: reply.sentAt.toISOString(),
    validUntil: reply.validUntil.toISOString(),
    extendedAt: iso(reply.extendedAt),
    document,
  };
}

export function toPortalRequest(request: RequestRow, shotKeys: string[], replyDocument: DocumentRecord | null) {
  return {
    id: request.id,
    status: toContract.quoteRequestStatus(request.status),
    deliveryStatus: request.deliveryStatus,
    submittedAt: request.submittedAt.toISOString(),
    expiresAt: request.expiresAt.toISOString(),
    vehicle: vehicleLabel(request.vehicle),
    vehicleDetails: {
      plateNumber: request.vehicle.plateNumber,
      make: request.vehicle.make,
      model: request.vehicle.model,
      year: request.vehicle.year,
      chassisNumber: request.vehicle.chassisNumber,
    },
    vehicleValue: ngweeToKwacha(request.vehicleValueMinor),
    vehicleUsage: request.vehicleUsage,
    insuranceType: toContract.insuranceType(request.insuranceType),
    coverageDurationId: toContract.coverageDuration(request.coverageDuration),
    policyDates:
      request.policyStartDate && request.policyEndDate
        ? {
            startDate: request.policyStartDate.toISOString(),
            endDate: request.policyEndDate.toISOString(),
            daysTotal: request.coverageDays,
          }
        : null,
    customer: {
      fullName: request.customer.fullName,
      email: request.customer.email,
      phone: request.customer.phone,
    },
    inspectionShots: shotKeys,
    photosCapturedAt: iso(request.photosCapturedAt),
    reply: request.reply && replyDocument ? toReply(request.reply, replyDocument) : null,
  };
}

export function toExtension(quote: ExtensionRow) {
  return {
    premium: ngweeToKwacha(quote.premiumMinor),
    validityDays: quote.validityDays,
    validUntil: quote.validUntil.toISOString(),
    extendedAt: iso(quote.extendedAt),
  };
}

export function toPortalPolicy(
  policy: PolicyRow,
  quoteDocument: DocumentRecord | null,
  certificateDocument: DocumentRecord | null,
) {
  return {
    policyNumber: policy.policyNumber,
    insurerPolicyNumber: policy.insurerPolicyNumber,
    status: toContract.policyStatus(policy.status),
    coverage: policy.coverage,
    plan: policy.plan,
    premium: ngweeToKwacha(policy.premiumMinor),
    customerName: policy.customer.fullName,
    customerEmail: policy.customer.email,
    customerPhone: policy.customer.phone,
    vehicle: vehicleLabel(policy.vehicle),
    vehicleDetails: { plateNumber: policy.vehicle.plateNumber },
    policyDates:
      policy.policyStartDate && policy.policyEndDate
        ? {
            startDate: policy.policyStartDate.toISOString(),
            endDate: policy.policyEndDate.toISOString(),
          }
        : null,
    quoteRequestId: policy.quoteRequestId,
    insurerQuoteReference: policy.insurerQuoteReference,
    quoteDocument,
    certificateDocument,
    // The stored values, as the portal has always shown them.
    paymentProof: {
      transactionId: policy.payment.transactionId,
      status: policy.payment.status,
      method: policy.payment.method,
      amount: ngweeToKwacha(policy.payment.amountMinor),
      currency: policy.payment.currency,
      confirmedAt: iso(policy.payment.confirmedAt),
    },
    receivedAt: policy.receivedAt.toISOString(),
    issuedAt: iso(policy.issuedAt),
  };
}

export function toIssuedPolicy(policy: IssuedRow, certificateDocument: DocumentRecord) {
  return {
    policyNumber: policy.policyNumber,
    insurerPolicyNumber: policy.insurerPolicyNumber,
    status: toContract.policyStatus(policy.status),
    issuedAt: iso(policy.issuedAt),
    certificateDocument,
  };
}

export function toPortalClaim(claim: ClaimRow, supportingDocs: DocumentRecord[]) {
  return {
    claimNumber: claim.claimNumber,
    status: toContract.claimStatus(claim.status),
    fullName: claim.fullName,
    phone: claim.phone,
    email: claim.email,
    plate: claim.plate,
    vehicle: claim.vehicleLabel,
    type: claim.type,
    incidentDate: claim.incidentDate.toISOString(),
    location: claim.location,
    description: claim.description,
    estimatedLoss: claim.estimatedLossMinor === null ? null : ngweeToKwacha(claim.estimatedLossMinor),
    policeReport: claim.policeReport,
    policeReportNumber: claim.policeReportNumber,
    lateReason: claim.lateReason,
    policyNumber: claim.policyNumber,
    insurerClaimReference: claim.insurerClaimReference,
    submittedAt: claim.submittedAt.toISOString(),
    receivedAt: iso(claim.receivedAt),
    supportingDocs,
  };
}

/** The status is the stored value, as this endpoint has always answered. */
export function toAcknowledgement(claim: AcknowledgementRow) {
  return {
    claimNumber: claim.claimNumber,
    status: claim.status,
    receivedAt: iso(claim.receivedAt),
    insurerClaimReference: claim.insurerClaimReference,
  };
}

export function toNcdApplication(application: NcdApplicationRow) {
  return {
    id: application.id,
    applicationNumber: application.applicationNumber,
    policyNumber: application.policyNumber,
    fullName: application.fullName,
    phone: application.phone,
    yearsClaimFree: application.yearsClaimFree,
    status: toContract.ncdStatus(application.status),
    approvedCode: application.approvedCode,
    submittedAt: application.submittedAt.toISOString(),
    decidedAt: iso(application.decidedAt),
  };
}

export function toNcdDecision(decision: NcdDecisionRow) {
  return {
    id: decision.id,
    status: toContract.ncdStatus(decision.status),
    approvedCode: null,
    decidedAt: iso(decision.decidedAt),
  };
}

export function toNcdApproval(decision: NcdDecisionRow, code: { code: string; percentage: number }) {
  return {
    id: decision.id,
    status: toContract.ncdStatus(decision.status),
    approvedCode: code.code,
    percentage: code.percentage,
    decidedAt: iso(decision.decidedAt),
  };
}
