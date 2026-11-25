import { and, eq, isNull } from 'drizzle-orm';
import { ACCOUNT_CLOSED } from '../common/auth/messages.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from './database.module.js';
import { customers } from './schema.js';

/** Acquire before business-record locks. Closure's FOR UPDATE waits, or a waiting creator sees deletedAt and refuses. */
export async function lockOpenCustomer(tx: Transaction, customerId: string): Promise<boolean> {
  const [customer] = await tx.select({ id: customers.id }).from(customers)
    .where(and(eq(customers.id, customerId), isNull(customers.deletedAt))).for('key share');
  return customer !== undefined;
}

export async function assertOpenCustomer(tx: Transaction, customerId: string): Promise<void> {
  if (!(await lockOpenCustomer(tx, customerId))) throw ApiException.forbidden(ACCOUNT_CLOSED);
}

/**
 * Finance recovery may concern a closed account. SHARE also excludes retention's NO KEY UPDATE,
 * so its customer update cannot wait on us while we wait on its retention advisory lock.
 */
export async function lockCustomerForFinance(tx: Transaction, customerId: string): Promise<void> {
  const [customer] = await tx.select({ id: customers.id }).from(customers)
    .where(eq(customers.id, customerId)).for('share');
  if (!customer) throw ApiException.notFound('Customer', customerId);
}
