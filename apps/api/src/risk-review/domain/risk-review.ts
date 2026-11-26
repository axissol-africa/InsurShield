export const WORKFLOW_TYPES = ['RECONCILIATION_ITEM', 'QUOTE'] as const;
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
export const STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export const OUTCOMES = ['NO_ACTION', 'REFERRED'] as const;
export type WorkflowType = typeof WORKFLOW_TYPES[number];
export function evidenceReference(type: WorkflowType, id: string): string {
  return `${type === 'QUOTE' ? 'quote' : 'reconciliation'}:${id.toLowerCase()}`;
}
export function amendmentFailure(status: typeof STATUSES[number], version: number, expectedVersion: number) {
  if (status === 'RESOLVED') return 'RISK_REVIEW_RESOLVED';
  if (version !== expectedVersion) return 'RISK_REVIEW_STALE';
  return null;
}
