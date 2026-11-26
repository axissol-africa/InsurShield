import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt, ne } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerEvidence, insurerProfileDecisions, insurerProfileRevisions, insurerProducts, insurerProductVersions, insurers } from '../db/schema.js';
import { customerAvailableProductConditions } from '../products/customer-availability.js';
import type { ProfileContent } from './dto/insurer-profiles.contract.js';
import type { ProfileRevisionStatus } from './domain/insurer-profiles.js';

type Executor = Database | Transaction;
export type ProfileRevision = typeof insurerProfileRevisions.$inferSelect;

@Injectable()
export class InsurerProfilesRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>) { return this.db.transaction(work); }
  snapshot<T>(work: (tx: Transaction) => Promise<T>) {
    return this.db.transaction(work, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  }

  async insurer(insurerId: string, tx: Transaction, lock = false) {
    const query = tx.select().from(insurers).where(and(eq(insurers.id, insurerId), ne(insurers.status, 'DELETED'), isNull(insurers.deletedAt)));
    const rows = lock ? await query.for('update') : await query;
    return rows[0];
  }

  async latest(insurerId: string, tx: Transaction) {
    const [row] = await tx.select().from(insurerProfileRevisions).where(eq(insurerProfileRevisions.insurerId, insurerId))
      .orderBy(desc(insurerProfileRevisions.versionNumber)).limit(1);
    return row;
  }

  async revision(insurerId: string, revisionId: string, tx: Transaction) {
    const [row] = await tx.select().from(insurerProfileRevisions).where(and(eq(insurerProfileRevisions.insurerId, insurerId), eq(insurerProfileRevisions.id, revisionId)));
    return row;
  }

  async approved(insurerId: string, tx: Transaction) {
    const [row] = await tx.select().from(insurerProfileRevisions).where(and(eq(insurerProfileRevisions.insurerId, insurerId), eq(insurerProfileRevisions.status, 'APPROVED')));
    return row;
  }

  async submit(tx: Transaction, insurerId: string, versionNumber: number, staffId: string, content: ProfileContent) {
    const [row] = await tx.insert(insurerProfileRevisions).values({ ...content, insurerId, versionNumber, submittedByStaffId: staffId }).returning();
    if (!row) throw new Error('Profile revision insert returned no row');
    return row;
  }

  async transition(tx: Transaction, revisionId: string, from: ProfileRevisionStatus, to: ProfileRevisionStatus) {
    const [row] = await tx.update(insurerProfileRevisions).set({ status: to })
      .where(and(eq(insurerProfileRevisions.id, revisionId), eq(insurerProfileRevisions.status, from))).returning();
    return row;
  }

  async decide(tx: Transaction, revisionId: string, decision: 'APPROVE' | 'REJECT', reason: string, staffId: string) {
    const [row] = await tx.insert(insurerProfileDecisions).values({ revisionId, decision, reason, decidedByStaffId: staffId }).returning();
    if (!row) throw new Error('Profile decision insert returned no row');
    return row;
  }

  history(insurerId: string, beforeVersion: number | undefined, limit: number, tx: Transaction) {
    return tx.select({ revision: insurerProfileRevisions, decision: insurerProfileDecisions }).from(insurerProfileRevisions)
      .leftJoin(insurerProfileDecisions, eq(insurerProfileDecisions.revisionId, insurerProfileRevisions.id))
      .where(and(eq(insurerProfileRevisions.insurerId, insurerId), beforeVersion === undefined ? undefined : lt(insurerProfileRevisions.versionNumber, beforeVersion)))
      .orderBy(desc(insurerProfileRevisions.versionNumber)).limit(limit);
  }

  licenceEvidence(insurerId: string, tx: Executor) {
    return tx.select({ state: insurerEvidence.state, expiresAt: insurerEvidence.expiresAt }).from(insurerEvidence)
      .where(and(eq(insurerEvidence.insurerId, insurerId), eq(insurerEvidence.kind, 'LICENCE')));
  }

  products(insurerId: string, now: Date, tx: Transaction) {
    return tx.select({ productId: insurerProducts.id, versionId: insurerProductVersions.id, name: insurerProductVersions.name, coverType: insurerProductVersions.coverType })
      .from(insurerProducts).innerJoin(insurerProductVersions, eq(insurerProductVersions.productId, insurerProducts.id))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(eq(insurerProducts.insurerId, insurerId), ...customerAvailableProductConditions(tx, now)))
      .orderBy(insurerProducts.id, desc(insurerProductVersions.versionNumber)).limit(101);
  }
}
