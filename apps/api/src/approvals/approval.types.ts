import type { ApprovalAction } from '../common/domain/enums.js';

export type ApprovalPayload =
  | { piaRatePercentage: number }
  | { effectiveFrom: string; renewalDate: string | null; conditions: string | null }
  | { reason: string }
  | Record<string, never>;

export interface ApprovalRequestInput {
  action: ApprovalAction;
  targetType: 'SETTING' | 'INSURER';
  targetId: string;
  payload: ApprovalPayload;
  requestedByStaffId: string;
  requestedReason: string;
}

export interface ApprovalDecision {
  reason?: string;
}
