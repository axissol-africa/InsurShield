import { Logger, type LoggerService } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { BASE_ERROR_CODES, betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import type { Env } from '../config/env.js';
import type { Database } from '../db/database.module.js';
import { describeDatabaseError } from '../db/errors.js';
import { authAccounts, authRateLimits, authSessions, authUsers, authVerifications } from '../db/schema.js';
import {
  CLIENT_ADDRESS_HEADER,
  COOKIE_PREFIX,
  identityBasePath,
  PASSWORD_POLICY,
  SESSION_LIFETIME_SECONDS,
} from './auth.constants.js';
import { developmentMailer } from './dev-mailer.js';
import { resolveIdentity } from './identity.js';
import { registration } from './registration.plugin.js';
import { signInLimit } from './sign-in-limit.plugin.js';

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

export function authOptions(db: Database, settings: AuthSettings, logger: LoggerService = new Logger('Identity')) {
  const rateLimited = settings.AUTH_RATE_LIMIT === 'on';
  const mailer = developmentMailer(logger, settings.NODE_ENV);
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
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      requireEmailVerification: false,
      ...PASSWORD_POLICY,
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
        // The mailed link is built on this page, so a reset without a usable one is refused before its token exists.
        if (ctx.path === '/request-password-reset' && !onTrustedOrigin(ctx.body?.redirectTo, settings.CORS_ORIGINS)) {
          throw APIError.from('BAD_REQUEST', BASE_ERROR_CODES.INVALID_REDIRECT_URL);
        }
      }),
    },
    databaseHooks: {
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
          },
        },
      },
    },
    plugins: [registration(db), signInLimit(db, { enabled: rateLimited, logger })],
  } satisfies BetterAuthOptions;
}

export function createAuth(db: Database, settings: AuthSettings, logger?: LoggerService) {
  return betterAuth(authOptions(db, settings, logger));
}

export type Auth = ReturnType<typeof createAuth>;
