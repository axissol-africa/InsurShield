import { and, eq, exists, gte, inArray, isNotNull, isNull, lt, lte, ne, not, or, sql, type SQL } from 'drizzle-orm';
import type { Database, Transaction } from '../db/database.module.js';
import { insurerEvidence, insurerProductVersions, insurerProducts, insurers } from '../db/schema.js';
import { takesNewBusinessWhere } from '../common/insurer-standing.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { calendarDate } from './domain/product-version.js';
import type { InsuranceType } from '../common/domain/enums.js';

type Executor = Database | Transaction;

export type CustomerAvailableProductOptions = {
  coverType?: InsuranceType;
  productId?: string;
  productIds?: string[];
  productVersionId?: string;
  productVersionIds?: string[];
};

/**
 * The single eligibility predicate used both to show and to submit customer
 * product choices. Keeping this in one place prevents a product from being
 * visible in the directory but rejected for a different standing decision at
 * submit time.
 */
export function customerAvailableProductConditions(
  executor: Executor,
  now: Date,
  options: CustomerAvailableProductOptions = {},
): Array<SQL | undefined> {
  const today = calendarDate(lusakaDay(now));
  const currentApprovedLicence = exists(
    executor
      .select({ one: sql`1` })
      .from(insurerEvidence)
      .where(
        and(
          eq(insurerEvidence.insurerId, insurers.id),
          eq(insurerEvidence.kind, 'LICENCE'),
          eq(insurerEvidence.state, 'APPROVED'),
          or(isNull(insurerEvidence.expiresAt), gte(insurerEvidence.expiresAt, today)),
        ),
      ),
  );
  const hasInvalidEvidence = exists(
    executor
      .select({ one: sql`1` })
      .from(insurerEvidence)
      .where(
        and(
          eq(insurerEvidence.insurerId, insurers.id),
          or(
            ne(insurerEvidence.state, 'APPROVED'),
            and(isNotNull(insurerEvidence.expiresAt), lt(insurerEvidence.expiresAt, today)),
          ),
        ),
      ),
  );
  const filters: Array<SQL | undefined> = [
    eq(insurerProductVersions.status, 'APPROVED'),
    lte(insurerProductVersions.effectiveFrom, today),
    or(isNull(insurerProductVersions.effectiveUntil), gte(insurerProductVersions.effectiveUntil, today)),
    ...takesNewBusinessWhere(now),
    currentApprovedLicence,
    not(hasInvalidEvidence),
  ];
  if (options.coverType) filters.push(eq(insurerProductVersions.coverType, options.coverType));
  if (options.productId) filters.push(eq(insurerProducts.id, options.productId));
  if (options.productIds?.length) filters.push(inArray(insurerProducts.id, options.productIds));
  if (options.productVersionId) filters.push(eq(insurerProductVersions.id, options.productVersionId));
  if (options.productVersionIds?.length) filters.push(inArray(insurerProductVersions.id, options.productVersionIds));
  return filters;
}
