import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import { isUniqueViolation } from '../db/errors.js';
import { amendmentFailure, evidenceReference } from './domain/risk-review.js';
import type { AssignRiskDto, ListRiskQuery, ReferRiskDto, ResolveRiskDto } from './dto/risk-review.dto.js';
import { riskReviewResponse } from './dto/risk-review.response.js';
import { RiskReviewRepository, type RiskReviewRow } from './risk-review.repository.js';
@Injectable()
export class RiskReviewService {
  constructor(private readonly repository: RiskReviewRepository, private readonly audit: AuditService) {}
  private authorize(principal: Principal): asserts principal is Extract<Principal, { kind: 'staff' }> {
    if (principal.kind !== 'staff' || principal.insurerId !== null || !holds(principal, 'admin:risk:review')) throw ApiException.forbidden();
  }
  async list(principal: Principal, query: ListRiskQuery) {
    this.authorize(principal);
    const limit = query.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ApiException('VALIDATION_FAILED', 'Choose a page size from 1 to 100.');
    const rows = await this.repository.list(query);
    const items = rows.slice(0, limit).map(riskReviewResponse);
    return { items, next: rows.length > limit ? items[items.length - 1].id : null };
  }
  async refer(principal: Principal, dto: ReferRiskDto) {
    this.authorize(principal);
    if (dto.evidenceReference !== evidenceReference(dto.workflowType, dto.workflowId)) throw new ApiException('VALIDATION_FAILED', 'Evidence must identify the referred workflow record.');
    try {
      return await this.repository.transaction(async (tx) => {
        await this.actor(tx, principal.id);
        if (!await this.repository.referenceExists(tx, dto.workflowType, dto.workflowId)) throw ApiException.notFound('Workflow record');
        const row = await this.repository.create(tx, {
          quoteId: dto.workflowType === 'QUOTE' ? dto.workflowId : null,
          reconciliationItemId: dto.workflowType === 'RECONCILIATION_ITEM' ? dto.workflowId : null,
          evidenceReference: dto.evidenceReference, severity: dto.severity, reason: dto.reason.trim(), nextAction: dto.nextAction.trim(), referredByStaffId: principal.id,
        });
        await this.record(tx, principal, 'risk_review.referred', row);
        return riskReviewResponse(row);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'risk_review_quote_open_key') || isUniqueViolation(error, 'risk_review_reconciliation_open_key')) throw ApiException.conflict('RISK_REVIEW_EXISTS', 'An open review already exists for this record.');
      throw error;
    }
  }
  async assign(principal: Principal, id: string, dto: AssignRiskDto) {
    this.authorize(principal);
    return this.repository.transaction(async (tx) => {
      await this.actor(tx, principal.id);
      const row = await this.editable(tx, id, dto.expectedVersion);
      if (dto.staffId && !await this.repository.activeAdmin(tx, dto.staffId)) throw new ApiException('VALIDATION_FAILED', 'Choose an active InsurShield administrator.');
      return this.save(tx, principal, row, { ownerStaffId: dto.staffId, status: dto.staffId ? 'IN_PROGRESS' : 'OPEN', nextAction: dto.nextAction.trim() }, 'risk_review.assigned');
    });
  }
  async resolve(principal: Principal, id: string, dto: ResolveRiskDto) {
    this.authorize(principal);
    return this.repository.transaction(async (tx) => {
      await this.actor(tx, principal.id);
      const row = await this.editable(tx, id, dto.expectedVersion);
      return this.save(tx, principal, row, { status: 'RESOLVED', outcome: dto.outcome, resolutionReason: dto.reason.trim(), nextAction: dto.nextAction.trim(), resolvedByStaffId: principal.id, resolvedAt: new Date() }, 'risk_review.resolved');
    });
  }
  private async actor(tx: Transaction, id: string) {
    if (!await this.repository.activeAdmin(tx, id)) throw ApiException.forbidden();
  }
  private async editable(tx: Transaction, id: string, version: number) {
    const row = await this.repository.lock(tx, id);
    if (!row) throw ApiException.notFound('Risk review');
    const failure = amendmentFailure(row.status, row.version, version);
    if (failure) throw ApiException.conflict(failure, failure === 'RISK_REVIEW_STALE' ? 'Refresh this review before saving.' : 'This review is already resolved.');
    return row;
  }
  private async save(tx: Transaction, principal: Principal, row: RiskReviewRow, values: Parameters<RiskReviewRepository['update']>[2], action: string) {
    const updated = await this.repository.update(tx, row, values);
    if (!updated) throw ApiException.conflict('RISK_REVIEW_STALE', 'Refresh this review before saving.');
    await this.record(tx, principal, action, updated, row);
    return riskReviewResponse(updated);
  }
  private record(tx: Transaction, principal: Principal, action: string, row: RiskReviewRow, before?: RiskReviewRow) {
    return this.audit.write(tx, { actor: auditActor(principal), action, entityType: 'RISK_REVIEW', entityId: row.id,
      before: before ? { status: before.status, version: before.version, ownerStaffId: before.ownerStaffId } : null,
      after: { status: row.status, version: row.version, ownerStaffId: row.ownerStaffId, outcome: row.outcome, workflowEffect: row.workflowEffect }, correlationId: row.id });
  }
}
