import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { claimNotifications, documents, inspectionPhotos, inspectionReports, inspectionShots, inspections,
  insurerProductVersions, insurers, policies, quoteRequestProductVersions, vehicles } from '../db/schema.js';
import { servicesExistingBusinessWhere } from '../common/insurer-standing.js';
import { CLOSED_INSPECTION_STATUSES } from './domain/underwriting.js';
import type { NewInspection } from './inspections.repository.js';

@Injectable()
export class LaterInspectionsRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>) {
    return this.database.transaction(work);
  }

  async servicingInsurer(tx: Transaction, insurerId: string) {
    const [insurer] = await tx.select({ id: insurers.id }).from(insurers)
      .where(and(eq(insurers.id, insurerId), ...servicesExistingBusinessWhere())).for('share');
    return insurer;
  }

  async findPaidRoot(tx: Transaction, policyNumber: string) {
    const [root] = await tx.select({ id: inspections.id }).from(inspections).where(and(
      eq(inspections.policyNumber, policyNumber), isNull(inspections.claimNumber), isNull(inspections.predecessorId),
    ));
    return root;
  }

  purchase(tx: Transaction, policyNumber: string) {
    return tx.select({ policy: policies, vehicle: vehicles, selected: quoteRequestProductVersions })
      .from(policies)
      .innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
      .innerJoin(quoteRequestProductVersions, and(
        eq(quoteRequestProductVersions.quoteRequestId, policies.quoteRequestId),
        eq(quoteRequestProductVersions.productVersionId, policies.productVersionId),
        eq(quoteRequestProductVersions.insurerId, policies.insurerId),
      ))
      .where(eq(policies.policyNumber, policyNumber)).then(([purchase]) => purchase);
  }

  async claim(tx: Transaction, claimNumber: string, insurerId: string, lock = false) {
    const query = tx.select({ claim: claimNotifications, policy: policies, vehicle: vehicles })
      .from(claimNotifications)
      .innerJoin(policies, and(eq(policies.policyNumber, claimNotifications.policyNumber),
        eq(policies.insurerId, claimNotifications.insurerId), eq(policies.customerId, claimNotifications.customerId)))
      .innerJoin(vehicles, eq(vehicles.id, policies.vehicleId))
      .where(and(eq(claimNotifications.claimNumber, claimNumber), eq(claimNotifications.insurerId, insurerId)));
    const [found] = lock ? await query.for('update', { of: claimNotifications }) : await query;
    return found;
  }

  async findOpenForClaim(tx: Transaction, claimNumber: string) {
    const [inspection] = await tx.select().from(inspections)
      .where(and(eq(inspections.claimNumber, claimNumber), notInArray(inspections.status, [...CLOSED_INSPECTION_STATUSES])))
      .limit(1);
    return inspection;
  }

  async hasClaimInspection(tx: Transaction, claimNumber: string) {
    const [inspection] = await tx.select({ id: inspections.id }).from(inspections)
      .where(eq(inspections.claimNumber, claimNumber)).limit(1);
    return Boolean(inspection);
  }

  async insert(tx: Transaction, input: NewInspection) {
    const [inspection] = await tx.insert(inspections).values(input).onConflictDoNothing().returning();
    return inspection;
  }

  async find(tx: Transaction, id: string, owner: { insurerId: string } | { customerId: string }, lock = false) {
    const scope = 'insurerId' in owner ? eq(inspections.insurerId, owner.insurerId) : eq(inspections.customerId, owner.customerId);
    const query = tx.select().from(inspections).where(and(eq(inspections.id, id), scope, inArray(inspections.purpose, ['AFTER_PAYMENT', 'CLAIM_ASSESSMENT'])));
    const [row] = lock ? await query.for('update') : await query;
    return row;
  }

  async successor(tx: Transaction, id: string) {
    const [row] = await tx.select().from(inspections).where(eq(inspections.predecessorId, id)).limit(1);
    return row;
  }

  async allowsReinspection(tx: Transaction, policyNumber: string) {
    const [product] = await tx.select({ allowed: insurerProductVersions.reinspectionAllowed }).from(policies)
      .innerJoin(insurerProductVersions, eq(insurerProductVersions.id, policies.productVersionId))
      .where(eq(policies.policyNumber, policyNumber));
    return Boolean(product?.allowed);
  }

  photos(tx: Transaction, id: string) {
    return tx.select({ slot: inspectionPhotos.slot, documentId: inspectionPhotos.documentId, reference: inspectionPhotos.inspectionId })
      .from(inspectionPhotos).where(eq(inspectionPhotos.inspectionId, id)).orderBy(asc(inspectionPhotos.slot));
  }

  async addPhotos(tx: Transaction, id: string, photos: { slot: string; documentId: string }[]) {
    await tx.insert(inspectionPhotos).values(photos.map((photo) => ({ ...photo, inspectionId: id })));
  }

  async report(tx: Transaction, id: string) {
    const [report] = await tx.select().from(inspectionReports).where(eq(inspectionReports.inspectionId, id));
    return report;
  }

  async publishReport(tx: Transaction, id: string, documentId: string) {
    await tx.insert(inspectionReports).values({ inspectionId: id, documentId });
    const [inspection] = await tx.update(inspections).set({ status: 'REPORT_READY' }).where(eq(inspections.id, id)).returning();
    return inspection;
  }

  /** An incident intake captures a date, not a time on that date. Same-day records cannot prove prior condition. */
  async preLoss(tx: Transaction, policyNumber: string, insurerId: string, customerId: string, incidentDay: string) {
    const beforeIncident = (timestamp: typeof documents.uploadedAt | typeof inspections.decidedAt) =>
      sql`(${timestamp} AT TIME ZONE 'Africa/Lusaka')::date < ${incidentDay}::date`;
    const available = and(eq(documents.scanStatus, 'CLEAN'), isNull(documents.deletedAt), isNull(documents.deletionStartedAt), beforeIncident(documents.uploadedAt));
    const quote = await tx.select({ slot: inspectionShots.shotKey, documentId: inspectionShots.documentId, reference: inspectionShots.quoteRequestId })
      .from(policies).innerJoin(inspectionShots, eq(inspectionShots.quoteRequestId, policies.quoteRequestId))
      .innerJoin(documents, eq(documents.id, inspectionShots.documentId))
      .where(and(eq(policies.policyNumber, policyNumber), eq(policies.insurerId, insurerId), eq(policies.customerId, customerId), available,
        sql`(${inspectionShots.capturedAt} AT TIME ZONE 'Africa/Lusaka')::date < ${incidentDay}::date`))
      .orderBy(asc(inspectionShots.shotKey));
    const paidBeforeIncident = and(eq(inspections.purpose, 'AFTER_PAYMENT'), eq(inspections.status, 'APPROVED'),
      eq(inspections.insurerId, insurerId), eq(inspections.customerId, customerId),
      eq(inspections.policyNumber, policyNumber), available, beforeIncident(inspections.decidedAt));
    const paid = await tx.select({ slot: inspectionPhotos.slot, documentId: inspectionPhotos.documentId, reference: inspections.id })
      .from(inspections).innerJoin(inspectionPhotos, eq(inspectionPhotos.inspectionId, inspections.id))
      .innerJoin(documents, eq(documents.id, inspectionPhotos.documentId))
      .where(paidBeforeIncident)
      .orderBy(desc(inspections.decidedAt), asc(inspectionPhotos.slot));
    const reports = await tx.select({ slot: sql<string>`'report'`, documentId: inspectionReports.documentId, reference: inspections.id })
      .from(inspections).innerJoin(inspectionReports, eq(inspectionReports.inspectionId, inspections.id))
      .innerJoin(documents, eq(documents.id, inspectionReports.documentId))
      .where(paidBeforeIncident)
      .orderBy(desc(inspections.decidedAt), asc(inspections.id));
    return [...quote, ...paid, ...reports];
  }
}
