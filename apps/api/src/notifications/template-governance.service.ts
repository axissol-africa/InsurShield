import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import { isUniqueViolation } from '../db/errors.js';
import { validTemplateCopy } from './domain/template-governance.js';
import {
  CreateTemplateVersionDto,
  ReviewTemplateDto,
  TemplatePageDto,
  toTemplate,
} from './dto/template-governance.dto.js';
import type { TemplateRow } from './notifications.repository.js';
import { TemplateGovernanceRepository } from './template-governance.repository.js';

@Injectable()
export class TemplateGovernanceService {
  constructor(
    private readonly repository: TemplateGovernanceRepository,
    private readonly audit: AuditService,
  ) {}

  private admin(principal: Principal) {
    if (
      principal.kind !== 'staff' ||
      !holds(principal, 'admin:notification:manage')
    )
      throw ApiException.forbidden();
    return principal;
  }
  async list(principal: Principal, page: TemplatePageDto) {
    this.admin(principal);
    return { items: (await this.repository.list(page)).map(toTemplate) };
  }
  async create(
    principal: Principal,
    id: string,
    input: CreateTemplateVersionDto,
    now = new Date(),
  ) {
    const actor = this.admin(principal);
    const effectiveFrom = new Date(input.effectiveFrom);
    const expiresAt = new Date(input.expiresAt);
    if (
      !Number.isFinite(effectiveFrom.getTime()) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt <= effectiveFrom ||
      expiresAt <= now ||
      !input.owner.trim() ||
      input.owner.length > 120
    )
      throw invalid();
    try {
      return await this.repository.transaction(async (tx) => {
        const rows = await this.series(tx, id);
        const source = rows.find((row) => row.id === id);
        if (
          !source ||
          source.version !== input.expectedVersion ||
          source.version !== rows.at(-1)?.version
        )
          throw conflict();
        if (!validTemplateCopy(source, input.subject, input.body))
          throw invalid();
        const created = await this.repository.insert(tx, {
          key: source.key,
          channel: source.channel,
          category: source.category,
          mandatory: source.mandatory,
          version: source.version + 1,
          subject: input.subject.trim(),
          body: input.body.trim(),
          owner: input.owner.trim(),
          reviewStatus: 'DRAFT',
          effectiveFrom,
          expiresAt,
          activeFrom: null,
          createdBy: actor.id,
          createdByRole: actor.role,
        });
        await this.record(tx, principal, 'created', created);
        return toTemplate(created);
      });
    } catch (error) {
      if (
        isUniqueViolation(
          error,
          'notification_templates_key_channel_version_key',
        )
      )
        throw conflict();
      throw error;
    }
  }
  async review(
    principal: Principal,
    id: string,
    input: ReviewTemplateDto,
    action: 'approve' | 'withdraw',
    now = new Date(),
  ) {
    const actor = this.admin(principal);
    if (!input.reason.trim() || input.reason.length > 500) throw invalid();
    return this.repository.transaction(async (tx) => {
      const rows = await this.series(tx, id);
      const row = rows.find((item) => item.id === id);
      if (
        !row ||
        row.version !== input.expectedVersion ||
        row.reviewStatus === 'WITHDRAWN'
      )
        throw conflict();
      if (
        action === 'approve' &&
        (row.reviewStatus !== 'DRAFT' ||
          row.version !== rows.at(-1)?.version ||
          !row.createdBy ||
          row.createdBy === actor.id ||
          !row.effectiveFrom ||
          !row.expiresAt ||
          row.expiresAt <= now ||
          row.expiresAt <= row.effectiveFrom ||
          !validTemplateCopy(row, row.subject, row.body))
      ) {
        throw ApiException.conflict(
          'NOTIFICATION_TEMPLATE_REVIEW',
          'A current valid draft requires an independent administrator approval.',
        );
      }
      const updated = await this.repository.review(
        tx,
        id,
        row.reviewStatus,
        action === 'approve'
          ? {
              reviewStatus: 'APPROVED',
              activeFrom: row.effectiveFrom,
              approvedBy: actor.id,
              approvedByRole: actor.role,
              approvedAt: now,
            }
          : {
              reviewStatus: 'WITHDRAWN',
              withdrawnBy: actor.id,
              withdrawnAt: now,
            },
      );
      if (!updated) throw conflict();
      await this.record(
        tx,
        principal,
        action === 'approve' ? 'approved' : 'withdrawn',
        updated,
        input.reason.trim(),
      );
      return toTemplate(updated);
    });
  }
  private async series(tx: Transaction, id: string) {
    const row = await this.repository.find(tx, id);
    if (!row) throw ApiException.notFound('Notification template');
    return this.repository.lockSeries(tx, row.key, row.channel);
  }
  private record(
    tx: Transaction,
    principal: Principal,
    action: string,
    row: TemplateRow,
    reason?: string,
  ) {
    return this.audit.write(tx, {
      actor: auditActor(principal),
      action: `notification_template.${action}`,
      entityType: 'NOTIFICATION_TEMPLATE',
      entityId: row.id,
      after: {
        key: row.key,
        channel: row.channel,
        version: row.version,
        owner: row.owner,
        reviewStatus: row.reviewStatus,
        actorRole: principal.kind === 'staff' ? principal.role : null,
      },
      note: reason,
    });
  }
  async exceptions(
    principal: Principal,
    page: TemplatePageDto,
    now = new Date(),
  ) {
    this.admin(principal);
    return {
      items: (await this.repository.exceptions(page)).map((row) => ({
        id: row.id,
        event: row.event,
        version: row.version,
        channel: row.channel,
        owner: row.owner ?? 'PLATFORM',
        deliveryStatus: row.deliveryStatus,
        retryState: row.retryState ?? 'UNSCHEDULED',
        attempt: row.attempt ?? 0,
        maxAttempts: row.maxAttempts ?? 0,
        nextAttemptAt:
          row.retryState === 'PENDING'
            ? (row.runAfter?.toISOString() ?? null)
            : null,
        reason:
          row.templateStatus !== 'APPROVED' ||
          (row.expiresAt && row.expiresAt <= now)
            ? 'TEMPLATE_UNAVAILABLE'
            : row.deliveryStatus === 'FAILED'
              ? 'DELIVERY_REFUSED'
              : row.retryState === 'FAILED'
                ? 'RETRY_EXHAUSTED'
                : 'DELIVERY_RETRY_PENDING',
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }
}
function invalid() {
  return new ApiException(
    'INVALID_NOTIFICATION_TEMPLATE',
    'Use valid plain text, allowed placeholders, an owner and an effective/expiry window.',
  );
}
function conflict() {
  return ApiException.conflict(
    'NOTIFICATION_TEMPLATE_CONFLICT',
    'The template changed; reload the current version.',
  );
}
