import {
  OPEN_SERVICE_REQUEST_STATUSES,
  type PolicyStatus,
  type ServiceRequestStatus,
  type ServiceRequestType,
} from '../../common/domain/enums.js';

/**
 * What can happen to a service request, and from where. The table is the whole
 * state model: a move it does not list is refused, whoever asks.
 */
export type ServiceRequestAction =
  | 'REVIEW'
  | 'REQUEST_INFORMATION'
  | 'REPLY'
  | 'APPROVE'
  | 'DECLINE'
  | 'COMPLETE'
  | 'WITHDRAW'
  | 'UPDATE';

const OPEN: readonly ServiceRequestStatus[] = OPEN_SERVICE_REQUEST_STATUSES;

const MOVES: Record<ServiceRequestAction, { from: readonly ServiceRequestStatus[]; to: ServiceRequestStatus | null }> = {
  REVIEW: { from: ['SUBMITTED'], to: 'IN_REVIEW' },
  // Asking straight away takes the request into review on the way.
  REQUEST_INFORMATION: { from: ['SUBMITTED', 'IN_REVIEW'], to: 'INFORMATION_REQUIRED' },
  REPLY: { from: ['INFORMATION_REQUIRED'], to: 'IN_REVIEW' },
  APPROVE: { from: ['SUBMITTED', 'IN_REVIEW'], to: 'APPROVED' },
  // A customer who never answers must not hold the request open for ever.
  DECLINE: { from: ['SUBMITTED', 'IN_REVIEW', 'INFORMATION_REQUIRED'], to: 'DECLINED' },
  COMPLETE: { from: ['APPROVED'], to: 'COMPLETED' },
  WITHDRAW: { from: OPEN, to: 'WITHDRAWN' },
  UPDATE: { from: OPEN, to: null },
};

export const canMove = (action: ServiceRequestAction, status: ServiceRequestStatus): boolean => MOVES[action].from.includes(status);

/** Where a move lands, or the status unchanged for a message that moves nothing. */
export const statusAfter = (action: ServiceRequestAction, status: ServiceRequestStatus): ServiceRequestStatus => MOVES[action].to ?? status;

export const movesFrom = (action: ServiceRequestAction): readonly ServiceRequestStatus[] => MOVES[action].from;

export const isOpen = (status: ServiceRequestStatus): boolean => OPEN.includes(status);

/**
 * Policies a customer may ask about. A policy still being issued can be asked
 * about, but only cover that is in force can be cancelled: before issue, the
 * insurer reports it cannot issue and the customer is refunded that way.
 */
export function policyProblem(type: ServiceRequestType, status: PolicyStatus): 'POLICY_NOT_SERVICEABLE' | 'POLICY_NOT_ACTIVE' | null {
  if (status !== 'ACTIVE' && status !== 'AWAITING_INSURER_CERTIFICATE') return 'POLICY_NOT_SERVICEABLE';
  if (type === 'CANCELLATION' && status !== 'ACTIVE') return 'POLICY_NOT_ACTIVE';
  return null;
}

/** A cancellation date must be today or later, and no later than the cover's own last day. Dates are Lusaka days. */
export function cancellationDateProblem(requested: string, today: string, coverEnds: string | null): 'DATE_IN_PAST' | 'DATE_AFTER_COVER' | null {
  if (requested < today) return 'DATE_IN_PAST';
  if (coverEnds !== null && requested > coverEnds) return 'DATE_AFTER_COVER';
  return null;
}

/** An insurer cannot refund more than is left of what was paid. */
export const refundTooLarge = (amountMinor: number, paidMinor: number, refundedMinor: number): boolean =>
  amountMinor > Math.max(0, paidMinor - refundedMinor);
