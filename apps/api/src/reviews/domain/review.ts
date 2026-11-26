import { lusakaDay } from '../../common/domain/lusaka.js';

export const REVIEW_ACTIONS = ['PUBLISH', 'REJECT', 'REMOVE', 'REINSTATE'] as const;
export const REVIEW_REASONS = [
  'APPROVED', 'IDENTIFYING_INFORMATION', 'ABUSE', 'SPAM', 'IMPERSONATION', 'UNDISCLOSED_INCENTIVE', 'REVIEW_POLICY',
] as const;
export const REVIEW_STATES = ['PENDING', 'PUBLISHED', 'REJECTED', 'REMOVED', 'SUPERSEDED'] as const;

export function withinReviewWindow(start: Date, now: Date, days: number): boolean {
  const first = lusakaDay(start);
  const today = lusakaDay(now);
  const last = new Date(first);
  last.setUTCDate(last.getUTCDate() + days);
  return start <= now && today <= last.toISOString().slice(0, 10);
}

export function nextReviewStatus(
  status: typeof REVIEW_STATES[number],
  action: typeof REVIEW_ACTIONS[number],
) {
  if (status === 'PENDING' && action === 'PUBLISH') return 'PUBLISHED';
  if (status === 'PENDING' && action === 'REJECT') return 'REJECTED';
  if (status === 'PUBLISHED' && action === 'REMOVE') return 'REMOVED';
  if (status === 'REMOVED' && action === 'REINSTATE') return 'PUBLISHED';
  return null;
}
