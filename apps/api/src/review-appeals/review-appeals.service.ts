import { NotificationsService } from '../notifications/notifications.service.js';
import { Injectable } from '@nestjs/common';
import { auditActor } from '../common/audit/audit.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { ApiException } from '../common/errors/api.exception.js';
import { assertOpenCustomer } from '../db/customer-lock.js';
import { assertReviewPublicText } from '../reviews/publication.js';
import { isUniqueViolation } from '../db/errors.js';
import { SettingsService } from '../settings/settings.service.js';
import { appealAllowed, deadline, inverse } from './domain/appeals.js';
import type { CreateReviewAppealDto, ResolveReviewAppealDto, ReviewAppealListDto } from './dto/review-appeals.dto.js';
import { ReviewAppealsRepository, type AppealRow, type AppealScope } from './review-appeals.repository.js';

@Injectable()
export class ReviewAppealsService {
  constructor(private readonly repository: ReviewAppealsRepository, private readonly settings: SettingsService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  private scope(principal: Principal, audience: 'CUSTOMER' | 'INSURER' | 'ADMIN'): AppealScope {
    if (audience === 'CUSTOMER' && principal.kind === 'customer' && principal.emailVerified && holds(principal, 'review:manage')) return { customerId: principal.id };
    if (audience === 'INSURER' && principal.kind === 'staff' && principal.insurerId && holds(principal, 'portal:review:manage')) return { insurerId: principal.insurerId };
    if (audience === 'ADMIN' && principal.kind === 'staff' && holds(principal, 'admin:review:moderate')) return { admin: true };
    throw ApiException.forbidden();
  }

  async list(principal: Principal, audience: 'CUSTOMER' | 'INSURER' | 'ADMIN', query: ReviewAppealListDto = {}) {
    const rows = await this.repository.list(this.scope(principal, audience), query.page ?? 1, query.decisionId, query.reviewId);
    return rows.map(({ appeal, reviewId }) => audience === 'ADMIN' ? { ...this.response(appeal), reviewId } : this.response(appeal));
  }

  async create(dto: CreateReviewAppealDto, principal: Principal, party: 'CUSTOMER' | 'INSURER', now = new Date()) {
    const scope = this.scope(principal, party);
    this.validateText(dto.reason, 2000);
    if (dto.evidence !== undefined) this.validateText(dto.evidence, 10000, true);
    try {
      return await this.repository.transaction(async (tx) => {
        if ('customerId' in scope) await assertOpenCustomer(tx, scope.customerId);
        const initial = await this.repository.decision(tx, dto.decisionId, scope);
        if (!initial) throw ApiException.notFound('Review decision');
        await this.repository.lockReview(tx, initial.review.id);
        const current = await this.repository.decision(tx, dto.decisionId, scope);
        if (!current) throw ApiException.notFound('Review decision');
        if (current.review.withdrawnAt || current.revision.purgedAt) throw ApiException.conflict('REVIEW_UNAVAILABLE', 'This review is no longer available for appeal.');
        if (!appealAllowed(party, current.revision.kind, current.decision.action)) throw ApiException.conflict('DECISION_NOT_APPEALABLE', 'This party cannot appeal that decision.');
        const rule = await this.settings.effective('REVIEW_POLICY', now, tx);
        if (lusakaDay(now) > deadline(current.decision.createdAt, rule.value.appealDays)) throw ApiException.conflict('APPEAL_WINDOW_CLOSED', 'The appeal deadline has passed.');
        const appeal = await this.repository.create(tx, { decisionId: dto.decisionId, party, reason: dto.reason.trim(), evidence: dto.evidence?.trim() || null, createdAt: now, dueAt: deadline(now, rule.value.appealDecisionDays) });
        await this.audit.write(tx, { actor: auditActor(principal), action: 'review_appeal.created', entityType: 'REVIEW_APPEAL', entityId: appeal.id, after: { decisionId: dto.decisionId, party, dueAt: appeal.dueAt } });
        return this.response(appeal);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'review_appeals_party_decision_key')) throw ApiException.conflict('APPEAL_EXISTS', 'This party has already appealed that decision.');
      throw error;
    }
  }

  async resolve(id: string, dto: ResolveReviewAppealDto, principal: Principal, now = new Date()) {
    const scope = this.scope(principal, 'ADMIN');
    this.validateText(dto.reason, 2000);
    if (dto.outcome !== 'UPHELD' && dto.outcome !== 'OVERTURNED') throw new ApiException('APPEAL_OUTCOME_INVALID', 'Choose an appeal outcome.');
    return this.repository.transaction(async (tx) => {
      const initial = await this.repository.appeal(tx, id, scope);
      if (!initial) throw ApiException.notFound('Review appeal');
      const initialDecision = await this.repository.decision(tx, initial.decisionId, scope);
      if (!initialDecision) throw ApiException.notFound('Review decision');
      await this.repository.lockReview(tx, initialDecision.review.id);
      const appeal = await this.repository.appeal(tx, id, scope);
      const context = await this.repository.decision(tx, initial.decisionId, scope);
      if (!appeal || !context) throw ApiException.notFound('Review appeal');
      if (appeal.decidedAt) throw ApiException.conflict('APPEAL_CLOSED', 'This appeal has already been decided.');
      if (context.decision.moderatorId === principal.id) throw ApiException.forbidden('A different moderator must decide the appeal.');
      let applied = false;
      if (dto.outcome === 'OVERTURNED' && !context.review.withdrawnAt && !context.revision.purgedAt) {
        const latest = await this.repository.latestDecision(tx, context.revision.id);
        const expected = context.decision.action === 'REJECT' ? 'REJECTED' : context.decision.action === 'REMOVE' ? 'REMOVED' : 'PUBLISHED';
        if (latest?.id === context.decision.id && context.revision.status === expected) {
          const action = inverse(context.decision.action);
          const revisions = await this.repository.revisions(tx, context.review.id);
          // A restoration cannot replace a later submission or another published version.
          const superseded = revisions.some((row) => row.kind === context.revision.kind && row.id !== context.revision.id && (row.version > context.revision.version || row.status === 'PUBLISHED'));
          const parentPublished = context.revision.kind === 'REVIEW' || revisions.some((row) => row.kind === 'REVIEW' && row.status === 'PUBLISHED' && !row.purgedAt);
          if (action === 'REMOVE' || (!superseded && parentPublished)) {
            if (action === 'REINSTATE' && (await this.settings.effective('REVIEW_POLICY', now, tx)).provisional) throw ApiException.conflict('REVIEW_POLICY_PROVISIONAL', 'Confirm the review policy before restoring public content.');
            if (action === 'REINSTATE') assertReviewPublicText(context.revision.text, context.review.policyNumber);
            await this.repository.applyInverse(tx, context.revision.id, action, principal.id, now);
            applied = true;
          }
        }
      }
      const closed = await this.repository.close(tx, id, { outcome: dto.outcome, outcomeReason: dto.reason.trim(), decidedAt: now, decidedBy: principal.id });
      await this.audit.write(tx, { actor: auditActor(principal), action: 'review_appeal.decided', entityType: 'REVIEW_APPEAL', entityId: id, after: { decisionId: appeal.decisionId, outcome: dto.outcome, applied } });
      if (appeal.party === 'CUSTOMER') await this.notifications.notify(tx, { customerId: context.customerId, key: 'REVIEW_APPEAL_DECIDED', entity: { type: 'REVIEW', id: context.review.id } }, now);
      return { ...this.response(closed), applied };
    });
  }

  async legalHold(reviewId: string, held: boolean, principal: Principal, now = new Date()) {
    this.scope(principal, 'ADMIN');
    if (typeof held !== 'boolean') throw new ApiException('LEGAL_HOLD_INVALID', 'Specify whether the review is held.');
    return this.repository.transaction(async (tx) => {
      const review = await this.repository.lockReview(tx, reviewId);
      if (!review) throw ApiException.notFound('Review');
      await this.repository.setHold(tx, reviewId, held, now);
      await this.audit.write(tx, { actor: auditActor(principal), action: 'review.legal_hold_changed', entityType: 'REVIEW', entityId: reviewId, before: { held: Boolean(review.legalHoldAt) }, after: { held } });
      return { reviewId, held };
    });
  }

  private validateText(text: string, max: number, optional = false) {
    if (typeof text !== 'string' || text.length > max || (!optional && !text.trim())) throw new ApiException('APPEAL_TEXT_INVALID', 'Enter text within the allowed length.');
  }

  private response(row: AppealRow) {
    return { id: row.id, decisionId: row.decisionId, party: row.party, reason: row.reason, evidence: row.evidence, createdAt: row.createdAt.toISOString(), dueAt: row.dueAt, decidedAt: row.decidedAt?.toISOString() ?? null, outcome: row.outcome, outcomeReason: row.outcomeReason, purgedAt: row.purgedAt?.toISOString() ?? null };
  }
}
