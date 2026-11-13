import { Logger, type LoggerService } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { BASE_ERROR_CODES, betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { twoFactor } from 'better-auth/plugins/two-factor';
import type { BetterAuthPlugin } from 'better-auth/types';
import type { Env } from '../config/env.js';
import type { Database } from '../db/database.module.js';
import { describeDatabaseError } from '../db/errors.js';
import { auditLogs, authAccounts, authRateLimits, authSessions, authTwoFactors, authUsers, authVerifications, customers } from '../db/schema.js';
import {
  CLIENT_ADDRESS_HEADER,
  COOKIE_PREFIX,
  identityBasePath,
  PASSWORD_POLICY,
  PASSWORD_RESET_TOKEN_LIFETIME_SECONDS,
  SESSION_LIFETIME_SECONDS,
  STAFF_MAX_CONCURRENT_SESSIONS,
  STAFF_MFA_CHALLENGE_LIFETIME_SECONDS,
  STAFF_MFA_CODE_LIFETIME_MINUTES,
  STAFF_MFA_LOCKOUT_SECONDS,
  STAFF_MFA_MAX_CODE_ATTEMPTS,
  STAFF_SESSION_ABSOLUTE_LIFETIME_SECONDS,
} from './auth.constants.js';
import type { MailSender } from '../mail/mail.port.js';
import { identityMailer } from './identity-mailer.js';
import { resolveIdentity } from './identity.js';
import { registration } from './registration.plugin.js';
import { signInLimit } from './sign-in-limit.plugin.js';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

export type AuthSettings = Pick<
  Env,
  'NODE_ENV' | 'API_PREFIX' | 'CORS_ORIGINS' | 'BETTER_AUTH_SECRET' | 'BETTER_AUTH_URL' | 'AUTH_RATE_LIMIT'
>;

/** The one reading of these settings: the instance and the mount in front of it both take them from here. */
export function authSettings(config: ConfigService<Env, true>): AuthSettings {
  return {
    NODE_ENV: config.get('NODE_ENV', { infer: true }),
    API_PREFIX: config.get('API_PREFIX', { infer: true }),
    CORS_ORIGINS: config.get('CORS_ORIGINS', { infer: true }),
    BETTER_AUTH_SECRET: config.get('BETTER_AUTH_SECRET', { infer: true }),
    BETTER_AUTH_URL: config.get('BETTER_AUTH_URL', { infer: true }),
    AUTH_RATE_LIMIT: config.get('AUTH_RATE_LIMIT', { infer: true }),
  };
}

/** The body with these fields replaced; a body that is not an object is left for Better Auth to refuse. */
function overriding(body: unknown, fields: Record<string, unknown>) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  return { context: { body: { ...body, ...fields } } };
}

function onTrustedOrigin(url: unknown, trustedOrigins: readonly string[]): boolean {
  return typeof url === 'string' && URL.canParse(url) && trustedOrigins.includes(new URL(url).origin);
}

const NEST_LEVEL = { debug: 'debug', info: 'log', warn: 'warn', error: 'error' } as const;

