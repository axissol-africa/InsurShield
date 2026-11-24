import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  customers,
  inspectionRequestProducts,
  inspections,
  insurerProductVersions,
  quoteRequestProductVersions,
} from '../db/schema.js';
import type { InspectionStatus } from '../common/domain/enums.js';

export type NewInspection = typeof inspections.$inferInsert;
export type NewInspectionLink = typeof inspectionRequestProducts.$inferInsert;

const inspectionColumns = {
  id: inspections.id,
  status: inspections.status,
  purpose: inspections.purpose,
  customerId: inspections.customerId,
  insurerId: inspections.insurerId,
  quoteRequestId: inspections.quoteRequestId,
  method: inspections.method,
  stage: inspections.stage,
  vehiclePlate: inspections.vehiclePlate,
  vehicleLabel: inspections.vehicleLabel,
  scheduledDate: inspections.scheduledDate,
  location: inspections.location,
  inspectorName: inspections.inspectorName,
  inspectorPhone: inspections.inspectorPhone,
  predecessorId: inspections.predecessorId,
  result: inspections.result,
  resultReason: inspections.resultReason,
  decidedAt: inspections.decidedAt,
  createdAt: inspections.createdAt,
};

/** Underwriting inspections and the chosen products each one serves. */
@Injectable()
export class UnderwritingInspectionsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async insert(tx: Transaction, inspection: NewInspection, links: Omit<NewInspectionLink, 'inspectionId'>[]) {
    const [created] = await tx.insert(inspections).values(inspection).returning(inspectionColumns);
    if (links.length > 0) {
      await tx.insert(inspectionRequestProducts).values(links.map((link) => ({ ...link, inspectionId: created.id })));
    }
    return created;
  }

  /** An inspection this insurer carries out, locked; undefined for anyone else's. */
  async lockForInsurer(tx: Transaction, id: string, insurerId: string) {
    const [inspection] = await tx
      .select(inspectionColumns)
      .from(inspections)
      .where(and(eq(inspections.id, id), eq(inspections.insurerId, insurerId)))
      .for('update');
    return inspection;
  }

  async exists(id: string, tx: Database | Transaction = this.db): Promise<boolean> {
    const [found] = await tx.select({ id: inspections.id }).from(inspections).where(eq(inspections.id, id));
    return found !== undefined;
  }

  /** The products an inspection serves, with whether each may be inspected again after a fail. */
  linksOf(tx: Database | Transaction, inspectionId: string) {
    return tx
      .select({
        quoteRequestId: inspectionRequestProducts.quoteRequestId,
        productVersionId: inspectionRequestProducts.productVersionId,
        stage: inspectionRequestProducts.stage,
        isOpen: inspectionRequestProducts.isOpen,
        passed: inspectionRequestProducts.passed,
        reinspectionAllowed: insurerProductVersions.reinspectionAllowed,
      })
      .from(inspectionRequestProducts)
      .innerJoin(insurerProductVersions, eq(insurerProductVersions.id, inspectionRequestProducts.productVersionId))
      .where(eq(inspectionRequestProducts.inspectionId, inspectionId))
      .orderBy(asc(inspectionRequestProducts.productVersionId));
  }

  async move(
    tx: Transaction,
    id: string,
    from: InspectionStatus,
    to: InspectionStatus,
    patch: Partial<NewInspection> = {},
  ): Promise<boolean> {
    const moved = await tx
      .update(inspections)
      .set({ ...patch, status: to })
      .where(and(eq(inspections.id, id), eq(inspections.status, from)))
      .returning({ id: inspections.id });
    return moved.length === 1;
  }

  async closeLinks(tx: Transaction, inspectionId: string, passed: boolean): Promise<void> {
    await tx
      .update(inspectionRequestProducts)
      .set({ isOpen: false, passed })
      .where(and(eq(inspectionRequestProducts.inspectionId, inspectionId), eq(inspectionRequestProducts.isOpen, true)));
  }

  /** Whether an approved inspection has satisfied this chosen product's rule. */
  async passed(tx: Database | Transaction, quoteRequestId: string, productVersionId: string): Promise<boolean> {
    const [link] = await tx
      .select({ id: inspectionRequestProducts.id })
      .from(inspectionRequestProducts)
      .where(
        and(
          eq(inspectionRequestProducts.quoteRequestId, quoteRequestId),
          eq(inspectionRequestProducts.productVersionId, productVersionId),
          eq(inspectionRequestProducts.passed, true),
        ),
      );
    return link !== undefined;
  }

  /** This insurer's open underwriting inspections, locked, for decision 24. */
  openForInsurer(tx: Transaction, insurerId: string) {
    return tx
      .select(inspectionColumns)
      .from(inspections)
      .where(
        and(
          eq(inspections.insurerId, insurerId),
          eq(inspections.purpose, 'UNDERWRITING'),
          inArray(inspections.status, ['REQUESTED', 'SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY']),
        ),
      )
      .for('update');
  }

  /** Every inspection this insurer carries out, newest first, with the customer to contact. */
  listForInsurer(insurerId: string) {
    return this.db
      .select({ ...inspectionColumns, customer: { fullName: customers.fullName, phone: customers.phone, email: customers.email } })
      .from(inspections)
      .innerJoin(customers, eq(customers.id, inspections.customerId))
      .where(eq(inspections.insurerId, insurerId))
      .orderBy(desc(inspections.createdAt), asc(inspections.id));
  }

  /** The product names each inspection serves, for the insurer's and the customer's lists. */
  productsOf(inspectionIds: string[]) {
    if (inspectionIds.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        inspectionId: inspectionRequestProducts.inspectionId,
        productVersionId: inspectionRequestProducts.productVersionId,
        productName: quoteRequestProductVersions.productName,
        stage: inspectionRequestProducts.stage,
        passed: inspectionRequestProducts.passed,
      })
      .from(inspectionRequestProducts)
      .innerJoin(
        quoteRequestProductVersions,
        and(
          eq(quoteRequestProductVersions.quoteRequestId, inspectionRequestProducts.quoteRequestId),
          eq(quoteRequestProductVersions.productVersionId, inspectionRequestProducts.productVersionId),
        ),
      )
      .where(inArray(inspectionRequestProducts.inspectionId, inspectionIds))
      .orderBy(asc(quoteRequestProductVersions.productName));
  }
}
