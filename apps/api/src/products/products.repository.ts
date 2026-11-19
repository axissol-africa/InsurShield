import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import {
  comparisonTaxonomyItems,
  insurerProductVersions,
  insurerProducts,
  insurers,
  productVersionComparisonItems,
  productVersionRequirements,
} from '../db/schema.js';
import type { ProductRequirementDefinition } from './domain/product-requirements.js';
import { customerAvailableProductConditions } from './customer-availability.js';
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
  rateBps: insurerProductVersions.rateBps,
  showEstimate: insurerProductVersions.showEstimate,
  allowedDurations: insurerProductVersions.allowedDurations,
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
const comparisonColumns = {
  id: productVersionComparisonItems.id,
  productVersionId: productVersionComparisonItems.productVersionId,
  taxonomyItemId: productVersionComparisonItems.taxonomyItemId,
  taxonomyVersion: productVersionComparisonItems.taxonomyVersion,
  taxonomyCode: productVersionComparisonItems.taxonomyCode,
  taxonomyLabel: productVersionComparisonItems.taxonomyLabel,
  taxonomyDescription: productVersionComparisonItems.taxonomyDescription,
  taxonomyCategory: productVersionComparisonItems.taxonomyCategory,
  taxonomyDataType: productVersionComparisonItems.taxonomyDataType,
  taxonomyUnit: productVersionComparisonItems.taxonomyUnit,
  taxonomyAllowedValues: productVersionComparisonItems.taxonomyAllowedValues,
  taxonomyDisplayRule: productVersionComparisonItems.taxonomyDisplayRule,
  included: productVersionComparisonItems.included,
  valueText: productVersionComparisonItems.valueText,
  createdAt: productVersionComparisonItems.createdAt,
};
const requirementColumns = {
  productVersionId: productVersionRequirements.productVersionId,
  key: productVersionRequirements.key,
  kind: productVersionRequirements.kind,
  label: productVersionRequirements.label,
  helpText: productVersionRequirements.helpText,
  required: productVersionRequirements.required,
  config: productVersionRequirements.config,
  displayOrder: productVersionRequirements.displayOrder,
};
const taxonomyColumns = {
  id: comparisonTaxonomyItems.id,
  code: comparisonTaxonomyItems.code,
  label: comparisonTaxonomyItems.label,
  description: comparisonTaxonomyItems.description,
  category: comparisonTaxonomyItems.category,
  versionNumber: comparisonTaxonomyItems.versionNumber,
  dataType: comparisonTaxonomyItems.dataType,
  unit: comparisonTaxonomyItems.unit,
  allowedValues: comparisonTaxonomyItems.allowedValues,
  displayRule: comparisonTaxonomyItems.displayRule,
  status: comparisonTaxonomyItems.status,
  displayOrder: comparisonTaxonomyItems.displayOrder,
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

  async comparisonItemsForVersions(versionIds: string[], executor: Executor = this.db) {
    if (versionIds.length === 0) return [];
    return executor
      .select({ mapping: comparisonColumns })
      .from(productVersionComparisonItems)
      .where(inArray(productVersionComparisonItems.productVersionId, versionIds))
      .orderBy(asc(productVersionComparisonItems.taxonomyCategory), asc(productVersionComparisonItems.taxonomyLabel));
  }

  async activeTaxonomyForIds(tx: Transaction, ids: string[]) {
    if (ids.length === 0) return [];
    return tx.select(taxonomyColumns).from(comparisonTaxonomyItems)
      .where(and(inArray(comparisonTaxonomyItems.id, ids), eq(comparisonTaxonomyItems.status, 'ACTIVE')));
  }

  async replaceComparisonItems(
    tx: Transaction,
    productVersionId: string,
    items: Array<{
      taxonomyItemId: string;
      taxonomyVersion: number;
      taxonomyCode: string;
      taxonomyLabel: string;
      taxonomyDescription: string | null;
      taxonomyCategory: typeof productVersionComparisonItems.$inferInsert.taxonomyCategory;
      taxonomyDataType: typeof productVersionComparisonItems.$inferInsert.taxonomyDataType;
      taxonomyUnit: string | null;
      taxonomyAllowedValues: string[];
      taxonomyDisplayRule: typeof productVersionComparisonItems.$inferInsert.taxonomyDisplayRule;
      included: boolean;
      valueText: string | null;
    }>,
  ) {
    await tx.delete(productVersionComparisonItems).where(eq(productVersionComparisonItems.productVersionId, productVersionId));
    if (items.length) await tx.insert(productVersionComparisonItems).values(items.map((item) => ({ productVersionId, ...item })));
  }

  async copyComparisonItems(tx: Transaction, sourceVersionId: string, targetVersionId: string) {
    const source = await this.comparisonItemsForVersions([sourceVersionId], tx);
    await this.replaceComparisonItems(tx, targetVersionId, source.map(({ mapping }) => ({
      taxonomyItemId: mapping.taxonomyItemId,
      taxonomyVersion: mapping.taxonomyVersion,
      taxonomyCode: mapping.taxonomyCode,
      taxonomyLabel: mapping.taxonomyLabel,
      taxonomyDescription: mapping.taxonomyDescription,
      taxonomyCategory: mapping.taxonomyCategory,
      taxonomyDataType: mapping.taxonomyDataType,
      taxonomyUnit: mapping.taxonomyUnit,
      taxonomyAllowedValues: mapping.taxonomyAllowedValues,
      taxonomyDisplayRule: mapping.taxonomyDisplayRule,
      included: mapping.included,
      valueText: mapping.valueText,
    })));
  }

  async requirementsForVersions(versionIds: string[], executor: Executor = this.db) {
    if (versionIds.length === 0) return [];
    return executor
      .select(requirementColumns)
      .from(productVersionRequirements)
      .where(inArray(productVersionRequirements.productVersionId, versionIds))
      .orderBy(asc(productVersionRequirements.displayOrder), asc(productVersionRequirements.key));
  }

  async replaceRequirements(
    tx: Transaction,
    productVersionId: string,
    requirements: Array<Omit<ProductRequirementDefinition, 'productVersionId'>>,
  ): Promise<void> {
    await tx.delete(productVersionRequirements).where(eq(productVersionRequirements.productVersionId, productVersionId));
    if (requirements.length) await tx.insert(productVersionRequirements).values(requirements.map((requirement) => ({ productVersionId, ...requirement })));
  }

  async copyRequirements(tx: Transaction, sourceVersionId: string, targetVersionId: string): Promise<void> {
    const source = await this.requirementsForVersions([sourceVersionId], tx);
    await this.replaceRequirements(tx, targetVersionId, source.map((requirement) => ({
      key: requirement.key,
      kind: requirement.kind as ProductRequirementDefinition['kind'],
      label: requirement.label,
      helpText: requirement.helpText,
      required: requirement.required,
      config: requirement.config as ProductRequirementDefinition['config'],
      displayOrder: requirement.displayOrder,
    })));
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
  async directory(
    now: Date,
    coverType?: InsuranceType,
    limit = 100,
    productId?: string,
    versionId?: string,
    executor: Executor = this.db,
  ) {
    return executor
      .select({ product: productColumns, version: versionColumns, insurer: insurerColumns })
      .from(insurerProductVersions)
      .innerJoin(insurerProducts, eq(insurerProducts.id, insurerProductVersions.productId))
      .innerJoin(insurers, eq(insurers.id, insurerProducts.insurerId))
      .where(and(...customerAvailableProductConditions(executor, now, { coverType, productId, productVersionId: versionId })))
      .orderBy(asc(insurers.name), asc(insurerProductVersions.name), desc(insurerProductVersions.versionNumber))
      .limit(limit);
  }
}
