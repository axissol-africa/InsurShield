import { BASE_ERROR_CODES } from 'better-auth';
import { hashPassword } from 'better-auth/crypto';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError, Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createDatabase } from '../db/database.module.js';
import * as schema from '../db/schema.js';
import { PASSWORD_POLICY, SESSION_LIFETIME_SECONDS } from './auth.constants.js';
import { createAuth, identityLog, type AuthSettings } from './auth.instance.js';
import { checkPassword } from './credential-user.js';

// Never connected: resolving the auth context runs no query.
const pool = new Pool({ connectionString: 'postgresql://nobody@127.0.0.1:1/never_test' });
const db = createDatabase(pool, { schema });
afterAll(() => pool.end());

const settings: AuthSettings = {
  NODE_ENV: 'test',
  API_PREFIX: 'api/v1',
  CORS_ORIGINS: ['http://localhost:5173'],
  BETTER_AUTH_SECRET: 'a-unit-test-secret-of-at-least-32-chars',
  BETTER_AUTH_URL: 'http://localhost:4000',
  AUTH_RATE_LIMIT: 'on',
};

const contextFor = (overrides: Partial<AuthSettings> = {}) => createAuth(db, { ...settings, ...overrides }).$context;

describe('the auth instance', () => {
  it('keeps the origin and CSRF checks on under NODE_ENV=test', async () => {
    const context = await contextFor();
    expect(context.skipOriginCheck).toBe(false);
    expect(context.skipCSRFCheck).toBe(false);
  });

  it('rate-limits in the database with the stated rules, and only AUTH_RATE_LIMIT=off turns it off', async () => {
    const on = await contextFor();
    expect(on.rateLimit).toMatchObject({
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/register': { window: 60, max: 3 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    });
    expect((await contextFor({ AUTH_RATE_LIMIT: 'off' })).rateLimit.enabled).toBe(false);
  });

  it('hashes and bounds passwords as createCredentialUser does', async () => {
    const context = await contextFor();
    expect(context.password.hash).toBe(hashPassword);
    expect(context.password.config).toEqual(PASSWORD_POLICY);
  });

  it('keeps sessions for a fixed 7 days, never refreshed and never cached in a cookie', async () => {
    const context = await contextFor();
    expect(context.sessionConfig.expiresIn).toBe(SESSION_LIFETIME_SECONDS);
    expect(context.options.session?.disableSessionRefresh).toBe(true);
    expect(context.options.session?.cookieCache?.enabled).toBe(false);
  });

  it('reads the client address only from the header the API sets, and makes uuid ids', async () => {
    const context = await contextFor();
    expect(context.options.advanced?.ipAddress?.ipAddressHeaders).toEqual(['x-insurshield-client-ip']);
    expect(context.options.advanced?.database?.generateId).toBe('uuid');
    expect(context.options.emailAndPassword?.disableSignUp).toBe(true);
  });

  it('names the session cookie insurshield, Secure with the __Secure- prefix only on https', async () => {
    const http = (await contextFor()).authCookies.sessionToken;
    expect(http.name).toBe('insurshield.session_token');
    expect(http.attributes).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: false });
    const https = (await contextFor({ BETTER_AUTH_URL: 'https://api.insurshield.example' })).authCookies.sessionToken;
    expect(https.name).toBe('__Secure-insurshield.session_token');
    expect(https.attributes).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true });
  });

  it('refuses Better Auth’s own sign-up even when called directly', async () => {
    const auth = createAuth(db, settings);

    await expect(
      auth.api.signUpEmail({ body: { email: 'someone@example.invalid', password: 'long-enough-1', name: 'Someone' } }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it.each([
    ['a'.repeat(PASSWORD_POLICY.minPasswordLength - 1), BASE_ERROR_CODES.PASSWORD_TOO_SHORT],
    ['a'.repeat(PASSWORD_POLICY.maxPasswordLength + 1), BASE_ERROR_CODES.PASSWORD_TOO_LONG],
  ])('refuses a password out of bounds with Better Auth’s own code and message', (password, expected) => {
    expect(() => checkPassword(password)).toThrow(
      expect.objectContaining({ body: expect.objectContaining({ code: expected.code, message: expected.message }) }),
    );
  });
});

describe('Better Auth’s log lines', () => {
  const recorder = () => ({ log: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), verbose: vi.fn() });

  function failedQuery() {
    const server = new DatabaseError('duplicate key value violates "someone@example.invalid"', 0, 'error');
    server.code = '23505';
    server.constraint = 'auth_users_email_unique';
    return new DrizzleQueryError('select "token" from "auth_sessions" where "email" = $1', ['someone@example.invalid'], server);
  }

  it.each([
    ['debug', 'debug'],
    ['info', 'log'],
    ['warn', 'warn'],
    ['error', 'error'],
  ] as const)('writes %s as the Nest %s line, with only the code of an error and no other argument', (level, nest) => {
    const logger = recorder();

    identityLog(logger)(level, 'Failed to read session from database', failedQuery(), { token: 'a-session-token' }, 'more');

    expect(logger[nest]).toHaveBeenCalledExactlyOnceWith(
      'Failed to read session from database: {"code":"23505","constraint":"auth_users_email_unique"}',
    );
    const calls = Object.values(logger).flatMap((method) => method.mock.calls);
    expect(calls).toHaveLength(1);
  });

  it('writes the message alone when no error comes with it, and only the code when the error is the message', () => {
    const logger = recorder();

    identityLog(logger)('warn', 'Rate limiting could not determine a client IP', ['10.0.0.1']);
    identityLog(logger)('error', failedQuery());

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Rate limiting could not determine a client IP');
    expect(logger.error).toHaveBeenCalledExactlyOnceWith('{"code":"23505","constraint":"auth_users_email_unique"}');
  });

  it('escapes control characters, so a value Better Auth puts in its message cannot start a line of its own', () => {
    const logger = recorder();

    identityLog(logger)('error', 'Invalid callbackURL: x\r\n[Nest] ERROR [Api] forged\u001b[31m\u009b\u2028end');

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'Invalid callbackURL: x\\u000d\\u000a[Nest] ERROR [Api] forged\\u001b[31m\\u009b\\u2028end',
    );
  });

  it('escapes the direction marks that reorder a line too, and keeps every other character whole', () => {
    const logger = recorder();

    identityLog(logger)('error', 'Invalid origin: a\u200eb\u202ec\u2066d \u{1F600} é');

    expect(logger.error).toHaveBeenCalledExactlyOnceWith('Invalid origin: a\\u200eb\\u202ec\\u2066d \u{1F600} é');
  });

  it('routes Better Auth’s own logger to it, at Better Auth’s default threshold of warn', async () => {
    const logger = recorder();
    const context = await createAuth(db, settings, logger).$context;

    context.logger.error('INTERNAL_SERVER_ERROR', failedQuery());
    context.logger.warn('Password is too short');
    context.logger.info('Falling back to regular query');
    context.logger.success('Done');
    context.logger.debug('Using provided transaction implementation');

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      'INTERNAL_SERVER_ERROR: {"code":"23505","constraint":"auth_users_email_unique"}',
    );
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith('Password is too short');
    expect(logger.log).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('has Better Auth throw a failure its router would print whole, for the identity routes to answer', async () => {
    expect((await contextFor()).options.onAPIError?.throw).toBe(true);
  });
});
