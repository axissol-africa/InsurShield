import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurers, ncdApplications, ncdCodes, ncdEvidence, policies, vehicles } from '../db/schema.js';
import { takesNewBusinessWhere } from '../common/insurer-standing.js';
import { findBoundNcdCode } from './ncd-code-ownership.js';

export type NcdApplicationRow = typeof ncdApplications.$inferSelect;
export type NewNcdApplication = typeof ncdApplications.$inferInsert;

@Injectable()
export class NcdRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  findBoundCode(code: string, customerId: string) {
    return findBoundNcdCode(this.db, code, customerId);
  }

  private applicationDetails(db: Database | Transaction) {
    return db.select({
      application: ncdApplications,
      insurerName: insurers.name,
      codePercentage: ncdCodes.percentage,
      expiresAt: ncdCodes.expiresAt,
      redeemedAt: ncdCodes.redeemedAt,
      revokedAt: ncdCodes.revokedAt,
      vehicle: { plateNumber: vehicles.plateNumber, make: vehicles.make, model: vehicles.model },
    }).from(ncdApplications)
      .innerJoin(insurers, eq(insurers.id, ncdApplications.insurerId))
      .leftJoin(ncdCodes, eq(ncdCodes.code, ncdApplications.approvedCodeId))
      .leftJoin(vehicles, eq(vehicles.id, ncdApplications.sourceVehicleId));
  }

  listForCustomer(customerId: string) {
    return this.applicationDetails(this.db).where(eq(ncdApplications.customerId, customerId))
      .orderBy(desc(ncdApplications.submittedAt), asc(ncdApplications.id));
  }

  listForInsurer(insurerId: string) {
    return this.applicationDetails(this.db).where(eq(ncdApplications.insurerId, insurerId))
      .orderBy(desc(ncdApplications.submittedAt), asc(ncdApplications.id));
  }

  async detailsForCustomer(customerId: string, id: string) {
    const [row] = await this.applicationDetails(this.db)
      .where(and(eq(ncdApplications.customerId, customerId), eq(ncdApplications.id, id)));
    return row;
  }

  async evidenceOf(ids: string[], db: Database | Transaction = this.db) {
    if (ids.length === 0) return [];
    return db.select({ id: ncdEvidence.applicationId, documentId: ncdEvidence.documentId })
      .from(ncdEvidence).where(inArray(ncdEvidence.applicationId, ids))
      .orderBy(asc(ncdEvidence.verificationRevision), asc(ncdEvidence.createdAt), asc(ncdEvidence.documentId));
  }

  async lockSourcePolicy(tx: Transaction, customerId: string, policyNumber: string) {
    const [source] = await tx.select({
      policyNumber: policies.policyNumber, insurerId: policies.insurerId,
      vehicleId: policies.vehicleId, chassisNumber: vehicles.chassisNumber,
      vehicle: { plateNumber: vehicles.plateNumber, make: vehicles.make, model: vehicles.model },
    }).from(policies).innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.customerId, customerId),
        isNotNull(policies.issuedAt), inArray(policies.status, ['ACTIVE', 'CANCELLED'])))
      .for('no key update', { of: policies });
    return source;
  }

  /** This read follows the source policy lock, serialising repeat applications for that policy. */
  async hasLiveApplication(tx: Transaction, policyNumber: string, now: Date): Promise<boolean> {
    const [prior] = await tx.select({ id: ncdApplications.id }).from(ncdApplications)
      .leftJoin(ncdCodes, eq(ncdCodes.code, ncdApplications.approvedCodeId))
      .where(and(eq(ncdApplications.sourcePolicyNumber, policyNumber), or(
        inArray(ncdApplications.status, ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED']),
        and(eq(ncdApplications.status, 'APPROVED'), isNull(ncdCodes.redeemedAt), isNull(ncdCodes.revokedAt), gt(ncdCodes.expiresAt, now)),
      ))).limit(1);
    return !!prior;
  }

  async findInsurerTakingNewBusiness(tx: Transaction, insurerId: string, now: Date) {
    const [insurer] = await tx.select({ id: insurers.id, name: insurers.name }).from(insurers)
      .where(and(eq(insurers.id, insurerId), ...takesNewBusinessWhere(now))).for('share');
    return insurer;
  }

  async insertApplication(tx: Transaction, application: NewNcdApplication): Promise<NcdApplicationRow> {
    const [created] = await tx.insert(ncdApplications).values(application).returning();
    return created;
  }

  async lockApplication(tx: Transaction, customerId: string, id: string) {
    const [row] = await tx.select({ application: ncdApplications, insurerName: insurers.name }).from(ncdApplications)
      .innerJoin(insurers, eq(insurers.id, ncdApplications.insurerId))
      .where(and(eq(ncdApplications.customerId, customerId), eq(ncdApplications.id, id)))
      .for('update', { of: ncdApplications });
    return row;
  }

  async fileEvidence(tx: Transaction, application: NcdApplicationRow, documentIds: string[]) {
    await tx.insert(ncdEvidence).values(documentIds.map((documentId) => ({
      applicationId: application.id, documentId, verificationRevision: application.verificationRevision,
    })));
    await tx.update(ncdApplications).set({ status: 'UNDER_REVIEW' }).where(eq(ncdApplications.id, application.id));
  }
}
