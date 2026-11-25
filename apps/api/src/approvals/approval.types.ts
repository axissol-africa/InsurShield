import type { ApprovalAction } from '../common/domain/enums.js';

export type ApprovalPayload =
  | { piaRatePercentage: number }
  | { effectiveFrom: string; renewalDate: string | null; conditions: string | null }
  | { reason: string }
  | { transactionId: string; amount: number; paidAmount: number; reasonCode: string; reason: string }
  | { reference: string; insurer: string; period: string; netPayable: number; grossPremium: number }
  | { insurerId: string; insurer: string; amountMinor: number; amount: number; kind: string; reason: string; reconciliationItemId: string | null }
  | Record<string, never>;

export interface ApprovalRequestInput {
  action: ApprovalAction;
  targetType: 'SETTING' | 'INSURER' | 'REFUND' | 'SETTLEMENT' | 'ADJUSTMENT';
  targetId: string;
  payload: ApprovalPayload;
  requestedByStaffId: string;
  requestedReason: string;
}

export interface ApprovalDecision {
  reason?: string;
}
