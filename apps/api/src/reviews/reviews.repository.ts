import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerReviews, insurers, policies, reviewDecisions, reviewRevisions } from '../db/schema.js';

export type Review = typeof insurerReviews.$inferSelect;
export type ReviewRevision = typeof reviewRevisions.$inferSelect;
export type ReviewDecision = typeof reviewDecisions.$inferSelect;
const response = alias(reviewRevisions, 'published_review_response');

@Injectable()
export class ReviewsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>) {
    return this.db.transaction(work);
  }

  async customerPolicy(number: string, customerId: string, tx?: Transaction) {
    const query = (tx ?? this.db)
      .select({ number: policies.policyNumber, issuedAt: policies.issuedAt, status: policies.status })
      .from(policies)
      .where(and(eq(policies.policyNumber, number), eq(policies.customerId, customerId)));
    const [policy] = await (tx ? query.for('update') : query);
    return policy;
  }

  async byPolicy(number: string, tx?: Transaction) {
    const query = (tx ?? this.db).select().from(insurerReviews).where(eq(insurerReviews.policyNumber, number));
    const [review] = await (tx ? query.for('update') : query);
    return review;
  }

  async locked(tx: Transaction, reviewId: string, insurerId?: string) {
    const [result] = await tx.select({
      review: insurerReviews, insurerId: policies.insurerId, customerId: policies.customerId,
    }).from(insurerReviews)
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .where(and(eq(insurerReviews.id, reviewId), insurerId ? eq(policies.insurerId, insurerId) : undefined))
      .for('update', { of: insurerReviews });
    return result;
  }

  async start(tx: Transaction, policyNumber: string, now: Date) {
    const [review] = await tx.insert(insurerReviews).values({ policyNumber, createdAt: now }).returning();
    return review;
  }

  async withdraw(tx: Transaction, reviewId: string, now: Date) {
    await tx.update(insurerReviews).set({ withdrawnAt: now }).where(eq(insurerReviews.id, reviewId));
    await tx.update(reviewRevisions).set({ status: 'REMOVED', retiredAt: now })
      .where(and(eq(reviewRevisions.reviewId, reviewId), inArray(reviewRevisions.status, ['PENDING', 'PUBLISHED'])));
  }

  async latest(reviewId: string, kind: ReviewRevision['kind'], database: Database | Transaction = this.db) {
    const [revision] = await database.select().from(reviewRevisions)
      .where(and(eq(reviewRevisions.reviewId, reviewId), eq(reviewRevisions.kind, kind)))
      .orderBy(desc(reviewRevisions.version)).limit(1);
    return revision;
  }

  async published(reviewId: string, kind: ReviewRevision['kind'], database: Database | Transaction = this.db) {
    const [revision] = await database.select().from(reviewRevisions)
      .where(and(eq(reviewRevisions.reviewId, reviewId), eq(reviewRevisions.kind, kind), eq(reviewRevisions.status, 'PUBLISHED')));
    return revision;
  }

  async revision(tx: Transaction, reviewId: string, id: string) {
    const [revision] = await tx.select().from(reviewRevisions)
      .where(and(eq(reviewRevisions.reviewId, reviewId), eq(reviewRevisions.id, id)));
    return revision;
  }

  async append(tx: Transaction, values: typeof reviewRevisions.$inferInsert) {
    const [revision] = await tx.insert(reviewRevisions).values(values).returning();
    return revision;
  }

  async changeStatus(tx: Transaction, id: string, status: ReviewRevision['status'], now: Date) {
    await tx.update(reviewRevisions).set({
      status,
      ...(status === 'PUBLISHED' ? { publishedAt: now, retiredAt: null } : { retiredAt: now }),
    }).where(eq(reviewRevisions.id, id));
  }

  async latestDecision(id: string, database: Database | Transaction = this.db) {
    const [decision] = await database.select().from(reviewDecisions).where(eq(reviewDecisions.revisionId, id))
      .orderBy(desc(reviewDecisions.createdAt), desc(reviewDecisions.id)).limit(1);
    return decision;
  }

  latestDecisions(ids: string[]) {
    return this.db.selectDistinctOn([reviewDecisions.revisionId]).from(reviewDecisions)
      .where(inArray(reviewDecisions.revisionId, ids))
      .orderBy(reviewDecisions.revisionId, desc(reviewDecisions.createdAt), desc(reviewDecisions.id));
  }

  latestResponses(ids: string[]) {
    return this.db.selectDistinctOn([reviewRevisions.reviewId]).from(reviewRevisions)
      .where(and(inArray(reviewRevisions.reviewId, ids), eq(reviewRevisions.kind, 'RESPONSE')))
      .orderBy(reviewRevisions.reviewId, desc(reviewRevisions.version));
  }

  async recordDecision(tx: Transaction, values: typeof reviewDecisions.$inferInsert) {
    const [decision] = await tx.insert(reviewDecisions).values(values).returning();
    return decision;
  }

  async moderationQueue(status: ReviewRevision['status'], offset: number, limit: number) {
    return this.db.select({
      id: reviewRevisions.id, reviewId: reviewRevisions.reviewId, kind: reviewRevisions.kind,
      rating: reviewRevisions.rating, text: reviewRevisions.text, status: reviewRevisions.status,
      createdAt: reviewRevisions.createdAt, insurerName: insurers.name,
    }).from(reviewRevisions)
      .innerJoin(insurerReviews, eq(insurerReviews.id, reviewRevisions.reviewId))
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .where(and(eq(reviewRevisions.status, status), isNull(insurerReviews.withdrawnAt), isNull(reviewRevisions.purgedAt)))
      .orderBy(desc(reviewRevisions.createdAt), desc(reviewRevisions.id)).limit(limit).offset(offset);
  }

  async publishedForInsurer(insurerId: string, offset: number, limit: number, publicView: boolean, tx?: Transaction) {
    return (tx ?? this.db).select({
      id: insurerReviews.id, rating: reviewRevisions.rating, text: reviewRevisions.text,
      revisionId: reviewRevisions.id, publishedAt: reviewRevisions.publishedAt,
      response: { text: response.text, publishedAt: response.publishedAt },
    }).from(insurerReviews)
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .innerJoin(reviewRevisions, and(eq(reviewRevisions.reviewId, insurerReviews.id),
        eq(reviewRevisions.kind, 'REVIEW'), eq(reviewRevisions.status, 'PUBLISHED')))
      .leftJoin(response, and(eq(response.reviewId, insurerReviews.id), eq(response.kind, 'RESPONSE'), eq(response.status, 'PUBLISHED')))
      .where(and(eq(policies.insurerId, insurerId), isNull(insurerReviews.withdrawnAt),
        publicView ? isNull(insurers.deletedAt) : undefined))
      .orderBy(desc(reviewRevisions.publishedAt), desc(insurerReviews.id)).limit(limit).offset(offset);
  }
}
