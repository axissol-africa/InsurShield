import { Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { ApiException } from '../common/errors/api.exception.js';
import { assertOpenCustomer } from '../db/customer-lock.js';
import type { Transaction } from '../db/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { RuleValueFor } from '../settings/domain/rules.js';
import { nextReviewStatus, withinReviewWindow } from './domain/review.js';
import { assertReviewPublicText } from './publication.js';
import type { ReviewDecisionDto, SaveReviewDto } from './reviews.dto.js';
import { type Review, type ReviewDecision, type ReviewRevision, ReviewsRepository } from './reviews.repository.js';

const PAGE_SIZE = 20;
type ReviewPolicy = RuleValueFor<'REVIEW_POLICY'>;
type Policy = NonNullable<Awaited<ReturnType<ReviewsRepository['customerPolicy']>>>;

@Injectable()
export class ReviewsService {
  constructor(
    private readonly repository: ReviewsRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async customerState(number: string, principal: Principal) {
    const id = this.customerId(principal);
    const now = new Date();
    const [policy, rule] = await Promise.all([
      this.repository.customerPolicy(number, id), this.settings.effective('REVIEW_POLICY', now),
    ]);
    if (!policy) throw ApiException.notFound('Policy');
    return this.policyReview(policy, await this.repository.byPolicy(number), rule.value, now);
  }

  async save(number: string, dto: SaveReviewDto, principal: Principal, edit: boolean) {
    const id = this.customerId(principal);
    return this.repository.transaction(async (tx) => {
      await assertOpenCustomer(tx, id);
      const policy = await this.repository.customerPolicy(number, id, tx);
      if (!policy) throw ApiException.notFound('Policy');
      const now = new Date();
      const rule = await this.settings.effective('REVIEW_POLICY', now, tx);
      const existing = await this.repository.byPolicy(number, tx);
      const state = await this.policyReview(policy, existing, rule.value, now, tx);
      if (edit ? !state.canEdit : !state.canSubmit) {
        throw ApiException.conflict('REVIEW_UNAVAILABLE', edit
          ? 'This review can no longer be edited.'
          : 'This policy is outside the review period or already has a review.');
      }
      const review = existing ?? await this.repository.start(tx, number, now);
      const revision = await this.append(tx, review, 'REVIEW', dto.text?.trim() || null, dto.rating, now);
      await this.record(tx, principal, 'review.submitted', review.id, { revisionId: revision.id, version: revision.version });
      return this.policyReview(policy, review, rule.value, now, tx);
    });
  }

  async withdraw(number: string, principal: Principal) {
    const id = this.customerId(principal);
    return this.repository.transaction(async (tx) => {
      await assertOpenCustomer(tx, id);
      const policy = await this.repository.customerPolicy(number, id, tx);
      if (!policy) throw ApiException.notFound('Policy');
      const review = await this.repository.byPolicy(number, tx);
      if (!review) throw ApiException.notFound('Review');
      const now = new Date();
      const rule = await this.settings.effective('REVIEW_POLICY', now, tx);
      if (review.withdrawnAt) return this.policyReview(policy, review, rule.value, now, tx);
      await this.repository.withdraw(tx, review.id, now);
      await this.record(tx, principal, 'review.withdrawn', review.id, {});
      return this.policyReview(policy, { ...review, withdrawnAt: now }, rule.value, now, tx);
    });
  }

  async publicReviews(insurerId: string, page: number) {
    const rule = await this.settings.effective('REVIEW_POLICY');
    if (rule.provisional) return { items: [], hasMore: false, page };
    const rows = await this.repository.publishedForInsurer(insurerId, (page - 1) * PAGE_SIZE, PAGE_SIZE + 1, true);
    return {
      items: rows.slice(0, PAGE_SIZE).map(({ id, rating, text, publishedAt, response }) => ({
        id, rating, text, publishedAt: this.publicMonth(publishedAt),
        response: response ? { text: response.text, publishedAt: this.publicMonth(response.publishedAt) } : null,
      })),
      hasMore: rows.length > PAGE_SIZE, page,
    };
  }

  async insurerReviews(principal: Principal, page: number) {
    const insurerId = this.insurerId(principal);
    const rows = await this.repository.publishedForInsurer(insurerId, (page - 1) * PAGE_SIZE, PAGE_SIZE + 1, false);
    const visible = rows.slice(0, PAGE_SIZE);
    const replies = await this.repository.latestResponses(visible.map(({ id }) => id));
    const decisions = await this.repository.latestDecisions([
      ...visible.map(({ revisionId }) => revisionId), ...replies.map(({ id }) => id),
    ]);
    const replyByReview = new Map(replies.map((reply) => [reply.reviewId, reply]));
    const decisionByRevision = new Map(decisions.map((decision) => [decision.revisionId, decision]));
    return {
      items: visible.map(({ revisionId, id, ...item }) => {
        const reply = replyByReview.get(id);
        return {
          id, ...item,
          publicationDecisionId: decisionByRevision.get(revisionId)?.id ?? null,
          latestResponse: reply ? this.revisionDto(reply, decisionByRevision.get(reply.id)) : null,
        };
      }),
      hasMore: rows.length > PAGE_SIZE, page,
    };
  }

  async respond(reviewId: string, text: string, principal: Principal) {
    const insurerId = this.insurerId(principal);
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.locked(tx, reviewId, insurerId);
      if (!record || record.review.withdrawnAt || !(await this.repository.published(reviewId, 'REVIEW', tx))) {
        throw ApiException.notFound('Published review');
      }
      const now = new Date();
      const revision = await this.append(tx, record.review, 'RESPONSE', text, null, now);
      await this.record(tx, principal, 'review.response_submitted', reviewId, { revisionId: revision.id, version: revision.version });
      return this.revisionView(revision, tx);
    });
  }

  async moderationQueue(status: ReviewRevision['status'], page: number, principal: Principal) {
    this.moderator(principal);
    const [rows, rule] = await Promise.all([
      this.repository.moderationQueue(status, (page - 1) * PAGE_SIZE, PAGE_SIZE + 1),
      this.settings.effective('REVIEW_POLICY'),
    ]);
    return { items: rows.slice(0, PAGE_SIZE), page, hasMore: rows.length > PAGE_SIZE, publicationEnabled: !rule.provisional };
  }

  async decide(reviewId: string, dto: ReviewDecisionDto, principal: Principal) {
    const moderator = this.moderator(principal);
    if ((dto.action === 'PUBLISH' || dto.action === 'REINSTATE') !== (dto.reason === 'APPROVED')) {
      throw new ApiException('REVIEW_REASON_INVALID', 'Choose a reason that matches the decision.');
    }
    return this.repository.transaction(async (tx) => {
      const record = await this.repository.locked(tx, reviewId);
      if (!record || record.review.withdrawnAt) throw ApiException.notFound('Review');
      const revision = await this.repository.revision(tx, reviewId, dto.revisionId);
      if (!revision || revision.purgedAt) throw ApiException.notFound('Review version');
      const status = nextReviewStatus(revision.status, dto.action);
      if (!status) throw ApiException.conflict('REVIEW_VERSION_CHANGED', 'This version has already changed. Refresh the queue.');
      const now = new Date();
      if (status === 'PUBLISHED') await this.preparePublication(tx, revision, record.review.policyNumber, dto.action, now);
      await this.repository.changeStatus(tx, revision.id, status, now);
      const decision = await this.repository.recordDecision(tx, {
        revisionId: revision.id, action: dto.action, reason: dto.reason, moderatorId: moderator.id, createdAt: now,
      });
      await this.record(tx, moderator, 'review.moderated', reviewId, {
        revisionId: revision.id, decisionId: decision.id, kind: revision.kind, status, reason: dto.reason,
      });
      if (revision.kind === 'REVIEW') {
        await this.notifications.notify(tx, {
          customerId: record.customerId, key: 'REVIEW_MODERATED', entity: { type: 'REVIEW', id: reviewId },
        }, now);
      }
      return { id: decision.id, status };
    });
  }

  private async preparePublication(
    tx: Transaction, revision: ReviewRevision, policyNumber: string, action: ReviewDecisionDto['action'], now: Date,
  ) {
    if ((await this.settings.effective('REVIEW_POLICY', now, tx)).provisional) {
      throw ApiException.conflict('REVIEW_POLICY_PROVISIONAL', 'Confirm the review policy before publishing.');
    }
    if (revision.kind === 'RESPONSE' && !(await this.repository.published(revision.reviewId, 'REVIEW', tx))) {
      throw ApiException.conflict('REVIEW_UNAVAILABLE', 'Publish the customer review before publishing its reply.');
    }
    assertReviewPublicText(revision.text, policyNumber);
    const existing = await this.repository.published(revision.reviewId, revision.kind, tx);
    if (existing && action === 'REINSTATE') {
      throw ApiException.conflict('REVIEW_VERSION_CHANGED', 'A newer version is already published.');
    }
    if (existing) await this.repository.changeStatus(tx, existing.id, 'SUPERSEDED', now);
  }

  private async append(
    tx: Transaction, review: Review, kind: ReviewRevision['kind'], text: string | null, rating: number | null, now: Date,
  ) {
    const latest = await this.repository.latest(review.id, kind, tx);
    if (latest?.status === 'PENDING') await this.repository.changeStatus(tx, latest.id, 'SUPERSEDED', now);
    return this.repository.append(tx, {
      reviewId: review.id, kind, version: (latest?.version ?? 0) + 1, status: 'PENDING', text, rating, createdAt: now,
    });
  }

  private async policyReview(
    policy: Policy, review: Review | undefined, rule: ReviewPolicy, now: Date, tx?: Transaction,
  ) {
    if (!review) {
      return {
        canSubmit: (policy.status === 'ACTIVE' || policy.status === 'CANCELLED') && policy.issuedAt !== null &&
          withinReviewWindow(policy.issuedAt, now, rule.submissionDays),
        canEdit: false, canWithdraw: false, review: null,
      };
    }
    const latest = await this.repository.latest(review.id, 'REVIEW', tx);
    const published = await this.repository.published(review.id, 'REVIEW', tx);
    return {
      canSubmit: false, canEdit: !review.withdrawnAt && withinReviewWindow(review.createdAt, now, rule.editDays),
      canWithdraw: !review.withdrawnAt,
      review: {
        id: review.id, status: review.withdrawnAt ? 'WITHDRAWN' : latest?.status ?? 'PENDING',
        pending: latest?.id !== published?.id ? await this.revisionView(latest, tx) : null,
        published: await this.revisionView(published, tx), withdrawnAt: review.withdrawnAt,
      },
    };
  }

  private async revisionView(revision: ReviewRevision | undefined, tx?: Transaction) {
    if (!revision) return null;
    return this.revisionDto(revision, await this.repository.latestDecision(revision.id, tx));
  }

  private revisionDto(revision: ReviewRevision, decision?: ReviewDecision) {
    return {
      id: revision.id, rating: revision.rating, text: revision.text, status: revision.status,
      decisionId: decision?.id ?? null, reason: decision?.reason ?? null, decidedAt: decision?.createdAt ?? null,
    };
  }

  private publicMonth(timestamp: Date | null) {
    return timestamp ? lusakaDay(timestamp).slice(0, 7) : null;
  }

  private record(tx: Transaction, principal: Principal, action: string, id: string, fields: Record<string, unknown>) {
    return this.audit.write(tx, { actor: auditActor(principal), action, entityType: 'REVIEW', entityId: id, after: fields });
  }

  private customerId(principal: Principal) {
    if (principal.kind !== 'customer' || !principal.emailVerified || !holds(principal, 'review:manage')) {
      throw ApiException.forbidden();
    }
    return principal.id;
  }

  private insurerId(principal: Principal) {
    if (principal.kind !== 'staff' || !principal.insurerId || !holds(principal, 'portal:review:manage')) {
      throw ApiException.forbidden();
    }
    return principal.insurerId;
  }

  private moderator(principal: Principal) {
    if (principal.kind !== 'staff' || !holds(principal, 'admin:review:moderate')) throw ApiException.forbidden();
    return principal;
  }
}
