export const REQUEST_KINDS = [
  'ACCESS',
  'CORRECTION',
  'ERASURE',
  'RESTRICTION',
  'RETENTION_REVIEW',
] as const;
export const REQUEST_STATUSES = [
  'SUBMITTED',
  'VERIFIED',
  'DECIDED',
  'COMPLETED',
] as const;
export const REVIEW_ACTIONS = [
  'ASSIGNED',
  'VERIFIED',
  'DECIDED',
  'COMPLETED',
] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];
export function nextStatus(
  status: string,
  action: ReviewAction,
): string | null {
  if (status === 'COMPLETED') return null;
  if (action === 'ASSIGNED') return status;
  if (status === 'SUBMITTED' && action === 'VERIFIED') return 'VERIFIED';
  if (status === 'VERIFIED' && action === 'DECIDED') return 'DECIDED';
  if (status === 'DECIDED' && action === 'COMPLETED') return 'COMPLETED';
  return null;
}
