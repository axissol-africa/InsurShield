import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerReviews, policies, reviewAppeals, reviewDecisions, reviewRevisions } from '../db/schema.js';

export type AppealScope = { customerId: string } | { insurerId: string } | { admin: true };
export type AppealRow = typeof reviewAppeals.$inferSelect;
const APPEALS_PER_PAGE = 20;

@Injectable()
export class ReviewAppealsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  transaction<T>(work: (tx: Transaction) => Promise<T>) { return this.db.transaction(work); }

  private filter(scope: AppealScope) {
    return 'customerId' in scope ? eq(policies.customerId, scope.customerId) : 'insurerId' in scope ? eq(policies.insurerId, scope.insurerId) : undefined;
  }

  async decision(tx: Transaction, id: string, scope: AppealScope) {
    const [row] = await tx.select({ decision: reviewDecisions, revision: reviewRevisions, review: insurerReviews, customerId: policies.customerId })
      .from(reviewDecisions)
      .innerJoin(reviewRevisions, eq(reviewRevisions.id, reviewDecisions.revisionId))
      .innerJoin(insurerReviews, eq(insurerReviews.id, reviewRevisions.reviewId))
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .where(and(eq(reviewDecisions.id, id), this.filter(scope)));
    return row ?? null;
  }

  async lockReview(tx: Transaction, id: string) {
    const [row] = await tx.select().from(insurerReviews).where(eq(insurerReviews.id, id)).for('update');
    return row ?? null;
  }

  async appeal(tx: Transaction, id: string, scope: AppealScope) {
    const [row] = await tx.select({ appeal: reviewAppeals })
      .from(reviewAppeals)
      .innerJoin(reviewDecisions, eq(reviewDecisions.id, reviewAppeals.decisionId))
      .innerJoin(reviewRevisions, eq(reviewRevisions.id, reviewDecisions.revisionId))
      .innerJoin(insurerReviews, eq(insurerReviews.id, reviewRevisions.reviewId))
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .where(and(eq(reviewAppeals.id, id), this.filter(scope), 'admin' in scope ? undefined : eq(reviewAppeals.party, 'customerId' in scope ? 'CUSTOMER' : 'INSURER')));
    return row?.appeal ?? null;
  }

  async list(scope: AppealScope, page: number, decisionId?: string, reviewId?: string) {
    return this.db.select({ appeal: reviewAppeals, reviewId: insurerReviews.id }).from(reviewAppeals)
      .innerJoin(reviewDecisions, eq(reviewDecisions.id, reviewAppeals.decisionId))
      .innerJoin(reviewRevisions, eq(reviewRevisions.id, reviewDecisions.revisionId))
      .innerJoin(insurerReviews, eq(insurerReviews.id, reviewRevisions.reviewId))
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .where(and(this.filter(scope),
        'admin' in scope ? undefined : eq(reviewAppeals.party, 'customerId' in scope ? 'CUSTOMER' : 'INSURER'),
        decisionId ? eq(reviewAppeals.decisionId, decisionId) : undefined,
        reviewId ? eq(insurerReviews.id, reviewId) : undefined))
      .orderBy(sql`${reviewAppeals.decidedAt} IS NOT NULL`, desc(reviewAppeals.createdAt), desc(reviewAppeals.id))
      .limit(APPEALS_PER_PAGE).offset((page - 1) * APPEALS_PER_PAGE);
  }

  async create(tx: Transaction, values: typeof reviewAppeals.$inferInsert) {
    const [row] = await tx.insert(reviewAppeals).values(values).returning();
    if (!row) throw new Error('Appeal insert returned no row');
    return row;
  }

  async close(tx: Transaction, id: string, values: Pick<AppealRow, 'outcome' | 'outcomeReason' | 'decidedAt' | 'decidedBy'>) {
    const [row] = await tx.update(reviewAppeals).set(values).where(eq(reviewAppeals.id, id)).returning();
    if (!row) throw new Error('Appeal update returned no row');
    return row;
  }

  async revisions(tx: Transaction, reviewId: string) {
    return tx.select().from(reviewRevisions).where(eq(reviewRevisions.reviewId, reviewId));
  }

  async latestDecision(tx: Transaction, revisionId: string) {
    const [row] = await tx.select().from(reviewDecisions).where(eq(reviewDecisions.revisionId, revisionId)).orderBy(desc(reviewDecisions.createdAt), desc(reviewDecisions.id)).limit(1);
    return row;
  }

  async applyInverse(tx: Transaction, revisionId: string, action: 'REMOVE' | 'REINSTATE', moderatorId: string, now: Date) {
    await tx.update(reviewRevisions).set(action === 'REMOVE' ? { status: 'REMOVED', retiredAt: now } : { status: 'PUBLISHED', publishedAt: now, retiredAt: null }).where(eq(reviewRevisions.id, revisionId));
    await tx.insert(reviewDecisions).values({ revisionId, action, moderatorId, createdAt: now, reason: 'Appeal overturned the prior decision.' });
  }

  async setHold(tx: Transaction, id: string, held: boolean, now: Date) {
    await tx.update(insurerReviews).set({ legalHoldAt: held ? now : null }).where(eq(insurerReviews.id, id));
  }
}