/** Characters that end a line, colour it, or reorder how it reads. */
function isControl(code: number) {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    code === 0x200e ||
    code === 0x200f ||
    (code >= 0x2028 && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

function escapeControls(text: string) {
  return Array.from(text, (character) => {
    const code = character.charCodeAt(0);
    return isControl(code) ? `\\u${code.toString(16).padStart(4, '0')}` : character;
  }).join('');
}

/** Better Auth logs raw errors, whose messages carry the statement and its parameters, so only their codes are kept. */
export function identityLog(logger: LoggerService) {
  return (level: keyof typeof NEST_LEVEL, message: unknown, ...args: unknown[]) => {
    const described = [message, ...args]
      .filter((part) => part instanceof Error)
      .map((error) => JSON.stringify(describeDatabaseError(error)));
    const line = [typeof message === 'string' ? message : '', described.join(' ')].filter(Boolean).join(': ');
    // Better Auth puts request values in some messages, such as a refused callbackURL.
    logger[NEST_LEVEL[level]]?.(escapeControls(line));
  };
}

/** A staff identity with an incomplete migration/provisioning record must never fall back to password-only access. */
async function assertStaffMfaEnrollment(db: Database, userId: string): Promise<void> {
  const [enrollment] = await db
    .select({ enabled: authUsers.twoFactorEnabled, twoFactorId: authTwoFactors.id })
    .from(authUsers)
    .leftJoin(authTwoFactors, eq(authTwoFactors.userId, authUsers.id))
    .where(eq(authUsers.id, userId))
    .limit(1);
  if (enrollment?.enabled && enrollment.twoFactorId) return;
  throw new APIError('FORBIDDEN', {
    code: 'STAFF_MFA_SETUP_REQUIRED',
    message: 'This staff account is not ready for secure sign-in. Contact an administrator.',
  });
}

/** The password step creates a short-lived internal session which Better Auth removes before returning its MFA challenge. */
function staffSessionCap(db: Database): BetterAuthPlugin {
  return {
    id: 'staff-session-cap',
    hooks: {
      after: [
        {
          matcher: (context) => context.path === '/two-factor/verify-otp',
          handler: createAuthMiddleware(async (ctx) => {
            const completed = ctx.context.newSession;
            if (!completed) return;
            const identity = await resolveIdentity(db, completed.user.id);
            if (!identity.ok || identity.principal.kind !== 'staff') return;

            const sessions = await db
              .select({ id: authSessions.id })
              .from(authSessions)
              .where(eq(authSessions.userId, completed.user.id))
              .orderBy(desc(authSessions.createdAt), desc(authSessions.id));
            const excess = sessions.slice(STAFF_MAX_CONCURRENT_SESSIONS).map((candidate) => candidate.id);
            if (excess.length > 0) await db.delete(authSessions).where(inArray(authSessions.id, excess));
          }),
        },
      ],
    },
  };
}

/** Failed OTPs are security events even though their caller has not completed authentication. */
function staffMfaAudit(db: Database): BetterAuthPlugin {
  return {
    id: 'staff-mfa-audit',
    hooks: {
      after: [
        {
          matcher: (context) => context.path === '/two-factor/verify-otp',
          handler: createAuthMiddleware(async (ctx) => {
            const result = ctx.context.returned;
            if (!(result instanceof APIError)) return;
            const code = result.body?.code;
            if (code !== 'INVALID_CODE' && code !== 'ACCOUNT_TEMPORARILY_LOCKED') return;

            const cookie = ctx.context.createAuthCookie('two_factor');
            const challenge = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
            if (!challenge) return;
            const pending = await ctx.context.internalAdapter.findVerificationValue(challenge);
            if (!pending) return;
            const identity = await resolveIdentity(db, pending.value);
            if (!identity.ok || identity.principal.kind !== 'staff') return;

            await db.insert(auditLogs).values({
              actorType: 'SYSTEM',
              actorId: null,
              action: code === 'ACCOUNT_TEMPORARILY_LOCKED' ? 'staff_mfa.locked' : 'staff_mfa.failed',
              entityType: 'STAFF_USER',
              entityId: identity.principal.id,
              after: { reason: code },
              note: 'A staff email-code sign-in attempt was refused.',
              correlationId: identity.principal.id,
            });
          }),
        },
      ],
    },
  };
}

export function authOptions(
  db: Database,
  settings: AuthSettings,
  sender: MailSender,
  logger: LoggerService = new Logger('Identity'),
) {
  const rateLimited = settings.AUTH_RATE_LIMIT === 'on';
  const mailer = identityMailer(sender);
  return {
    appName: 'InsurShield',
    baseURL: settings.BETTER_AUTH_URL,
    basePath: identityBasePath(settings.API_PREFIX),
    secret: settings.BETTER_AUTH_SECRET,
    trustedOrigins: settings.CORS_ORIGINS,
    telemetry: { enabled: false },
    logger: { log: identityLog(logger) },
    // Its router would log or print an unexpected error whole; thrown, the identity routes answer and log it.
    onAPIError: { throw: true },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
        rateLimit: authRateLimits,
        twoFactor: authTwoFactors,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      ...PASSWORD_POLICY,
      resetPasswordTokenExpiresIn: PASSWORD_RESET_TOKEN_LIFETIME_SECONDS,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: mailer.sendResetPassword,
    },
    emailVerification: { sendVerificationEmail: mailer.sendVerificationEmail },
    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    rateLimit: {
      enabled: rateLimited,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/register': { window: 60, max: 3 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      useSecureCookies: new URL(settings.BETTER_AUTH_URL).protocol === 'https:',
      disableOriginCheck: false,
      disableCSRFCheck: false,
      database: { generateId: 'uuid' },
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A password change ends every other session, and every session lasts its 7 days, whatever the caller asks.
        if (ctx.path === '/change-password') return overriding(ctx.body, { revokeOtherSessions: true });
        if (ctx.path === '/sign-in/email') return overriding(ctx.body, { rememberMe: true });
        // A staff device is never trusted: a fresh email code is required at every sign-in.
        if (ctx.path === '/two-factor/send-otp' || ctx.path === '/two-factor/verify-otp') {
          return overriding(ctx.body ?? {}, { trustDevice: false });
        }
        // The mailed link is built on this page, so a reset without a usable one is refused before its token exists.
        if (ctx.path === '/request-password-reset' && !onTrustedOrigin(ctx.body?.redirectTo, settings.CORS_ORIGINS)) {
          throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.INVALID_REDIRECT_URL);
        }
      }),
    },
    databaseHooks: {
      user: {
        update: {
          /**
           * Better Auth owns `auth_users.emailVerified`; the platform's own
           * answer lives on the customer row, which is what `resolveIdentity`
           * reads and what the grandfathering migration wrote. Mirroring it
           * here keeps one authority rather than two that can disagree.
           *
           * Set only when it is not already set, so re-verifying an address
           * does not move a timestamp that an audit reads as "when this
           * customer actually proved it".
           */
          after: async (user) => {
            if (!user.emailVerified) return;
            await db
              .update(customers)
              .set({ emailVerifiedAt: new Date() })
              .where(and(eq(customers.userId, user.id), isNull(customers.emailVerifiedAt)));
          },
        },
      },
      session: {
        create: {
          // Sign-in and registration both end here, so a refused account never gets a session row.
          before: async (session) => {
            const identity = await resolveIdentity(db, session.userId);
            if (!identity.ok) {
              throw new APIError(identity.status === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN', {
                code: identity.code,
                message: identity.message,
              });
            }
            if (identity.principal.kind === 'staff') {
              await assertStaffMfaEnrollment(db, session.userId);
              return {
                data: {
                  ...session,
                  expiresAt: new Date(Date.now() + STAFF_SESSION_ABSOLUTE_LIFETIME_SECONDS * 1000),
                },
              };
            }
          },
        },
      },
    },
    plugins: [
      registration(db, sender),
      signInLimit(db, { enabled: rateLimited, logger }),
      twoFactor({
        // Only the OTP endpoints are allow-listed. TOTP, backup codes and 2FA disablement remain unreachable.
        totpOptions: { disable: true },
        otpOptions: {
          period: STAFF_MFA_CODE_LIFETIME_MINUTES,
          digits: 6,
          storeOTP: 'encrypted',
          allowedAttempts: STAFF_MFA_MAX_CODE_ATTEMPTS,
          sendOTP: mailer.sendStaffMfaCode,
        },
        twoFactorCookieMaxAge: STAFF_MFA_CHALLENGE_LIFETIME_SECONDS,
        accountLockout: {
          enabled: true,
          maxFailedAttempts: STAFF_MFA_MAX_CODE_ATTEMPTS,
          durationSeconds: STAFF_MFA_LOCKOUT_SECONDS,
        },
      }),
      staffSessionCap(db),
      staffMfaAudit(db),
    ],
  } satisfies BetterAuthOptions;
}

export function createAuth(db: Database, settings: AuthSettings, sender: MailSender, logger?: LoggerService) {
  return betterAuth(authOptions(db, settings, sender, logger));
}

export type Auth = ReturnType<typeof createAuth>;
