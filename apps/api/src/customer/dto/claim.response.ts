import { toContract } from '../../common/contract.js';
import { ngweeToKwacha } from '../../common/money.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { ClaimRow } from '../claims.repository.js';

interface ClaimFields {
  claimNumber: string;
  status: string;
  insurer: string;
  fullName: string;
  phone: string;
  email: string | null;
  plate: string;
  vehicle: string;
  type: string;
  incidentDate: string;
  location: string;
  description: string;
  estimatedLoss: number | null;
  policeReport: boolean;
  policeReportNumber: string | null;
  policyNumber: string | null;
  submittedAt: string;
  supportingDocs: DocumentRecord[];
}

/** A claim as the customer's list shows it. */
export interface ClaimListItem extends ClaimFields {
  customerEmail: string | null;
  insurerClaimReference: string | null;
  receivedAt: string | null;
}

/** The acknowledgement of a claim just notified. */
export interface ClaimNotified extends ClaimFields {
  lateReason: string | null;
  receivedAt: null;
}

function claimFields(claim: ClaimRow, insurerName: string, supportingDocs: DocumentRecord[]): ClaimFields {
  return {
    claimNumber: claim.claimNumber,
    status: toContract.claimStatus(claim.status),
    insurer: insurerName,
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
    policyNumber: claim.policyNumber,
    submittedAt: claim.submittedAt.toISOString(),
    supportingDocs,
  };
}

export function toClaimListItem(
  claim: ClaimRow,
  insurerName: string,
  customerEmail: string | null,
  supportingDocs: DocumentRecord[],
): ClaimListItem {
  const fields = claimFields(claim, insurerName, supportingDocs);
  return {
    claimNumber: fields.claimNumber,
    status: fields.status,
    insurer: fields.insurer,
    customerEmail,
    fullName: fields.fullName,
    phone: fields.phone,
    email: fields.email,
    plate: fields.plate,
    vehicle: fields.vehicle,
    type: fields.type,
    incidentDate: fields.incidentDate,
    location: fields.location,
    description: fields.description,
    estimatedLoss: fields.estimatedLoss,
    policeReport: fields.policeReport,
    policeReportNumber: fields.policeReportNumber,
    policyNumber: fields.policyNumber,
    insurerClaimReference: claim.insurerClaimReference,
    submittedAt: fields.submittedAt,
    receivedAt: claim.receivedAt?.toISOString() ?? null,
    supportingDocs: fields.supportingDocs,
  };
}

export function toClaimNotified(claim: ClaimRow, insurerName: string, supportingDocs: DocumentRecord[]): ClaimNotified {
  const fields = claimFields(claim, insurerName, supportingDocs);
  return {
    claimNumber: fields.claimNumber,
    status: fields.status,
    insurer: fields.insurer,
    fullName: fields.fullName,
    phone: fields.phone,
    email: fields.email,
    plate: fields.plate,
    vehicle: fields.vehicle,
    type: fields.type,
    incidentDate: fields.incidentDate,
    location: fields.location,
    description: fields.description,
    estimatedLoss: fields.estimatedLoss,
    policeReport: fields.policeReport,
    policeReportNumber: fields.policeReportNumber,
    lateReason: claim.lateReason,
    policyNumber: fields.policyNumber,
    submittedAt: fields.submittedAt,
    receivedAt: null,
    supportingDocs: fields.supportingDocs,
  };
}
