import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { certificateBadgeSnapshots as snapshots, certificateBadgeStates as states, insurers, payments, policies } from '../db/schema.js';

import { mayDisplayCertificateBadge } from '../reputation/reputation-standing.js';

export type BadgeSnapshot = typeof snapshots.$inferSelect;
export type BadgeState = typeof states.$inferSelect;

@Injectable()
export class CertificateBadgesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> { return this.db.transaction(work); }

  async insurerIds() { return this.db.select({ id: insurers.id }).from(insurers); }

  async lockState(tx: Transaction, insurerId: string) {
    const [insurer] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, insurerId)).for('update');
    if (!insurer) return null;
    await tx.insert(states).values({ insurerId }).onConflictDoNothing();
    const [state] = await tx.select().from(states).where(eq(states.insurerId, insurerId)).for('update');
    return state ?? null;
  }

  async latest(insurerId: string, tx: Database | Transaction = this.db) {
    const [snapshot] = await tx.select().from(snapshots).where(eq(snapshots.insurerId, insurerId))
      .orderBy(desc(snapshots.calculatedAt), desc(snapshots.ruleVersion), desc(snapshots.generation)).limit(1);
    return snapshot ?? null;
  }

  async adminState(tx: Transaction, insurerId: string): Promise<BadgeState | null> {
    const [insurer] = await tx.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, insurerId)).for('share');
    if (!insurer) return null;
    const [state] = await tx.select().from(states).where(eq(states.insurerId, insurerId));
    return state ?? { insurerId, suspendedAt: null, suspensionReason: null, generation: 0, updatedAt: new Date(0) };
  }

  async suspend(tx: Transaction, state: BadgeState, suspended: boolean, reason: string, now: Date) {
    const [updated] = await tx.update(states).set({
      suspendedAt: suspended ? now : null, suspensionReason: suspended ? reason : null,
      generation: state.generation + 1, updatedAt: now,
    }).where(eq(states.insurerId, state.insurerId)).returning();
    if (!updated) throw new Error('Badge state disappeared while locked');
    return updated;
  }

  async counts(tx: Transaction, insurerId: string, start: Date, end: Date) {
    const [counts] = await tx.select({
      sampleCount: sql<number>`count(*)::integer`,
      onTimeCount: sql<number>`count(*) FILTER (WHERE ${policies.issuedAt} >= ${payments.confirmedAt} AND ${policies.issuedAt} <= ${policies.issuanceDueAt})::integer`,
    }).from(policies).innerJoin(payments, eq(payments.id, policies.paymentId)).where(and(
      eq(policies.insurerId, insurerId), gte(policies.issuanceDueAt, start), lte(policies.issuanceDueAt, end),
      lte(payments.confirmedAt, end),
    ));
    return counts ?? { sampleCount: 0, onTimeCount: 0 };
  }

  async eligible(tx: Transaction, insurerId: string, now: Date) {
    const [row] = await tx.select({ id: insurers.id }).from(insurers)
      .where(and(eq(insurers.id, insurerId), mayDisplayCertificateBadge(tx, now)));
    return Boolean(row);
  }

  async insert(tx: Transaction, value: typeof snapshots.$inferInsert) {
    const [inserted] = await tx.insert(snapshots).values(value).onConflictDoNothing().returning();
    return inserted ?? null;
  }

  async publicCandidates(ids: string[], now: Date, tx: Database | Transaction = this.db) {
    if (!ids.length) return [];
    // Pick the latest calculation BEFORE eligibility filters; a miss must hide an older award.
    const latest = tx.selectDistinctOn([snapshots.insurerId]).from(snapshots)
      .where(inArray(snapshots.insurerId, ids))
      .orderBy(snapshots.insurerId, desc(snapshots.calculatedAt), desc(snapshots.ruleVersion), desc(snapshots.generation)).as('latest_badge');
    return tx.select({ snapshot: snapshots, state: states }).from(latest)
      .innerJoin(snapshots, eq(snapshots.id, latest.id))
      .innerJoin(states, eq(states.insurerId, latest.insurerId)).innerJoin(insurers, eq(insurers.id, latest.insurerId)).where(mayDisplayCertificateBadge(tx, now));
  }
}
