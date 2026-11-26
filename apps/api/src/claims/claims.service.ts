import { Injectable } from '@nestjs/common';
import type { Principal } from '../common/auth/auth.types.js';
import { holds, type Permission } from '../common/auth/permissions.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { toContract } from '../common/contract.js';
import { ApiException } from '../common/errors/api.exception.js';
import {
  IdempotencyService,
  idempotencyKey,
} from '../common/idempotency/idempotency.service.js';
import { assertOpenCustomer, lockOpenCustomer } from '../db/customer-lock.js';
import type { Transaction } from '../db/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ClaimsRepository, type LifecycleClaim } from './claims.repository.js';
import {
  CLAIM_NOTIFICATION_KEYS,
  claimRevision,
  nextClaimStatus,
  type LifecycleAction,
} from './domain/lifecycle.js';
import type { ClaimEvidenceDto, ClaimUpdateDto } from './dto/claims.dto.js';
import type {
  ClaimTimeline,
  ClaimTimelineUpdate,
} from './dto/claims.response.js';

@Injectable()
export class ClaimsService {
  constructor(
    private readonly claims: ClaimsRepository,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private authorize(principal: Principal, permission: Permission) {
    if (
      !holds(principal, permission) ||
      (principal.kind === 'staff' && !principal.insurerId)
    ) {
      throw ApiException.forbidden();
    }
  }

  async timeline(
    principal: Principal,
    claimNumber: string,
    audience: 'customer' | 'insurer',
  ): Promise<ClaimTimeline> {
    this.authorize(
      principal,
      audience === 'customer' ? 'claim:read' : 'portal:claim:read',
    );
    return this.claims.transaction(async (tx) => {
      const claim = await this.owned(tx, principal, claimNumber);
      return this.detail(tx, claim);
    });
  }

  async update(
    principal: Principal,
    claimNumber: string,
    dto: ClaimUpdateDto,
    key?: string,
  ): Promise<ClaimTimeline> {
    this.authorize(principal, 'portal:claim:update');
    if (
      !dto.message.trim() ||
      (dto.action === 'REQUEST_EVIDENCE'
        ? !dto.evidenceRequest?.trim()
        : dto.evidenceRequest != null)
    ) {
      throw new ApiException(
        'VALIDATION_FAILED',
        'Provide a message and an evidence request only when requesting evidence.',
      );
    }
    return this.command(
      principal,
      claimNumber,
      dto.action,
      dto.message.trim(),
      dto.evidenceRequest?.trim() ?? null,
      [],
      dto,
      key,
    );
  }

  async evidence(
    principal: Principal,
    claimNumber: string,
    dto: ClaimEvidenceDto,
    key?: string,
  ): Promise<ClaimTimeline> {
    this.authorize(principal, 'claim:evidence');
    if (!dto.documentIds.length)
      throw new ApiException(
        'VALIDATION_FAILED',
        'Attach the requested evidence.',
      );
    return this.command(
      principal,
      claimNumber,
      'SUBMIT_EVIDENCE',
      'Customer supplied the requested evidence.',
      null,
      dto.documentIds,
      dto,
      key,
    );
  }

  private async command(
    principal: Principal,
    claimNumber: string,
    action: LifecycleAction,
    message: string,
    evidenceRequest: string | null,
    documentIds: string[],
    request: ClaimUpdateDto | ClaimEvidenceDto,
    key?: string,
  ): Promise<ClaimTimeline> {
    // Replays must still pass current tenancy checks, even when the command itself is already committed.
    const observed = await this.claims.transaction((tx) =>
      this.owned(tx, principal, claimNumber),
    );
    const endpoint =
      action === 'SUBMIT_EVIDENCE'
        ? `POST /claims/${claimNumber}/evidence`
        : `POST /insurer/claims/${claimNumber}/updates`;
    const { value } = await this.idempotency.execute(
      `${principal.kind}:${principal.id}`,
      endpoint,
      idempotencyKey(key),
      request,
      async (tx) => {
        if (principal.kind === 'customer')
          await assertOpenCustomer(tx, principal.id);
        // The discovery transaction is finished: closure and evidence requests both lock customer before claim.
        if (
          action === 'REQUEST_EVIDENCE' &&
          (!observed.customerId ||
            !(await lockOpenCustomer(tx, observed.customerId)))
        ) {
          throw ApiException.conflict(
            'CLAIM_CUSTOMER_UNAVAILABLE',
            'The claim customer is not available to supply evidence.',
          );
        }
        if (
          principal.kind === 'staff' &&
          principal.insurerId &&
          !(await this.claims.lockServicingInsurer(tx, principal.insurerId))
        ) {
          throw ApiException.notFound('Claim', claimNumber);
        }
        const claim = await this.owned(tx, principal, claimNumber, true);
        if (
          action === 'REQUEST_EVIDENCE' &&
          claim.customerId !== observed.customerId
        ) {
          throw ApiException.conflict(
            'CLAIM_CUSTOMER_UNAVAILABLE',
            'The claim customer changed. Refresh the claim before requesting evidence.',
          );
        }
        const events = await this.claims.updates(tx, claimNumber);
        if (
          request.expectedRevision !==
          claimRevision(claimNumber, claim.receivedAt, events.at(-1)?.id)
        ) {
          throw ApiException.conflict(
            'CLAIM_REVISION_CHANGED',
            'The claim has changed. Refresh it before continuing.',
          );
        }
        const status = nextClaimStatus(claim.status, action);
        if (!status)
          throw ApiException.conflict(
            'CLAIM_INVALID_TRANSITION',
            'This action is not available at the current claim status.',
          );
        if ((action === 'APPROVE' || action === 'DECLINE' || action === 'CLOSE') &&
            await this.claims.hasOpenInspection(tx, claimNumber)) {
          throw ApiException.conflict('CLAIM_INSPECTION_OPEN', 'Complete or cancel the open inspection before deciding the claim.');
        }
        if (action === 'SUBMIT_EVIDENCE') {
          await this.documents.assertAttachable(
            tx,
            principal,
            documentIds,
            'CLAIM_ATTACHMENT',
            { requireClean: true },
          );
        }
        const updated = await this.claims.changeStatus(tx, claim, status);
        if (!updated)
          throw ApiException.conflict(
            'CLAIM_INVALID_TRANSITION',
            'The claim changed. Refresh and try again.',
          );
        const event = await this.claims.append(
          tx,
          {
            claimNumber,
            status,
            actorKind: principal.kind === 'customer' ? 'CUSTOMER' : 'INSURER',
            message,
            evidenceRequest,
          },
          documentIds,
        );
        const actor = auditActor(principal);
        await this.audit.write(tx, {
          actor,
          action: CLAIM_NOTIFICATION_KEYS[action],
          entityType: 'CLAIM',
          entityId: claimNumber,
          before: { status: claim.status },
          after: {
            status,
            updateId: event.id,
            documentCount: documentIds.length,
          },
          correlationId: claimNumber,
        });
        await this.audit.transition(tx, {
          actor,
          entityType: 'CLAIM',
          entityId: claimNumber,
          fromStatus: claim.status,
          toStatus: status,
          correlationId: claimNumber,
        });
        if (claim.customerId)
          await this.notifications.notify(tx, {
            customerId: claim.customerId,
            key: CLAIM_NOTIFICATION_KEYS[action],
            entity: { type: 'CLAIM', id: claimNumber },
            values: { claimNumber },
          });
        return this.detail(tx, updated);
      },
    );
    return value;
  }

  private async owned(
    tx: Transaction,
    principal: Principal,
    claimNumber: string,
    lock = false,
  ) {
    const claim = await this.claims.find(tx, principal, claimNumber, lock);
    if (!claim) throw ApiException.notFound('Claim', claimNumber);
    return claim;
  }

  private async detail(
    tx: Transaction,
    claim: LifecycleClaim,
  ): Promise<ClaimTimeline> {
    const events = await this.claims.updates(tx, claim.claimNumber);
    const attachments = await this.claims.attachments(tx, claim.claimNumber);
    const inspection = await this.claims.latestInspection(tx, claim);
    const updates: ClaimTimelineUpdate[] = [
      {
        id: `${claim.claimNumber}:submitted`,
        status: toContract.claimStatus('NOTIFIED'),
        actorKind: 'CUSTOMER',
        message: 'Claim notification submitted.',
        evidenceRequest: null,
        createdAt: claim.submittedAt.toISOString(),
        documents: [],
      },
    ];
    if (claim.receivedAt)
      updates.push({
        id: `${claim.claimNumber}:acknowledged`,
        status: toContract.claimStatus('RECEIVED_BY_INSURER'),
        actorKind: 'INSURER',
        message: 'Insurer acknowledged the claim notification.',
        evidenceRequest: null,
        createdAt: claim.receivedAt.toISOString(),
        documents: [],
      });
    for (const event of events)
      updates.push({
        id: event.id,
        status: toContract.claimStatus(event.status),
        actorKind: event.actorKind,
        message: event.message,
        evidenceRequest: event.evidenceRequest,
        createdAt: event.createdAt.toISOString(),
        documents: [],
      });
    for (const attachment of attachments) {
      const update = updates.find(
        (row) =>
          row.id ===
          (attachment.claimUpdateId ?? `${claim.claimNumber}:submitted`),
      );
      if (update)
        update.documents.push(
          await this.documents.record(attachment.documentId, tx),
        );
    }
    return {
      claimNumber: claim.claimNumber,
      revision: claimRevision(
        claim.claimNumber,
        claim.receivedAt,
        events.at(-1)?.id,
      ),
      status: toContract.claimStatus(claim.status),
      responseDueOn: claim.responseDueOn,
      lateSubmission: claim.lateSubmission,
      insurerClaimReference: claim.insurerClaimReference,
      ...(inspection && { inspection: { ...inspection, status: toContract.inspectionStatus(inspection.status) } }),
      updates,
    };
  }
}
