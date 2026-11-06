import { toContract } from '../../common/contract.js';
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
}

/** Public validation deliberately reveals no code, insurer or discount data. */
export interface NcdCodeValidation {
  valid: boolean;
}

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
