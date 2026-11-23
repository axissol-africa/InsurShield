import type { InspectionRule, InspectionTiming, QuoteProductStatus } from '../../common/domain/enums.js';

/**
 * The life of one chosen product version, from the customer's submit to a
 * quote, a decline or a closed outcome. Every change of `status` on
 * `quote_request_product_versions` goes through `nextStatus`, so a version can
 * never jump somewhere the table below does not allow.
 */
export type QuoteProductEvent =
  | 'REQUEST_INFORMATION'
  | 'CUSTOMER_ANSWERED'
  | 'QUOTE'
  | 'DECLINE'
  | 'TIME_OUT'
  | 'EXPIRE'
  | 'CANCEL';

/** Waiting on the insurer or the customer; the version can still end in a quote. */
export const OPEN_QUOTE_PRODUCT_STATUSES = [
  'SUBMITTED',
  'INSURER_PROCESSING',
  'VERIFICATION_REQUIRED',
  'INSPECTION_REQUIRED',
  'MANUAL_REVIEW',
] as const satisfies readonly QuoteProductStatus[];

/** The states the insurer may quote from. An inspection before quotation has to pass first. */
export const QUOTABLE_STATUSES = [
  'SUBMITTED',
  'INSURER_PROCESSING',
  'VERIFICATION_REQUIRED',
] as const satisfies readonly QuoteProductStatus[];

/** The customer is being waited for, so the insurer's reply clock is stopped. */
export const PAUSED_STATUSES = ['VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED'] as const satisfies readonly QuoteProductStatus[];

const TRANSITIONS: Record<QuoteProductEvent, { from: readonly QuoteProductStatus[]; to: QuoteProductStatus }> = {
  REQUEST_INFORMATION: { from: ['SUBMITTED', 'INSURER_PROCESSING'], to: 'VERIFICATION_REQUIRED' },
  CUSTOMER_ANSWERED: { from: ['VERIFICATION_REQUIRED'], to: 'INSURER_PROCESSING' },
  QUOTE: { from: QUOTABLE_STATUSES, to: 'QUOTED' },
  DECLINE: {
    from: ['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED'],
    to: 'DECLINED',
  },
  TIME_OUT: {
    from: ['SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED'],
    to: 'TIMED_OUT',
  },
  EXPIRE: { from: ['QUOTED'], to: 'EXPIRED' },
  // Decision 24. Whether a quoted version is still unpaid is the caller's
  // question: a paid version keeps its quote and is never cancelled.
  CANCEL: { from: [...OPEN_QUOTE_PRODUCT_STATUSES, 'QUOTED'], to: 'CANCELLED' },
};

/** The state `event` moves `current` to, or null when the table does not allow it. */
export function nextStatus(current: QuoteProductStatus, event: QuoteProductEvent): QuoteProductStatus | null {
  const transition = TRANSITIONS[event];
  return transition.from.includes(current) ? transition.to : null;
}

/** Every state `event` may start from, for a guarded UPDATE. */
export function statusesAllowing(event: QuoteProductEvent): QuoteProductStatus[] {
  return [...TRANSITIONS[event].from];
}

export function isOpenStatus(status: QuoteProductStatus): boolean {
  return (OPEN_QUOTE_PRODUCT_STATUSES as readonly QuoteProductStatus[]).includes(status);
}

/**
 * Where a version starts. A rule that needs an inspection before quotation
 * holds it until an inspection passes, and the reply clock waits with it.
 */
export function initialStatus(rule: InspectionRule, timing: InspectionTiming | null): QuoteProductStatus {
  return rule === 'REQUIRED' && timing === 'BEFORE_QUOTATION' ? 'INSPECTION_REQUIRED' : 'SUBMITTED';
}

/**
 * The reply due date once the customer has answered. The insurer is not
 * charged for the time it spent waiting, so the due date moves on by exactly
 * that time.
 */
export function resumedReplyDueAt(replyDueAt: Date, pausedAt: Date, resumedAt: Date): Date {
  const waited = Math.max(0, resumedAt.getTime() - pausedAt.getTime());
  return new Date(replyDueAt.getTime() + waited);
}

/** What the customer reads for each state. Internal detail never appears here. */
export const CUSTOMER_STATUS_LABELS: Record<QuoteProductStatus, string> = {
  SUBMITTED: 'Waiting for the insurer',
  INSURER_PROCESSING: 'The insurer is working on it',
  VERIFICATION_REQUIRED: 'The insurer needs more information',
  INSPECTION_REQUIRED: 'Inspection needed, the insurer will contact you',
  QUOTED: 'Quote ready',
  DECLINED: 'Declined',
  TIMED_OUT: 'The insurer did not respond in time',
  EXPIRED: 'Quote expired',
  CANCELLED: 'Cancelled',
  MANUAL_REVIEW: 'Under review',
};
