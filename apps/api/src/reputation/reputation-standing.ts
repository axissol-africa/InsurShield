import { and, eq, exists, sql } from 'drizzle-orm';
import type { Database, Transaction } from '../db/database.module.js';
import { insurerProducts, insurerProductVersions, insurers } from '../db/schema.js';
import { customerAvailableProductConditions } from '../products/customer-availability.js';

/** Mirrors the live cover directory, including current licence evidence. */
export function mayDisplayCertificateBadge(executor: Database | Transaction, now: Date) {
  return exists(executor.select({ one: sql`1` }).from(insurerProducts)
    .innerJoin(insurerProductVersions, eq(insurerProductVersions.productId, insurerProducts.id))
    .where(and(eq(insurerProducts.insurerId, insurers.id), ...customerAvailableProductConditions(executor, now))));
}
