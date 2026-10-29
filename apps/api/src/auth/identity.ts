import { eq } from 'drizzle-orm';
import type { Principal } from '../common/auth/auth.types.js';
import { ACCOUNT_CLOSED, STAFF_INACTIVE } from '../common/auth/messages.js';
import type { Database } from '../db/database.module.js';
import { customers, insurers, staffUsers } from '../db/schema.js';

export type Identity =
  | { ok: true; principal: Principal }
  | { ok: false; status: 401 | 403; code: 'UNAUTHORIZED' | 'FORBIDDEN'; message: string };

const UNLINKED = { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Sign in to continue.' } as const;

function forbidden(message: string): Identity {
  return { ok: false, status: 403, code: 'FORBIDDEN', message };
}

/**
 * The one rule for who a Better Auth user is, applied when a session is created and on every request.
 * The domain rows are the authority: a user linked to neither kind of account, or to both, is refused.
 */
export async function resolveIdentity(db: Database, userId: string): Promise<Identity> {
  const [customer] = await db
    .select({ id: customers.id, email: customers.email, deletedAt: customers.deletedAt })
    .from(customers)
    .where(eq(customers.userId, userId));
  const [staff] = await db
    .select({
      id: staffUsers.id,
      email: staffUsers.email,
      role: staffUsers.role,
      insurerId: staffUsers.insurerId,
      isActive: staffUsers.isActive,
      insurerStatus: insurers.status,
    })
    .from(staffUsers)
    .leftJoin(insurers, eq(insurers.id, staffUsers.insurerId))
    .where(eq(staffUsers.userId, userId));

  if (customer && staff) return UNLINKED;
  if (customer) {
    if (customer.deletedAt) return forbidden(ACCOUNT_CLOSED);
    return { ok: true, principal: { kind: 'customer', id: customer.id, email: customer.email } };
  }
  if (staff) {
    if (!staff.isActive || staff.insurerStatus === 'DELETED') return forbidden(STAFF_INACTIVE);
    return {
      ok: true,
      principal: { kind: 'staff', id: staff.id, email: staff.email, role: staff.role, insurerId: staff.insurerId },
    };
  }
  return UNLINKED;
}
