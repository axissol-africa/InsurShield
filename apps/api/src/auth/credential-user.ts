import { BASE_ERROR_CODES } from 'better-auth';
import { APIError } from 'better-auth/api';
import { hashPassword } from 'better-auth/crypto';
import type { Database, Transaction } from '../db/database.module.js';
import { authAccounts, authUsers } from '../db/schema.js';
import { PASSWORD_POLICY } from './auth.constants.js';

/** Better Auth's sign-in finds a password only on this provider, with `accountId` equal to the user id. */
export const CREDENTIAL_PROVIDER = 'credential';

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function checkPassword(password: string): void {
  if (password.length < PASSWORD_POLICY.minPasswordLength) {
    throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.PASSWORD_TOO_SHORT);
  }
  if (password.length > PASSWORD_POLICY.maxPasswordLength) {
    throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.PASSWORD_TOO_LONG);
  }
}

/**
 * Writes a Better Auth user and its password account so that Better Auth's own sign-in finds them.
 * Registration, the seed and the e2e builders all create accounts through this.
 */
export async function createCredentialUser(
  tx: Database | Transaction,
  input: { email: string; name: string; password: string },
): Promise<typeof authUsers.$inferSelect> {
  checkPassword(input.password);
  return insertCredentialUser(tx, { email: input.email, name: input.name, passwordHash: await hashPassword(input.password) });
}

/** As `createCredentialUser`, for a caller that checked and hashed the password itself. */
export async function insertCredentialUser(
  tx: Database | Transaction,
  input: { email: string; name: string; passwordHash: string },
): Promise<typeof authUsers.$inferSelect> {
  const [user] = await tx
    .insert(authUsers)
    .values({ email: normalizeEmail(input.email), name: input.name })
    .returning();
  await tx.insert(authAccounts).values({
    userId: user.id,
    accountId: user.id,
    providerId: CREDENTIAL_PROVIDER,
    password: input.passwordHash,
  });
  return user;
}
