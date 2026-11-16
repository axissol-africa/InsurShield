import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { comparisonTaxonomyItems, platformRuleVersions } from '../db/schema.js';
import type { RuleSettingKey, RuleSettingState } from '../common/domain/enums.js';

type Executor = Database | Transaction;
export type RuleVersionRow = typeof platformRuleVersions.$inferSelect;
export type TaxonomyItemRow = typeof comparisonTaxonomyItems.$inferSelect;

const ruleColumns = {
  id: platformRuleVersions.id,
  key: platformRuleVersions.key,
  versionNumber: platformRuleVersions.versionNumber,
  state: platformRuleVersions.state,
  value: platformRuleVersions.value,
  effectiveFrom: platformRuleVersions.effectiveFrom,
  effectiveUntil: platformRuleVersions.effectiveUntil,
  createdByStaffId: platformRuleVersions.createdByStaffId,
  confirmedByStaffId: platformRuleVersions.confirmedByStaffId,
  confirmedAt: platformRuleVersions.confirmedAt,
  createdAt: platformRuleVersions.createdAt,
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
  createdByStaffId: comparisonTaxonomyItems.createdByStaffId,
  updatedByStaffId: comparisonTaxonomyItems.updatedByStaffId,
  createdAt: comparisonTaxonomyItems.createdAt,
  updatedAt: comparisonTaxonomyItems.updatedAt,
};

@Injectable()
export class SettingsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> { return this.db.transaction(work); }

  async listRuleVersions(key?: RuleSettingKey, executor: Executor = this.db) {
    return executor.select(ruleColumns).from(platformRuleVersions)
      .where(key ? eq(platformRuleVersions.key, key) : undefined)
      .orderBy(asc(platformRuleVersions.key), desc(platformRuleVersions.versionNumber));
  }

  async lockRuleVersions(tx: Transaction, key: RuleSettingKey) {
    // A transactional advisory lock also serialises the first version, where no
    // row exists yet for `FOR UPDATE` to lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    return tx.select(ruleColumns).from(platformRuleVersions)
      .where(eq(platformRuleVersions.key, key))
      .orderBy(desc(platformRuleVersions.versionNumber))
      .for('update');
  }

  async findRuleVersion(tx: Transaction, key: RuleSettingKey, id: string) {
    const [row] = await tx.select(ruleColumns).from(platformRuleVersions)
      .where(and(eq(platformRuleVersions.key, key), eq(platformRuleVersions.id, id)))
      .for('update');
    return row;
  }

  async createRuleVersion(tx: Transaction, values: typeof platformRuleVersions.$inferInsert) {
    const [row] = await tx.insert(platformRuleVersions).values(values).returning(ruleColumns);
    return row;
  }

  async effectiveRule(key: RuleSettingKey, day: Date, state: RuleSettingState, executor: Executor = this.db) {
    const [row] = await executor.select(ruleColumns).from(platformRuleVersions)
      .where(and(
        eq(platformRuleVersions.key, key),
        eq(platformRuleVersions.state, state),
        lte(platformRuleVersions.effectiveFrom, day),
        or(isNull(platformRuleVersions.effectiveUntil), gte(platformRuleVersions.effectiveUntil, day)),
      ))
      .orderBy(desc(platformRuleVersions.versionNumber))
      .limit(1);
    return row;
  }

  async listTaxonomy(status?: 'ACTIVE' | 'DISABLED', executor: Executor = this.db) {
    return executor.select(taxonomyColumns).from(comparisonTaxonomyItems)
      .where(status ? eq(comparisonTaxonomyItems.status, status) : undefined)
      .orderBy(asc(comparisonTaxonomyItems.category), asc(comparisonTaxonomyItems.displayOrder), asc(comparisonTaxonomyItems.label));
  }

  async findTaxonomy(id: string, executor: Executor = this.db) {
    const [row] = await executor.select(taxonomyColumns).from(comparisonTaxonomyItems).where(eq(comparisonTaxonomyItems.id, id));
    return row;
  }

  async lockTaxonomy(tx: Transaction, id: string) {
    const [row] = await tx.select(taxonomyColumns).from(comparisonTaxonomyItems).where(eq(comparisonTaxonomyItems.id, id)).for('update');
    return row;
  }

  async createTaxonomy(tx: Transaction, values: typeof comparisonTaxonomyItems.$inferInsert) {
    const [row] = await tx.insert(comparisonTaxonomyItems).values(values).returning(taxonomyColumns);
    return row;
  }

  async updateTaxonomy(tx: Transaction, id: string, values: Partial<typeof comparisonTaxonomyItems.$inferInsert>) {
    const [row] = await tx.update(comparisonTaxonomyItems).set({ ...values, updatedAt: new Date() })
      .where(eq(comparisonTaxonomyItems.id, id)).returning(taxonomyColumns);
    return row;
  }
}
