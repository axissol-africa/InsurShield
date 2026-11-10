import { Logger } from '@nestjs/common';
import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, createEmailVerificationToken } from 'better-auth/api';
import { hashPassword } from 'better-auth/crypto';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db/database.module.js';
import { describeDatabaseError, isUniqueViolation } from '../db/errors.js';
import { consentRecords, customers, staffUsers } from '../db/schema.js';
import type { MailSender } from '../mail/mail.port.js';
import { CLIENT_ADDRESS_HEADER } from './auth.constants.js';
import { checkPassword, insertCredentialUser, normalizeEmail } from './credential-user.js';

export const MAX_EMAIL_LENGTH = 254;

/**
 * Thrown inside the transaction to abandon it, and never reaching the caller:
 * answering differently for an address already in use is what tells a stranger
 * who has an account here.
 */
const TAKEN = Symbol('address already registered');

/** Phone is not covered by the uniform answer; see the catch below. */
const PHONE_CONFLICT = {
  code: 'ACCOUNT_CONFLICT',
  message: 'Another InsurShield account already uses this phone number.',
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
export function registration(db: Database, sender: MailSender) {
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
              if (staff) throw TAKEN;
              // Some pre-Better-Auth customers may have a legacy, unlinked account. PostgreSQL's
              // normal unique index is case-sensitive, whereas sign-in addresses are not.
              const [legacyCustomer] = await tx
                .select({ id: customers.id })
                .from(customers)
                .where(eq(sql`lower(${customers.email})`, email));
              if (legacyCustomer) throw TAKEN;
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
            // A phone already in use still answers plainly. The user's decision
            // (2026-11-10) narrows the uniform answer to email, because doing
            // the same for phone needs ownership proved before it is reserved,
            // and that needs an SMS provider this batch does not have. Phone is
            // therefore still enumerable here, and recorded as such in the plan.
            if (isUniqueViolation(error, 'customers_phone_key')) throw new APIError('CONFLICT', PHONE_CONFLICT);
            if (error !== TAKEN && !isUniqueViolation(error)) throw error;
            user = undefined;
          }

          // Both paths send to the address and answer the same. The person who
          // owns it learns either that they have an account to confirm, or that
          // somebody tried to use their address; the person who typed it learns
          // nothing either way.
          try {
            if (user) {
              await sendVerification(ctx, user, email);
            } else {
              await sender.send({
                to: email,
                subject: 'Someone tried to register with your address',
                body:
                  'Somebody used this address to register with InsurShield, but an account already exists for it. ' +
                  'If that was you, sign in instead, or reset your password if you have forgotten it. ' +
                  'If it was not, nothing has changed and there is nothing you need to do.',
                idempotencyKey: `register-notice:${email}`,
              });
            }
          } catch (error) {
            // The account is committed if it was created; failing to send must
            // not be reported as a failed registration, and must not differ
            // between the two paths.
            logger.error(`A registration message could not be sent: ${JSON.stringify(describeDatabaseError(error))}`);
          }

          ctx.setStatus(202);
          // No session and no identifier: a cookie is observable, and there is
          // no honest cookie to give for an address that is already taken.
          return ctx.json({ checkYourEmail: true });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
}

/** The link Better Auth would have sent, built the way its own routes build it. */
async function sendVerification(
  ctx: { context: { secret: string; baseURL: string; options: Record<string, any> }; request?: Request },
  user: { id: string; email: string; name: string },
  email: string,
): Promise<void> {
  const send = ctx.context.options?.emailVerification?.sendVerificationEmail;
  if (!send) return;
  const token = await createEmailVerificationToken(
    ctx.context.secret,
    email,
    undefined,
    ctx.context.options.emailVerification?.expiresIn,
  );
  const url = `${ctx.context.baseURL}/verify-email?token=${token}&callbackURL=${encodeURIComponent('/')}`;
  await send({ user, url, token }, ctx.request);
}
