import type { RiskReviewRow } from '../risk-review.repository.js';
export function riskReviewResponse(row: RiskReviewRow) {
  return {
    id: row.id, workflowType: row.quoteId ? 'QUOTE' : 'RECONCILIATION_ITEM', workflowId: row.quoteId ?? row.reconciliationItemId,
    evidenceReference: row.evidenceReference, severity: row.severity, reason: row.reason, nextAction: row.nextAction,
    status: row.status, workflowEffect: row.workflowEffect, ownerStaffId: row.ownerStaffId,
    referredByStaffId: row.referredByStaffId, openedAt: row.openedAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    version: row.version, outcome: row.outcome, resolutionReason: row.resolutionReason,
    resolvedByStaffId: row.resolvedByStaffId, resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}
