import { Logger } from '@nestjs/common';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import { hashPassword } from 'better-auth/crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database.module.js';
import { describeDatabaseError, isUniqueViolation } from '../db/errors.js';
import { consentRecords, customers, staffUsers } from '../db/schema.js';
import { CLIENT_ADDRESS_HEADER } from './auth.constants.js';
import { checkPassword, insertCredentialUser, normalizeEmail } from './credential-user.js';

export const MAX_EMAIL_LENGTH = 254;

const ACCOUNT_CONFLICT = {
  code: 'ACCOUNT_CONFLICT',
  message: 'Another InsurShield account already uses this email address or phone number.',
};

const registrationBody = z.strictObject({
  fullName: z.string().trim().min(1),
  email: z.email().max(MAX_EMAIL_LENGTH),
  phone: z.string().min(6).max(24),
  password: z.string(),
  noticeVersion: z.string().min(1),
});

/**
 * Customer sign-up: the login, the customer and the first consent are written in one transaction, so no
 * login exists without its customer. Better Auth's own sign-up stays off.
 */
export function registration(db: Database) {
  const logger = new Logger('Registration');
  return {
    id: 'insurshield-registration',
    endpoints: {
      register: createAuthEndpoint(
        '/register',
        { method: 'POST', body: registrationBody },
        async (ctx) => {
          const { fullName, phone, password, noticeVersion } = ctx.body;
          const email = normalizeEmail(ctx.body.email);
          // The address `POST /auth/consent` records too, not Better Auth's /64-masked one.
          const ipAddress = ctx.headers?.get(CLIENT_ADDRESS_HEADER) ?? null;
          const userAgent = ctx.headers?.get('user-agent') ?? null;
          // Checked and hashed before anything is looked up, so a staff member's email costs what any other does.
          checkPassword(password);
          const passwordHash = await hashPassword(password);

          let user;
          try {
            user = await db.transaction(async (tx) => {
              const [staff] = await tx
                .select({ id: staffUsers.id })
                .from(staffUsers)
                .where(eq(sql`lower(${staffUsers.email})`, email));
              if (staff) throw new APIError('CONFLICT', ACCOUNT_CONFLICT);
              const created = await insertCredentialUser(tx, { email, name: fullName, passwordHash });
              const [customer] = await tx
                .insert(customers)
                .values({ userId: created.id, email, fullName, phone })
                .returning({ id: customers.id });
              await tx.insert(consentRecords).values({
                customerId: customer.id,
                privacyVersion: noticeVersion,
                termsVersion: noticeVersion,
                ipAddress,
                userAgent,
              });
              return created;
            });
          } catch (error) {
            if (isUniqueViolation(error)) throw new APIError('CONFLICT', ACCOUNT_CONFLICT);
            throw error;
          }

          ctx.setStatus(201);
          // The account is committed: a failure from here on must not be answered as a failed registration.
          try {
            const session = await ctx.context.internalAdapter.createSession(user.id);
            await setSessionCookie(ctx, { session, user });
          } catch (error) {
            logger.error(`A registered account could not be signed in: ${JSON.stringify(describeDatabaseError(error))}`);
            return ctx.json({ signedIn: false, userId: user.id });
          }
          return ctx.json({ signedIn: true, userId: user.id });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}
