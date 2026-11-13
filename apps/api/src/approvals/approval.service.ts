import { Injectable } from '@nestjs/common';
import type { Principal } from '../common/auth/auth.types.js';
import { auditActor } from '../common/audit/audit.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import type { ApprovalRequestInput } from './approval.types.js';
import { ApprovalsRepository, type ApprovalRequestRow } from './approval.repository.js';

const REQUEST_TTL_MS = 7 * 24 * 60 * 60 * 1000;
type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

@Injectable()
export class ApprovalService {
  constructor(
    private readonly approvals: ApprovalsRepository,
    private readonly audit: AuditService,
  ) {}

  async request(input: Omit<ApprovalRequestInput, 'requestedByStaffId'>, principal: StaffPrincipal) {
    const requestedReason = input.requestedReason.trim();
    if (!requestedReason) {
      throw new ApiException('APPROVAL_REASON_REQUIRED', 'Explain why this high-risk action is needed.');
    }
    const created = await this.approvals.transaction(async (tx) => {
      const now = new Date();
      await this.approvals.expirePending(tx, now);
      const [existing] = await this.approvals.pendingFor(tx, input.action, input.targetType, input.targetId);
      if (existing) {
        throw ApiException.conflict('APPROVAL_ALREADY_PENDING', 'An approval for this action is already waiting for review.');
      }
      const request = await this.approvals.create(tx, {
        ...input,
        requestedByStaffId: principal.id,
        requestedReason,
        expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
      });
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'approval.requested',
        entityType: 'APPROVAL_REQUEST',
        entityId: request.id,
        after: { action: request.action, targetType: request.targetType, targetId: request.targetId, status: request.status },
        note: request.requestedReason,
        correlationId: request.id,
      });
      return request;
    });
    return toApprovalResponse(created);
  }

  async list() {
    const requests = await this.approvals.transaction(async (tx) => {
      await this.approvals.expirePending(tx, new Date());
      return this.approvals.list(tx);
    });
    return requests.map((request) => toApprovalResponse(request));
  }

  /**
   * The caller supplies the small, action-specific executor so the decision,
   * business revalidation and final request state share one database transaction.
   */
  async approve(
    id: string,
    principal: StaffPrincipal,
    reason: string | undefined,
    execute: (tx: Transaction, request: ApprovalRequestRow) => Promise<void>,
  ) {
    const approved = await this.approvals.transaction(async (tx) => {
      const now = new Date();
      await this.approvals.expirePending(tx, now);
      const request = await this.approvals.lock(id, tx);
      if (!request) throw ApiException.notFound('Approval request', id);
      this.assertPendingAndIndependent(request, principal, now);
      await execute(tx, request);
      const executed = await this.approvals.markExecuted(tx, id, principal.id, reason?.trim() || null, now);
      if (!executed) throw ApiException.conflict('APPROVAL_ALREADY_DECIDED', 'This approval request is no longer pending.');
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'approval.executed',
        entityType: 'APPROVAL_REQUEST',
        entityId: id,
        before: { status: 'PENDING' },
        after: { action: request.action, targetType: request.targetType, targetId: request.targetId, status: 'EXECUTED' },
        note: reason,
        correlationId: id,
      });
      return executed;
    });
    return toApprovalResponse(approved);
  }

  async reject(id: string, principal: StaffPrincipal, reason: string | undefined) {
    const rejected = await this.approvals.transaction(async (tx) => {
      const now = new Date();
      await this.approvals.expirePending(tx, now);
      const request = await this.approvals.lock(id, tx);
      if (!request) throw ApiException.notFound('Approval request', id);
      this.assertPendingAndIndependent(request, principal, now);
      const result = await this.approvals.markRejected(tx, id, principal.id, reason?.trim() || null, now);
      if (!result) throw ApiException.conflict('APPROVAL_ALREADY_DECIDED', 'This approval request is no longer pending.');
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'approval.rejected',
        entityType: 'APPROVAL_REQUEST',
        entityId: id,
        before: { status: 'PENDING' },
        after: { action: request.action, targetType: request.targetType, targetId: request.targetId, status: 'REJECTED' },
        note: reason,
        correlationId: id,
      });
      return result;
    });
    return toApprovalResponse(rejected);
  }

  private assertPendingAndIndependent(request: ApprovalRequestRow, principal: StaffPrincipal, now: Date) {
    if (request.status !== 'PENDING') {
      throw ApiException.conflict('APPROVAL_ALREADY_DECIDED', 'This approval request is no longer pending.');
    }
    if (request.expiresAt <= now) {
      throw ApiException.conflict('APPROVAL_EXPIRED', 'This approval request has expired.');
    }
    if (request.requestedByStaffId === principal.id) {
      throw ApiException.forbidden('A different authorised administrator must review this request.');
    }
  }
}

function toApprovalResponse(request: ApprovalRequestRow | (ApprovalRequestRow & { requestedByName?: string })) {
  return {
    id: request.id,
    action: request.action,
    status: request.status,
    targetType: request.targetType,
    targetId: request.targetId,
    requestedReason: request.requestedReason,
    requestedByStaffId: request.requestedByStaffId,
    requestedByName: 'requestedByName' in request ? request.requestedByName : undefined,
    // The database payload is deliberately opaque. The API only reveals the
    // action-specific fields a reviewer needs to make this decision; never a
    // future integration credential, document payload, or customer record.
    proposal: safeProposal(request.action, request.payload),
    decidedByStaffId: request.decidedByStaffId,
    decisionReason: request.decisionReason,
    expiresAt: request.expiresAt.toISOString(),
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    executedAt: request.executedAt?.toISOString() ?? null,
  };
}

function safeProposal(action: ApprovalRequestRow['action'], payload: Record<string, unknown>) {
  switch (action) {
    case 'PIA_FLOOR_CHANGE':
      return typeof payload.piaRatePercentage === 'number' ? { piaRatePercentage: payload.piaRatePercentage } : {};
    case 'INSURER_ACTIVATE':
      return {
        effectiveFrom: typeof payload.effectiveFrom === 'string' ? payload.effectiveFrom : null,
        renewalDate: typeof payload.renewalDate === 'string' ? payload.renewalDate : null,
        conditions: typeof payload.conditions === 'string' ? payload.conditions : null,
      };
    case 'INSURER_SUSPEND':
      return { reason: typeof payload.reason === 'string' ? payload.reason : null };
    default:
      return {};
  }
}
