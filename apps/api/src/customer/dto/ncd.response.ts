import { toContract } from '../../common/contract.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { NcdApplicationRow } from '../ncd.repository.js';

export interface NcdApplicationResponse {
  id: string;
  applicationNumber: string;
  insurer: string;
  policyNumber: string;
  fullName: string;
  phone: string;
  yearsClaimFree: number;
  status: string;
  approvedCode: string | null;
  submittedAt: string;
  decidedAt: string | null;
  declarationAcceptedAt: string | null;
  declarationVersion: string | null;
  discountPercentage: number | null;
  expiresAt: string | null;
  decisionNote: string | null;
  verificationRevision: number;
  vehicle: { plateNumber: string; make: string; model: string } | null;
  evidence: DocumentRecord[];
  codeStatus: 'Available' | 'Expired' | 'Used' | 'Unavailable' | null;
}

export type NcdCodeValidation = { valid: false } | {
  valid: true;
  percentage: number;
  insurerId: string;
  expiresAt: string;
};

export function toNcdApplicationResponse(
  application: NcdApplicationRow,
  insurerName: string,
  detail: Pick<NcdApplicationResponse, 'discountPercentage' | 'expiresAt' | 'evidence' | 'codeStatus' | 'vehicle'>,
): NcdApplicationResponse {
  return {
    id: application.id,
    applicationNumber: application.applicationNumber,
    insurer: insurerName,
    policyNumber: application.policyNumber,
    fullName: application.fullName,
    phone: application.phone,
    yearsClaimFree: application.yearsClaimFree,
    status: toContract.ncdStatus(application.status),
    approvedCode: application.approvedCodeId,
    submittedAt: application.submittedAt.toISOString(),
    decidedAt: application.decidedAt?.toISOString() ?? null,
    declarationAcceptedAt: application.declarationAcceptedAt?.toISOString() ?? null,
    declarationVersion: application.declarationVersion,
    discountPercentage: detail.discountPercentage,
    expiresAt: detail.expiresAt,
    decisionNote: application.decisionNote,
    verificationRevision: application.verificationRevision,
    vehicle: detail.vehicle,
    evidence: detail.evidence,
    codeStatus: detail.codeStatus,
  };
}
