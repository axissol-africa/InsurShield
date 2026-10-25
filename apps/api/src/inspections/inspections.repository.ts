import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { inspectionPhotos, inspections, insurers } from '../db/schema.js';

export type NewInspection = typeof inspections.$inferInsert;
export type InspectionRow = typeof inspections.$inferSelect;
export type InspectionWithInsurer = InspectionRow & { insurerName: string | null };
export type PreferenceChanges = Pick<InspectionRow, 'preferredDate' | 'preferredTime' | 'preferredLocation' | 'notes'>;

const PHOTO = {
  inspectionId: inspectionPhotos.inspectionId,
  slot: inspectionPhotos.slot,
  documentId: inspectionPhotos.documentId,
};

const PHOTO_ORDER = [asc(inspectionPhotos.slot), asc(inspectionPhotos.id)];

export type PhotoRow = { inspectionId: string; slot: string; documentId: string };

@Injectable()
export class InspectionsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async listForCustomer(customerId: string): Promise<InspectionWithInsurer[]> {
    const rows = await this.db
      .select({ inspection: inspections, insurerName: insurers.name })
      .from(inspections)
      .leftJoin(insurers, eq(insurers.id, inspections.insurerId))
      .where(eq(inspections.customerId, customerId))
      .orderBy(desc(inspections.createdAt));
    return rows.map(({ inspection, insurerName }) => ({ ...inspection, insurerName }));
  }

  async photosOf(inspectionIds: string[]): Promise<PhotoRow[]> {
    if (inspectionIds.length === 0) return [];
    return this.db
      .select(PHOTO)
      .from(inspectionPhotos)
      .where(inArray(inspectionPhotos.inspectionId, inspectionIds))
      .orderBy(...PHOTO_ORDER);
  }

  async photosOfOwned(customerId: string, inspectionId: string): Promise<PhotoRow[]> {
    return this.db
      .select(PHOTO)
      .from(inspectionPhotos)
      .innerJoin(inspections, eq(inspections.id, inspectionPhotos.inspectionId))
      .where(and(eq(inspections.id, inspectionId), eq(inspections.customerId, customerId)))
      .orderBy(...PHOTO_ORDER);
  }

  async findActiveInsurer(tx: Transaction, insurerId: string) {
    const [insurer] = await tx
      .select({ id: insurers.id, name: insurers.name })
      .from(insurers)
      .where(and(eq(insurers.id, insurerId), eq(insurers.status, 'ACTIVE')))
      .for('share');
    return insurer;
  }

  async insert(tx: Transaction, inspection: NewInspection): Promise<InspectionRow> {
    const [created] = await tx.insert(inspections).values(inspection).returning();
    return created;
  }

  /** The customer's own inspection, locked until `tx` ends so its status cannot change underneath an edit. */
  async lockOwned(tx: Transaction, inspectionId: string, customerId: string): Promise<InspectionWithInsurer | undefined> {
    const [row] = await tx
      .select({ inspection: inspections, insurerName: insurers.name })
      .from(inspections)
      .leftJoin(insurers, eq(insurers.id, inspections.insurerId))
      .where(and(eq(inspections.id, inspectionId), eq(inspections.customerId, customerId)))
      .for('update', { of: inspections });
    return row && { ...row.inspection, insurerName: row.insurerName };
  }

  async updatePreferences(tx: Transaction, inspectionId: string, changes: PreferenceChanges): Promise<InspectionRow> {
    const [updated] = await tx.update(inspections).set(changes).where(eq(inspections.id, inspectionId)).returning();
    return updated;
  }
}
