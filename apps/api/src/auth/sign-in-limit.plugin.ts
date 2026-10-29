import type { LoggerService } from '@nestjs/common';
import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx, isAPIError } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database.module.js';
import { describeDatabaseError } from '../db/errors.js';
import { MAX_EMAIL_LENGTH } from './registration.plugin.js';

export const SIGN_IN_ADMISSIONS = 10;
export const SIGN_IN_WINDOW_MS = 15 * 60 * 1000;
export const SIGN_IN_LOCK_MS = 15 * 60 * 1000;
/** One admission in this many also sweeps rows whose window and lock are over. */
export const SIGN_IN_CLEANUP_EVERY = 20;
const CLEANUP_BATCH = 100;

const SIGN_IN_PATH = '/sign-in/email';
const CHANGE_PASSWORD_PATH = '/change-password';
const LIMITED_PATHS = new Set([SIGN_IN_PATH, CHANGE_PASSWORD_PATH]);

export const SIGN_IN_LOCKED = {
  code: 'TOO_MANY_ATTEMPTS',
  message: 'Too many sign-in attempts. Please try again later.',
};

const SIGN_IN_UNAVAILABLE = {
  code: 'TRY_AGAIN',
  message: 'Sign-in is unavailable right now. Please try again in a moment.',
};

/** The key Better Auth's own lookup would use, or none for an email it refuses before checking a password. */
function emailKey(email: unknown): string | undefined {
  if (typeof email !== 'string' || !z.email().safeParse(email).success) return undefined;
  const key = email.toLowerCase();
  return key.length <= MAX_EMAIL_LENGTH ? key : undefined;
}

/**
 * A password change counts against the signed-in user, on a key without an `@`, which no email key has: sign-in
 * failures never lock a password change, and password-change failures never lock sign-in.
 */
async function limitKey(ctx: GenericEndpointContext): Promise<string | undefined> {
  if (ctx.path === CHANGE_PASSWORD_PATH) {
    const session = await getSessionFromCtx(ctx, { disableRefresh: true });
    return session ? `password-change:${session.user.id.toLowerCase()}` : undefined;
  }
  const body: unknown = ctx.body;
  if (typeof body !== 'object' || body === null) return undefined;
  return emailKey((body as { email?: unknown }).email);
}

/**
 * Limits sign-in attempts per email and password changes per user, from any address, in the application's own
 * table: Better Auth prunes its rate-limit rows after its longest window, which would end a lock early. Attempts
 * are counted before the password is checked, and the answer never depends on whether the email exists.
 */
export function signInLimit(db: Database, options: { enabled: boolean; logger: LoggerService }) {
  const { logger } = options;
  let admissions = 0;

  async function admit(key: string): Promise<number> {
    const now = new Date(Date.now());
    const windowEnded = new Date(now.getTime() - SIGN_IN_WINDOW_MS);
    const lockUntil = new Date(now.getTime() + SIGN_IN_LOCK_MS);
    // A new window starts only when the old one has ended and no lock is active, so expiry never clears a lock.
    const fresh = sql`(auth_sign_in_failures."windowStartedAt" <= ${windowEnded}
      AND (auth_sign_in_failures."lockedUntil" IS NULL OR auth_sign_in_failures."lockedUntil" <= ${now}))`;
    const { rows } = await db.execute<{ attempts: number }>(sql`
      INSERT INTO auth_sign_in_failures ("emailKey", attempts, "windowStartedAt", "lockedUntil")
      VALUES (${key}, 1, ${now}, NULL)
      ON CONFLICT ("emailKey") DO UPDATE SET
        attempts = CASE WHEN ${fresh} THEN 1 ELSE auth_sign_in_failures.attempts + 1 END,
        "windowStartedAt" = CASE WHEN ${fresh} THEN ${now} ELSE auth_sign_in_failures."windowStartedAt" END,
        "lockedUntil" = CASE
          WHEN ${fresh} THEN NULL
          WHEN auth_sign_in_failures."lockedUntil" IS NULL
           AND auth_sign_in_failures.attempts + 1 >= ${SIGN_IN_ADMISSIONS} THEN ${lockUntil}
          ELSE auth_sign_in_failures."lockedUntil"
        END
      RETURNING attempts`);
    return rows[0].attempts;
  }

  async function cleanUp() {
    const now = new Date(Date.now());
    const windowEnded = new Date(now.getTime() - SIGN_IN_WINDOW_MS);
    try {
      await db.execute(sql`
        DELETE FROM auth_sign_in_failures WHERE "emailKey" IN (
          SELECT "emailKey" FROM auth_sign_in_failures
           WHERE "windowStartedAt" < ${windowEnded} AND ("lockedUntil" IS NULL OR "lockedUntil" < ${now})
           LIMIT ${CLEANUP_BATCH} FOR UPDATE SKIP LOCKED)`);
    } catch (error) {
      logger.error(`Sign-in limit cleanup failed: ${JSON.stringify(describeDatabaseError(error))}`);
    }
  }

  return {
    id: 'insurshield-sign-in-limit',
    hooks: options.enabled
      ? {
          before: [
            {
              matcher: (context) => LIMITED_PATHS.has(context.path ?? ''),
              handler: createAuthMiddleware(async (ctx) => {
                const key = await limitKey(ctx);
                if (key === undefined) return;
                let attempts: number;
                try {
                  attempts = await admit(key);
                } catch (error) {
                  logger.error(`Sign-in admission failed: ${JSON.stringify(describeDatabaseError(error))}`);
                  throw new APIError('SERVICE_UNAVAILABLE', SIGN_IN_UNAVAILABLE);
                }
                admissions += 1;
                if (admissions % SIGN_IN_CLEANUP_EVERY === 0) await cleanUp();
                if (attempts > SIGN_IN_ADMISSIONS) throw new APIError('TOO_MANY_REQUESTS', SIGN_IN_LOCKED);
              }),
            },
          ],
          after: [
            {
              matcher: (context) => LIMITED_PATHS.has(context.path ?? ''),
              handler: createAuthMiddleware(async (ctx) => {
                const key = await limitKey(ctx);
                const returned: unknown = ctx.context.returned;
                if (key === undefined || returned === undefined || isAPIError(returned)) return;
                try {
                  await db.execute(
                    sql`DELETE FROM auth_sign_in_failures WHERE "emailKey" = ${key} AND "lockedUntil" IS NULL`,
                  );
                } catch (error) {
                  logger.error(`Sign-in limit reset failed: ${JSON.stringify(describeDatabaseError(error))}`);
                }
              }),
            },
          ],
        }
      : undefined,
  } satisfies BetterAuthPlugin;
}
