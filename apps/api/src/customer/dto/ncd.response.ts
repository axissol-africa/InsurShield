import { toContract } from '../../common/contract.js';
import type { NcdCodeRefusal } from '../domain/ncd-code.js';
import type { NcdApplicationRow, NcdCodeWithInsurer } from '../ncd.repository.js';

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
}

export type NcdCodeValidation =
  | { valid: false; reason: NcdCodeRefusal }
  | {
      valid: true;
      code: string;
      insurerId: string;
      insurer: string;
      percentage: number;
      yearsClaimFree: number;
      expiresAt: string | null;
    };

export function toNcdApplicationResponse(application: NcdApplicationRow, insurerName: string): NcdApplicationResponse {
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
  };
}

export function toUsableNcdCode(code: NcdCodeWithInsurer): NcdCodeValidation {
  return {
    valid: true,
    code: code.code,
    insurerId: code.insurerId,
    insurer: code.insurerName,
    percentage: code.percentage,
    yearsClaimFree: code.yearsClaimFree,
    expiresAt: code.expiresAt?.toISOString() ?? null,
  };
}
