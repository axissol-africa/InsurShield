import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerReviews, insurers, policies, reviewRevisions } from '../db/schema.js';
import { mayDisplayCertificateBadge } from './reputation-standing.js';

@Injectable()
export class ReputationRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  snapshot<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  visibleInsurers(tx: Transaction, insurerIds: readonly string[], asOf: Date) {
    return tx.select({
      insurerId: insurers.id, badgeEligible: sql<boolean>`${mayDisplayCertificateBadge(tx, asOf)}`,
    }).from(insurers)
      .where(and(inArray(insurers.id, insurerIds), ne(insurers.status, 'DELETED'), isNull(insurers.deletedAt)));
  }

  publishedRatings(tx: Transaction, insurerIds: readonly string[], start: Date, end: Date) {
    return tx.select({
      insurerId: policies.insurerId,
      reviewCount: count(),
      totalStars: sql<number>`SUM(${reviewRevisions.rating})`.mapWith(Number),
    }).from(insurerReviews)
      .innerJoin(policies, eq(policies.policyNumber, insurerReviews.policyNumber))
      .innerJoin(reviewRevisions, eq(reviewRevisions.reviewId, insurerReviews.id))
      .where(and(
        inArray(policies.insurerId, insurerIds),
        isNotNull(policies.issuedAt),
        isNull(insurerReviews.withdrawnAt),
        eq(reviewRevisions.kind, 'REVIEW'),
        eq(reviewRevisions.status, 'PUBLISHED'),
        isNotNull(reviewRevisions.rating),
        isNull(reviewRevisions.purgedAt),
        gte(insurerReviews.createdAt, start),
        lte(insurerReviews.createdAt, end),
      ))
      .groupBy(policies.insurerId);
  }
}
