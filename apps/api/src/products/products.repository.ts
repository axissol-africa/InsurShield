import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, exists, gte, isNotNull, isNull, lt, lte, ne, not, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { insurerEvidence, insurerProductVersions, insurerProducts, insurers } from '../db/schema.js';
import { takesNewBusinessWhere } from '../common/insurer-standing.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { calendarDate } from './domain/product-version.js';
import type { InsuranceType, ProductVersionStatus } from '../common/domain/enums.js';

type Executor = Database | Transaction;
export type ProductRow = typeof insurerProducts.$inferSelect;
export type ProductVersionRow = typeof insurerProductVersions.$inferSelect;

const productColumns = {
  id: insurerProducts.id,
  insurerId: insurerProducts.insurerId,
  code: insurerProducts.code,
  coverType: insurerProducts.coverType,
  createdAt: insurerProducts.createdAt,
  updatedAt: insurerProducts.updatedAt,
};
const versionColumns = {
  id: insurerProductVersions.id,
  productId: insurerProductVersions.productId,
  versionNumber: insurerProductVersions.versionNumber,
  status: insurerProductVersions.status,
  name: insurerProductVersions.name,
  coverType: insurerProductVersions.coverType,
  coverGuide: insurerProductVersions.coverGuide,
  inspectionRule: insurerProductVersions.inspectionRule,
  inspectionTiming: insurerProductVersions.inspectionTiming,
  inspectionMethod: insurerProductVersions.inspectionMethod,
  effectiveFrom: insurerProductVersions.effectiveFrom,
  effectiveUntil: insurerProductVersions.effectiveUntil,
  createdByStaffId: insurerProductVersions.createdByStaffId,
  submittedByStaffId: insurerProductVersions.submittedByStaffId,
  submittedAt: insurerProductVersions.submittedAt,
  reviewedByStaffId: insurerProductVersions.reviewedByStaffId,
  reviewedAt: insurerProductVersions.reviewedAt,
  reviewComment: insurerProductVersions.reviewComment,
  withdrawnByStaffId: insurerProductVersions.withdrawnByStaffId,
  withdrawnAt: insurerProductVersions.withdrawnAt,
  withdrawalReason: insurerProductVersions.withdrawalReason,
  createdAt: insurerProductVersions.createdAt,
  updatedAt: insurerProductVersions.updatedAt,
};
const insurerColumns = {
  id: insurers.id,
  name: insurers.name,
  tradingName: insurers.tradingName,
  logoUrl: insurers.logoUrl,
};

@Injectable()
export class ProductsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async listForInsurer(insurerId: string) {
    return this.db
      .select({ product: productColumns, version: versionColumns })
      .from(insurerProducts)
      .leftJoin(insurerProductVersions, eq(insurerProductVersions.productId, insurerProducts.id))
      .where(eq(insurerProducts.insurerId, insurerId))
      .orderBy(asc(insurerProducts.code), desc(insurerProductVersions.versionNumber));
  }

  async findProduct(id: string, executor: Executor = this.db) {
    const [row] = await executor.select(productColumns).from(insurerProducts).where(eq(insurerProducts.id, id));
    return row;
  }

  async lockProduct(tx: Transaction, id: string) {
    const [row] = await tx.select(productColumns).from(insurerProducts).where(eq(insurerProducts.id, id)).for('update');
    return row;
  }

  async findVersion(productId: string, versionId: string, executor: Executor = this.db) {
    const [row] = await executor
      .select({ product: productColumns, version: versionColumns, insurer: insurerColumns })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(eq(insurerProductVersions.id, versionId), eq(insurerProductVersions.productId, productId)));
    return row;
  }

  async lockVersion(tx: Transaction, productId: string, versionId: string) {
    const [row] = await tx
      .select({ product: productColumns, version: versionColumns, insurer: insurerColumns })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(eq(insurerProductVersions.id, versionId), eq(insurerProductVersions.productId, productId)))
      .for('update', { of: insurerProductVersions });
    return row;
  }

  async createProduct(tx: Transaction, values: typeof insurerProducts.$inferInsert) {
    const [product] = await tx.insert(insurerProducts).values(values).returning(productColumns);
    return product;
  }

  async createVersion(tx: Transaction, values: typeof insurerProductVersions.$inferInsert) {
    const [version] = await tx.insert(insurerProductVersions).values(values).returning(versionColumns);
    return version;
  }

  async updateVersion(
    tx: Transaction,
    versionId: string,
    changes: Partial<Omit<typeof insurerProductVersions.$inferInsert, 'id' | 'productId' | 'versionNumber' | 'createdAt'>>,
  ) {
    const [version] = await tx
      .update(insurerProductVersions)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(insurerProductVersions.id, versionId))
      .returning(versionColumns);
    return version;
  }

  async nextVersionNumber(tx: Transaction, productId: string): Promise<number> {
    const [row] = await tx
      .select({ largest: sql<number>`coalesce(max(${insurerProductVersions.versionNumber}), 0)` })
      .from(insurerProductVersions)
      .where(eq(insurerProductVersions.productId, productId));
    return Number(row?.largest ?? 0) + 1;
  }

  async listForReview(status?: ProductVersionStatus) {
    const where = status ? eq(insurerProductVersions.status, status) : undefined;
    return this.db
      .select({ product: productColumns, version: versionColumns, insurer: insurerColumns })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(where)
      .orderBy(asc(insurerProductVersions.status), desc(insurerProductVersions.updatedAt));
  }

  /** Customer-safe products in force today from insurers that can accept new business. */
  async directory(now: Date, coverType?: InsuranceType, limit = 100) {
    const today = calendarDate(lusakaDay(now));
    // A product approval is not a permanent compliance decision. The insurer
    // must still hold a current approved licence, and no evidence currently on
    // file may have been rejected or lapsed since the version was approved.
    const currentApprovedLicence = exists(
      this.db.select({ one: sql`1` })
        .from(insurerEvidence)
        .where(and(
          eq(insurerEvidence.insurerId, insurers.id),
          eq(insurerEvidence.kind, 'LICENCE'),
          eq(insurerEvidence.state, 'APPROVED'),
          or(isNull(insurerEvidence.expiresAt), gte(insurerEvidence.expiresAt, today)),
        )),
    );
    const hasInvalidEvidence = exists(
      this.db.select({ one: sql`1` })
        .from(insurerEvidence)
        .where(and(
          eq(insurerEvidence.insurerId, insurers.id),
          or(
            ne(insurerEvidence.state, 'APPROVED'),
            and(isNotNull(insurerEvidence.expiresAt), lt(insurerEvidence.expiresAt, today)),
          ),
        )),
    );
    const filters = [
      eq(insurerProductVersions.status, 'APPROVED'),
      lte(insurerProductVersions.effectiveFrom, today),
      or(isNull(insurerProductVersions.effectiveUntil), gte(insurerProductVersions.effectiveUntil, today)),
      ...takesNewBusinessWhere(now),
      currentApprovedLicence,
      not(hasInvalidEvidence),
    ];
    if (coverType) filters.push(eq(insurerProductVersions.coverType, coverType));
    return this.db
      .select({ product: productColumns, version: versionColumns, insurer: insurerColumns })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(...filters))
      .orderBy(asc(insurers.name), asc(insurerProductVersions.name), desc(insurerProductVersions.versionNumber))
      .limit(limit);
  }
}
