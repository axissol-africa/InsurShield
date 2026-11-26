import type { ClaimStatus } from '../../common/domain/enums.js';

export const CLAIM_ACTIONS = [
  'START_REVIEW',
  'REQUEST_EVIDENCE',
  'APPROVE',
  'DECLINE',
  'CLOSE',
] as const;
export type ClaimAction = (typeof CLAIM_ACTIONS)[number];
export type LifecycleAction = ClaimAction | 'SUBMIT_EVIDENCE';

export function nextClaimStatus(
  status: ClaimStatus,
  action: LifecycleAction,
): ClaimStatus | null {
  switch (action) {
    case 'START_REVIEW':
      return status === 'RECEIVED_BY_INSURER' ? 'UNDER_REVIEW' : null;
    case 'REQUEST_EVIDENCE':
      return status === 'UNDER_REVIEW' ? 'EVIDENCE_REQUIRED' : null;
    case 'SUBMIT_EVIDENCE':
      return status === 'EVIDENCE_REQUIRED' ? 'UNDER_REVIEW' : null;
    case 'APPROVE':
      return status === 'UNDER_REVIEW' ? 'APPROVED' : null;
    case 'DECLINE':
      return status === 'UNDER_REVIEW' ? 'DECLINED' : null;
    case 'CLOSE':
      return status === 'APPROVED' || status === 'DECLINED' ? 'CLOSED' : null;
  }
}

export const CLAIM_NOTIFICATION_KEYS: Record<LifecycleAction, string> = {
  START_REVIEW: 'claim.review_started',
  REQUEST_EVIDENCE: 'claim.evidence_requested',
  SUBMIT_EVIDENCE: 'claim.evidence_submitted',
  APPROVE: 'claim.approved',
  DECLINE: 'claim.declined',
  CLOSE: 'claim.closed',
};

export function claimRevision(
  claimNumber: string,
  receivedAt: Date | null,
  latestUpdateId?: string,
): string {
  return (
    latestUpdateId ??
    `${claimNumber}:${receivedAt ? 'acknowledged' : 'submitted'}`
  );
}
