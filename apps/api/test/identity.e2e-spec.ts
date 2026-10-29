import { randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Req } from '@nestjs/common';
import { count, eq, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { vi } from 'vitest';
import { BASE_ERROR_CODES } from 'better-auth';
import { APIError } from 'better-auth/api';
import { hashPassword } from 'better-auth/crypto';
import { AUTH } from '../src/auth/auth.constants.js';
import type { Auth } from '../src/auth/auth.instance.js';
import { SIGN_IN_LOCKED } from '../src/auth/sign-in-limit.plugin.js';
import { OptionalAuth, Public } from '../src/common/auth/auth.guard.js';
import type { Principal } from '../src/common/auth/auth.types.js';
import { errorBody } from '../src/common/errors/api.exception.js';
import { DatabaseConnectionError } from '../src/db/errors.js';
import {
  authAccounts,
  authRateLimits,
  authSessions,
  authUsers,
  authVerifications,
  consentRecords,
  customers,
  insurers,
  staffUsers,
} from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildStaffUser, TEST_PASSWORD } from './builders.js';
import { holdLocks, openTestDatabase, queueBehind, RecordingLogger, startApp, until, type TestApp } from './helpers.js';
import {
  cookiesSet,
  identityPath,
  signIn,
  signInAttempt,
  trustedOrigin,
  uniqueAddress,
  uniqueEmail,
  type SessionHeaders,
} from './sessions.js';

vi.mock('better-auth/crypto', async (original) => {
  const actual = await original<typeof import('better-auth/crypto')>();
  return { ...actual, hashPassword: vi.fn(actual.hashPassword) };
});

const ME = '/api/v1/auth/me';
const CONSENT = '/api/v1/auth/consent';
const SESSION_COOKIE = 'insurshield.session_token';
const OUR_NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found.', details: null };
const betterAuthBody = ({ code, message }: { code: string; message: string }) => ({ code, message });

@Controller('identity-probe')
class ProbeController {
  @Public()
  @Get('public')
  open(@Req() request: Request) {
    return { ip: request.ip ?? null, clientHeader: request.header('x-insurshield-client-ip') ?? null };
  }

  @OptionalAuth()
  @Get('optional')
  optional(@Req() request: Request & { principal?: Principal }) {
    return { kind: request.principal?.kind ?? 'guest' };
  }
}

function uniquePhone(): string {
  return `+26097${String(randomBytes(4).readUInt32BE() % 10_000_000).padStart(7, '0')}`;
}

function registrationBody(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Thandiwe Phiri',
    email: uniqueEmail(),
    phone: uniquePhone(),
    password: 'correct-horse-1',
    noticeVersion: 'v1',
    ...overrides,
  };
}

describe('the identity routes', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    testApp = await startApp({ controllers: [ProbeController] });
    side = openTestDatabase();
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const register = (body: unknown, http = testApp.http) =>
    http.post(identityPath('/register')).set('Origin', trustedOrigin()).send(body as object);

  const usersWithEmail = async (email: string) =>
    (await side.db.select({ n: count() }).from(authUsers).where(eq(authUsers.email, email)))[0].n;

  const rateLimitRows = async () => (await side.db.select({ n: count() }).from(authRateLimits))[0].n;

  describe('the mount', () => {
    it('hands Better Auth the raw JSON body and answers with the CORS headers of a trusted origin', async () => {
      const customer = await buildCustomer(testApp.db);

      const response = await testApp.http
        .post(identityPath('/sign-in/email'))
        .set('Origin', trustedOrigin())
        .send({ email: customer.email, password: TEST_PASSWORD })
        .expect(200);

      expect(response.body.user.id).toBe(customer.userId);
      expect(response.headers['access-control-allow-origin']).toBe(trustedOrigin());
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });

    it('serves the identity routes under the Better Auth instance’s base path, whatever prefix Nest is given', async () => {
      const moved = await startApp({ settings: { API_PREFIX: 'moved/v9' } });
      try {
        const customer = await buildCustomer(moved.db);

        const response = await moved.http
          .post(identityPath('/sign-in/email'))
          .set('Origin', trustedOrigin())
          .send({ email: customer.email, password: TEST_PASSWORD });

        expect(response.status).toBe(200);
        await moved.http.post('/moved/v9/identity/sign-in/email').send({}).expect(404);
      } finally {
        await moved.close();
      }
    });

    it('refuses a body over the limit by its Content-Length with 413, before Better Auth reads it', async () => {
      const customer = await buildCustomer(testApp.db);

      const response = await testApp.http
        .post(identityPath('/sign-in/email'))
        .set('Origin', trustedOrigin())
        .send({ email: customer.email, password: TEST_PASSWORD, padding: 'x'.repeat(9 * 1024) });

      expect(response.status).toBe(413);
      expect(response.body).toEqual({ code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.', details: null });
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('refuses a chunked body, which has no length, with 413', async () => {
      const customer = await buildCustomer(testApp.db);
      const { port } = testApp.app.getHttpServer().address() as AddressInfo;

      // The server answers on the headers and closes, so the body follows the answer and writing it may fail.
      const response = await new Promise<{ status: number; body: unknown }>((resolve, reject) => {
        let answered = false;
        const outgoing = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: identityPath('/sign-in/email'),
            headers: { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked', Origin: trustedOrigin() },
          },
          (incoming) => {
            answered = true;
            let text = '';
            incoming.on('error', reject);
            incoming.on('data', (chunk: Buffer) => (text += chunk.toString()));
            incoming.on('end', () => {
              resolve({ status: incoming.statusCode ?? 0, body: JSON.parse(text) });
              outgoing.end(`{"email":"${customer.email}","password":"${TEST_PASSWORD}"}`);
            });
          },
        );
        outgoing.on('error', (error) => {
          if (!answered) reject(error);
        });
        outgoing.flushHeaders();
      });

      expect(response).toEqual({
        status: 413,
        body: { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.', details: null },
      });
    });

    it('leaves the Nest auth routes reachable beside it', async () => {
      await testApp.http.get(ME).expect(401);
      await testApp.http.post(CONSENT).send({ noticeVersion: 'v1' }).expect(401);
    });
  });

  describe('the allow-list', () => {
    it('exposes exactly the listed endpoints of every one Better Auth defines', async () => {
      const auth = testApp.app.get<Auth>(AUTH);
      const exposed: string[] = [];
      for (const endpoint of Object.values(auth.api) as { path?: string; options?: { method?: unknown } }[]) {
        if (typeof endpoint.path !== 'string' || !endpoint.options) continue;
        const declared = endpoint.options.method;
        const methods = (Array.isArray(declared) ? declared : [declared]).flatMap((method) =>
          method === '*' || method === undefined ? ['GET', 'POST'] : [String(method)],
        );
        const url = identityPath(endpoint.path.replace(/:[^/]+/g, 'x'));
        for (const method of methods) {
          const response = await testApp.http[method.toLowerCase() as 'get' | 'post'](url).set('Origin', trustedOrigin());
          const ours = response.status === 404 && JSON.stringify(response.body) === JSON.stringify(OUR_NOT_FOUND);
          if (!ours) exposed.push(`${method} ${endpoint.path}`);
        }
      }

      expect(exposed.sort()).toEqual(
        [
          'POST /register',
          'POST /sign-in/email',
          'POST /sign-out',
          'POST /revoke-sessions',
          'POST /change-password',
          'POST /request-password-reset',
          'POST /reset-password',
          'POST /send-verification-email',
          'GET /verify-email',
        ].sort(),
      );
    });

    it.each([
      ['GET', '/get-session'],
      ['GET', '/reset-password/abc'],
      ['GET', '/callback/x'],
      ['POST', '/sign-up/email'],
      ['POST', '/sign-in/email/'],
      ['POST', '/Sign-In/email'],
      ['GET', '/sign-in/email'],
      ['PUT', '/sign-out'],
    ])('answers %s %s with 404 before Better Auth', async (method, path) => {
      const response = await testApp.http[method.toLowerCase() as 'get' | 'post' | 'put'](identityPath(path))
        .set('Origin', trustedOrigin())
        .send({});

      expect(response.status).toBe(404);
      expect(response.body).toEqual(OUR_NOT_FOUND);
    });

    it('answers a differently cased prefix with 404', async () => {
      const response = await testApp.http.post('/API/V1/IDENTITY/sign-in/email').send({}).expect(404);

      expect(response.body).toEqual(OUR_NOT_FOUND);
    });

    it.each([
      '/sign-%6Fut',
      '/sign-in%2Femail',
      '/x/%2e%2e/change-password',
      '/x/../change-password',
      '/sign-in/email/',
      '/SIGN-IN/email',
    ])('answers POST %s, sent as written, with 404 and no effect on the session', async (path) => {
      const customer = await buildCustomer(testApp.db);
      const session = await signIn(testApp.http, customer);
      const sessions = async () =>
        (await side.db.select({ n: count() }).from(authSessions).where(eq(authSessions.userId, customer.userId ?? '')))[0].n;
      const passwordHash = async () =>
        (await side.db.select({ hash: authAccounts.password }).from(authAccounts).where(eq(authAccounts.userId, customer.userId ?? '')))[0]
          .hash;
      const sessionsBefore = await sessions();
      const hashBefore = await passwordHash();
      const { port } = testApp.app.getHttpServer().address() as AddressInfo;
      const body = JSON.stringify({
        email: customer.email,
        password: TEST_PASSWORD,
        currentPassword: TEST_PASSWORD,
        newPassword: 'another-pass-1',
      });

      const response = await new Promise<{ status: number; setCookie: unknown; body: unknown }>((resolve, reject) => {
        const outgoing = httpRequest(
          {
            host: '127.0.0.1',
            port,
            method: 'POST',
            path: `${identityPath('')}${path}`,
            headers: { ...session, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
          },
          (incoming) => {
            let text = '';
            incoming.on('error', reject);
            incoming.on('data', (chunk: Buffer) => (text += chunk.toString()));
            incoming.on('end', () =>
              resolve({ status: incoming.statusCode ?? 0, setCookie: incoming.headers['set-cookie'], body: JSON.parse(text) }),
            );
          },
        );
        outgoing.on('error', reject);
        outgoing.end(body);
      });

      expect(response).toEqual({ status: 404, setCookie: undefined, body: OUR_NOT_FOUND });
      expect(await sessions()).toBe(sessionsBefore);
      expect(await passwordHash()).toBe(hashBefore);
      await testApp.http.get(ME).set(session).expect(200);
    });

    it('writes no rate-limit row for unknown paths or unlisted methods, with the limiter on', async () => {
      const limited = await startApp({ env: { AUTH_RATE_LIMIT: 'on', TRUST_PROXY_HOPS: '1' } });
      try {
        const before = await rateLimitRows();
        for (let i = 0; i < 50; i += 1) {
          await limited.http.post(identityPath(`/made-up-${i}`)).set('X-Forwarded-For', uniqueAddress()).expect(404);
        }
        await limited.http.get(identityPath('/sign-in/email')).set('X-Forwarded-For', uniqueAddress()).expect(404);
        await limited.http.delete(identityPath('/register')).set('X-Forwarded-For', uniqueAddress()).expect(404);

        expect(await rateLimitRows()).toBe(before);
      } finally {
        await limited.close();
      }
    });

    describe('with a forged forwarding header', () => {
      const forgeries: [string, (target: string) => string][] = [
        ['X-Forwarded-Proto', (target) => `http://steered.invalid${identityPath(target)}?x=`],
        ['Host', (target) => `steered.invalid${identityPath(target)}?x=`],
      ];

      it.each(forgeries)('%s cannot turn a sign-out into another route', async (header, forge) => {
        const customer = await buildCustomer(testApp.db);
        const session = await signIn(testApp.http, customer);

        const response = await testApp.http
          .post(identityPath('/sign-out'))
          .set(session)
          .set(header, forge('/update-user'))
          .send({ name: 'Steered' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ success: true });
        const [user] = await side.db.select({ name: authUsers.name }).from(authUsers).where(eq(authUsers.id, customer.userId ?? ''));
        expect(user.name).not.toBe('Steered');
        await testApp.http.get(ME).set(session).expect(401);
      });

      it.each(forgeries)('%s cannot turn a GET route into the session list', async (header, forge) => {
        const customer = await buildCustomer(testApp.db);
        const session = await signIn(testApp.http, customer);
        const own = await testApp.http.get(identityPath('/verify-email')).set(session);

        const response = await testApp.http
          .get(identityPath('/verify-email'))
          .set(session)
          .set(header, forge('/list-sessions'));

        expect(Array.isArray(response.body)).toBe(false);
        expect({ status: response.status, body: response.body }).toEqual({ status: own.status, body: own.body });
      });

      it.each(forgeries)('%s aimed at made-up paths writes no rate-limit row for them', async (header, forge) => {
        const limited = await startApp({ env: { AUTH_RATE_LIMIT: 'on', TRUST_PROXY_HOPS: '1' } });
        const steered = async () =>
          (
            await side.db
              .select({ n: count() })
              .from(authRateLimits)
              .where(sql`${authRateLimits.key} LIKE '%steered-%'`)
          )[0].n;
        try {
          const before = await steered();
          for (let i = 0; i < 5; i += 1) {
            await limited.http
              .post(identityPath('/sign-out'))
              .set('X-Forwarded-For', uniqueAddress())
              .set('Origin', trustedOrigin())
              .set(header, forge(`/steered-${i}`))
              .send({});
          }

          expect(await steered()).toBe(before);
        } finally {
          await limited.close();
        }
      });
    });
  });

  describe('the client address', () => {
    it('is left to Express on Nest routes, where the identity header is not touched', async () => {
      const proxied = await startApp({ controllers: [ProbeController], env: { TRUST_PROXY_HOPS: '1' } });
      try {
        const response = await proxied.http
          .get('/api/v1/identity-probe/public')
          .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7')
          .set('x-insurshield-client-ip', '9.9.9.9')
          .expect(200);

        expect(response.body).toEqual({ ip: '203.0.113.7', clientHeader: '9.9.9.9' });
      } finally {
        await proxied.close();
      }
    });

    it('is the one Express derived on the identity routes, whatever header the client sends', async () => {
      const proxied = await startApp({ env: { TRUST_PROXY_HOPS: '1' } });
      try {
        const customer = await buildCustomer(proxied.db);
        await proxied.http
          .post(identityPath('/sign-in/email'))
          .set('Origin', trustedOrigin())
          .set('X-Forwarded-For', '6.6.6.6, 203.0.113.8')
          .set('x-insurshield-client-ip', '9.9.9.9')
          .send({ email: customer.email, password: TEST_PASSWORD })
          .expect(200);

        const [session] = await side.db.select().from(authSessions).where(eq(authSessions.userId, customer.userId ?? ''));
        expect(session.ipAddress).toBe('203.0.113.8');
      } finally {
        await proxied.close();
      }
    });
  });

  describe('registration', () => {
    it('creates the login, customer and consent together and signs the person in', async () => {
      const body = registrationBody();

      const response = await register(body).expect(201);

      expect(response.body).toEqual({ signedIn: true, userId: expect.any(String) });
      const cookie = cookiesSet(response.headers['set-cookie']).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      expect(cookie).toBeDefined();
      const me = await testApp.http.get(ME).set('Cookie', cookie ?? '').expect(200);
      expect(me.body).toMatchObject({
        userId: response.body.userId,
        customer: { fullName: 'Thandiwe Phiri', email: body.email, phone: body.phone },
        consent: { accepted: true, noticeVersion: 'v1' },
      });
      const [account] = await side.db.select().from(authAccounts).where(eq(authAccounts.userId, response.body.userId));
      expect(account).toMatchObject({ providerId: 'credential', accountId: response.body.userId });
    });

    it('keeps the account and answers signedIn false when the session cannot be created after the commit', async () => {
      await side.pool.query(`
        CREATE OR REPLACE FUNCTION refuse_session_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW."userAgent" = 'refuse-session' THEN RAISE EXCEPTION 'refused for the test'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER refuse_session_for_test BEFORE INSERT ON auth_sessions
          FOR EACH ROW EXECUTE FUNCTION refuse_session_for_test();`);
      const body = registrationBody();
      try {
        const response = await register(body).set('User-Agent', 'refuse-session').expect(201);

        expect(response.body).toEqual({ signedIn: false, userId: expect.any(String) });
        expect(response.headers['set-cookie']).toBeUndefined();
        expect(await usersWithEmail(body.email)).toBe(1);
      } finally {
        await side.pool.query(
          'DROP TRIGGER refuse_session_for_test ON auth_sessions; DROP FUNCTION refuse_session_for_test();',
        );
      }
      await signIn(testApp.http, { email: body.email }, body.password);
    });

    it('lets one of two concurrent registrations with one email through and leaves no orphan', async () => {
      const email = uniqueEmail();
      const held = await holdLocks(side.pool, (_db, client) => client.query('LOCK TABLE auth_users IN SHARE MODE'));

      const responses = await queueBehind(held, 'insert into "auth_users"%', 2, [
        () => register(registrationBody({ email })),
        () => register(registrationBody({ email })),
      ]);

      expect(responses.map((response) => response.status).sort((x, y) => x - y)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ACCOUNT_CONFLICT');
      expect(await usersWithEmail(email)).toBe(1);
      const orphans = await side.db.execute(sql`
        SELECT u.id FROM auth_users u LEFT JOIN customers c ON c."userId" = u.id
         WHERE u.email = ${email} AND c.id IS NULL`);
      expect(orphans.rows).toEqual([]);
    });

    it('refuses another customer’s phone with the neutral conflict and leaves no login', async () => {
      const existing = await buildCustomer(testApp.db);
      const body = registrationBody({ phone: existing.phone });

      const response = await register(body).expect(409);

      expect(response.body).toEqual({
        code: 'ACCOUNT_CONFLICT',
        message: 'Another InsurShield account already uses this email address or phone number.',
      });
      expect(await usersWithEmail(body.email)).toBe(0);
    });

    it('refuses an email a staff member holds, in any letter case', async () => {
      const staff = await buildStaffUser(testApp.db);

      for (const email of [staff.email, staff.email.toUpperCase()]) {
        const response = await register(registrationBody({ email })).expect(409);
        expect(response.body.code).toBe('ACCOUNT_CONFLICT');
      }
      const linked = await side.db.select({ n: count() }).from(customers).where(eq(customers.email, staff.email));
      expect(linked[0].n).toBe(0);
    });

    it('answers a one-character password the same for a staff member’s email and any other', async () => {
      const staff = await buildStaffUser(testApp.db);

      const forStaff = await register(registrationBody({ email: staff.email, password: 'a' }));
      const forOther = await register(registrationBody({ password: 'a' }));

      expect(forStaff.status).toBe(400);
      expect({ status: forStaff.status, body: forStaff.body }).toEqual({ status: forOther.status, body: forOther.body });
    });

    it('hashes a valid password once whether the email is a staff member’s, a customer’s or new', async () => {
      const staff = await buildStaffUser(testApp.db);
      const customer = await buildCustomer(testApp.db);
      const hashes: number[] = [];

      for (const [email, status] of [
        [staff.email, 409],
        [customer.email, 409],
        [uniqueEmail(), 201],
      ] as const) {
        vi.mocked(hashPassword).mockClear();
        await register(registrationBody({ email })).expect(status);
        hashes.push(vi.mocked(hashPassword).mock.calls.length);
      }

      expect(hashes).toEqual([1, 1, 1]);
    });

    it('stores a mixed-case email in lower case, and it signs in as typed and in lower case', async () => {
      const email = `Mixed.Case-${randomBytes(4).toString('hex')}@Example.com`;

      const response = await register(registrationBody({ email })).expect(201);

      const [user] = await side.db.select().from(authUsers).where(eq(authUsers.id, response.body.userId));
      expect(user.email).toBe(email.toLowerCase());
      const [customer] = await side.db.select().from(customers).where(eq(customers.userId, user.id));
      expect(customer.email).toBe(email.toLowerCase());
      await signIn(testApp.http, { email }, 'correct-horse-1');
      await signIn(testApp.http, { email: email.toLowerCase() }, 'correct-horse-1');
    });

    it.each([
      [7, 400, 'PASSWORD_TOO_SHORT'],
      [129, 400, 'PASSWORD_TOO_LONG'],
    ])('refuses a password of %i characters', async (length, status, code) => {
      const body = registrationBody({ password: 'p'.repeat(length) });

      const response = await register(body).expect(status);

      expect(response.body.code).toBe(code);
      expect(await usersWithEmail(body.email)).toBe(0);
    });

    it.each([8, 128])('accepts a password of %i characters, which then signs in', async (length) => {
      const body = registrationBody({ password: 'p'.repeat(length) });

      await register(body).expect(201);

      await signIn(testApp.http, { email: body.email }, body.password);
    });

    it.each([
      ['an unknown field', { role: 'ADMIN' }],
      ['a malformed email', { email: 'not-an-email' }],
      ['an email over 254 characters', { email: `${'a'.repeat(250)}@example.invalid` }],
      ['an empty full name', { fullName: '' }],
      ['a short phone', { phone: '12345' }],
    ])('refuses a body with %s and writes nothing', async (_case, overrides) => {
      const body = registrationBody(overrides);

      await register(body).expect(400);

      expect(await usersWithEmail(String(body.email).toLowerCase())).toBe(0);
    });

    it('refuses a body with a missing field and writes nothing', async () => {
      const { password: _password, ...body } = registrationBody();

      await register(body).expect(400);

      expect(await usersWithEmail(body.email)).toBe(0);
    });

    it('cannot be posted by a cross-site form, and gives a foreign origin no CORS allowance', async () => {
      const body = registrationBody();
      const form = await testApp.http
        .post(identityPath('/register'))
        .set('Origin', 'https://evil.example')
        .type('form')
        .send(body);

      expect([400, 415]).toContain(form.status);
      expect(await usersWithEmail(body.email)).toBe(0);

      const json = await testApp.http.post(identityPath('/register')).set('Origin', 'https://evil.example').send(registrationBody());
      expect(json.headers['access-control-allow-origin']).toBeUndefined();
    });
  });

  describe('sessions', () => {
    const post = (path: string, session: SessionHeaders, body: object = {}) =>
      testApp.http.post(identityPath(path)).set(session).send(body);

    it('closing the account ends its sessions', async () => {
      const customer = await buildCustomer(testApp.db);
      const session = await signIn(testApp.http, customer);
      const other = await signIn(testApp.http, customer);

      await testApp.http.delete('/api/v1/account').set(session).expect(200);

      await testApp.http.get(ME).set(session).expect(401);
      await testApp.http.get(ME).set(other).expect(401);
      const left = await side.db.select().from(authSessions).where(eq(authSessions.userId, customer.userId ?? ''));
      expect(left).toEqual([]);
    });

    it('refuses sign-out, sign-out everywhere and a password change from a foreign origin', async () => {
      const customer = await buildCustomer(testApp.db);
      const session = await signIn(testApp.http, customer);
      const foreign = { ...session, Origin: 'https://evil.example' };

      await post('/sign-out', foreign).expect(403);
      await post('/revoke-sessions', foreign).expect(403);
      await post('/change-password', foreign, { currentPassword: TEST_PASSWORD, newPassword: 'another-pass-1' }).expect(403);

      await testApp.http.get(ME).set(session).expect(200);
    });

    it('ends the session on sign-out, so the old cookie answers 401', async () => {
      const customer = await buildCustomer(testApp.db);
      const session = await signIn(testApp.http, customer);

      await post('/sign-out', session).expect(200);

      await testApp.http.get(ME).set(session).expect(401);
    });

    it('ends every session of the user on sign-out everywhere', async () => {
      const customer = await buildCustomer(testApp.db);
      const first = await signIn(testApp.http, customer);
      const second = await signIn(testApp.http, customer);

      await post('/revoke-sessions', first).expect(200);

      await testApp.http.get(ME).set(first).expect(401);
      await testApp.http.get(ME).set(second).expect(401);
    });

    it.each([
      ['true', { revokeOtherSessions: true }],
      ['false', { revokeOtherSessions: false }],
      ['omitted', {}],
    ])('ends the other sessions on a password change and keeps the current one, revokeOtherSessions %s', async (_, flag) => {
      const customer = await buildCustomer(testApp.db);
      const current = await signIn(testApp.http, customer);
      const other = await signIn(testApp.http, customer);

      const response = await post('/change-password', current, {
        currentPassword: TEST_PASSWORD,
        newPassword: 'another-pass-1',
        ...flag,
      }).expect(200);

      await testApp.http.get(ME).set(other).expect(401);
      const renewed = cookiesSet(response.headers['set-cookie']).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      await testApp.http
        .get(ME)
        .set({ ...current, Cookie: renewed ?? current.Cookie })
        .expect(200);
      await signIn(testApp.http, customer, 'another-pass-1');
    });

    it('keeps the 7-day session and cookie when sign-in asks not to be remembered', async () => {
      const customer = await buildCustomer(testApp.db);
      const before = Date.now();

      const response = await testApp.http
        .post(identityPath('/sign-in/email'))
        .set('Origin', trustedOrigin())
        .send({ email: customer.email, password: TEST_PASSWORD, rememberMe: false })
        .expect(200);

      const lines = response.headers['set-cookie'] as unknown as string[];
      const line = lines.find((c) => c.startsWith(`${SESSION_COOKIE}=`)) ?? '';
      expect(line).toMatch(/Max-Age=604800(;|$)/);
      expect(lines.some((c) => c.includes('dont_remember'))).toBe(false);
      const [session] = await side.db.select().from(authSessions).where(eq(authSessions.userId, customer.userId ?? ''));
      const lifetime = session.expiresAt.getTime() - before;
      expect(lifetime).toBeGreaterThan(7 * 24 * 3600 * 1000 - 60_000);
      expect(lifetime).toBeLessThanOrEqual(7 * 24 * 3600 * 1000 + 60_000);
    });

    it('sets an http session cookie HttpOnly and SameSite=Lax without Secure', async () => {
      const response = await register(registrationBody()).expect(201);

      const line = (response.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith(`${SESSION_COOKIE}=`));
      expect(line).toMatch(/; HttpOnly/i);
      expect(line).toMatch(/; SameSite=Lax/i);
      expect(line).not.toMatch(/; Secure/i);
    });

    it('sets an https session cookie Secure with the __Secure- prefix', async () => {
      const secure = await startApp({ env: { BETTER_AUTH_URL: 'https://api.insurshield.invalid' } });
      try {
        const response = await register(registrationBody(), secure.http).expect(201);

        const line = (response.headers['set-cookie'] as unknown as string[]).find((c) =>
          c.startsWith(`__Secure-${SESSION_COOKIE}=`),
        );
        expect(line).toMatch(/; Secure/i);
        expect(line).toMatch(/; HttpOnly/i);
        expect(line).toMatch(/; SameSite=Lax/i);
      } finally {
        await secure.close();
      }
    });

    describe('with a fake clock', () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('never extends a session, which ends 7 days after sign-in, and sets no cookie meanwhile', async () => {
        const start = Date.now();
        vi.useFakeTimers({ toFake: ['Date'], now: start });
        const customer = await buildCustomer(testApp.db);
        const session = await signIn(testApp.http, customer);
        const expiresAt = async () =>
          (await side.db.select().from(authSessions).where(eq(authSessions.userId, customer.userId ?? '')))[0].expiresAt;
        const issued = await expiresAt();

        for (let day = 1; day <= 6; day += 1) {
          vi.setSystemTime(start + day * 86_400_000);
          const me = await testApp.http.get(ME).set(session).expect(200);
          const consent = await testApp.http.post(CONSENT).set(session).send({ noticeVersion: `v${day}` }).expect(200);
          expect(me.headers['set-cookie']).toBeUndefined();
          expect(consent.headers['set-cookie']).toBeUndefined();
          expect(await expiresAt()).toEqual(issued);
        }

        const auth = testApp.app.get<Auth>(AUTH);
        await auth.api.getSession({ headers: new Headers({ cookie: session.Cookie }) });
        expect(await expiresAt()).toEqual(issued);

        const stale = await testApp.http
          .get(ME)
          .set('Cookie', `${session.Cookie}; insurshield.session_data=stale`)
          .expect(200);
        expect(stale.headers['set-cookie']).toBeUndefined();

        vi.setSystemTime(start + 7 * 86_400_000 + 60_000);
        const expired = await testApp.http.get(ME).set(session).expect(401);
        expect(expired.headers['set-cookie']).toBeUndefined();
      });
    });
  });

  describe('a refused account', () => {
    const refusals: [string, (staff: { id: string; userId: string | null; insurerId: string | null }) => Promise<unknown>][] = [
      ['inactive staff', (staff) => side.db.update(staffUsers).set({ isActive: false }).where(eq(staffUsers.id, staff.id))],
      [
        'staff of a deleted insurer',
        (staff) => side.db.update(insurers).set({ status: 'DELETED' }).where(eq(insurers.id, staff.insurerId ?? '')),
      ],
      ['a user linked to staff and a customer', (staff) => buildCustomer(side.db, { userId: staff.userId })],
    ];

    async function refusedSession(refuse: (typeof refusals)[number][1]) {
      const { staff } = await buildInsurer(testApp.db);
      const session = await signIn(testApp.http, staff);
      await refuse(staff);
      return { staff, session };
    }

    const sessionsOf = async (userId: string | null) =>
      (await side.db.select({ n: count() }).from(authSessions).where(eq(authSessions.userId, userId ?? '')))[0].n;

    it.each(refusals)('cannot change the password as %s', async (_kind, refuse) => {
      const { staff, session } = await refusedSession(refuse);
      const passwordOf = async () =>
        (await side.db.select({ password: authAccounts.password }).from(authAccounts).where(eq(authAccounts.userId, staff.userId ?? '')))[0]
          .password;
      const before = await passwordOf();

      const response = await testApp.http
        .post(identityPath('/change-password'))
        .set(session)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'another-pass-1' });

      expect([401, 403]).toContain(response.status);
      expect(['UNAUTHORIZED', 'FORBIDDEN']).toContain(response.body.code);
      expect(await passwordOf()).toBe(before);
    });

    it.each(refusals)('cannot sign out everywhere as %s', async (_kind, refuse) => {
      const { staff, session } = await refusedSession(refuse);

      const response = await testApp.http.post(identityPath('/revoke-sessions')).set(session).send({});

      expect([401, 403]).toContain(response.status);
      expect(await sessionsOf(staff.userId)).toBe(1);
    });

    it.each(refusals)('can still sign out as %s', async (_kind, refuse) => {
      const { staff, session } = await refusedSession(refuse);

      await testApp.http.post(identityPath('/sign-out')).set(session).send({}).expect(200);

      expect(await sessionsOf(staff.userId)).toBe(0);
    });
  });

  describe('the mail flows outside production', () => {
    it('logs a reset link to the web page, whose token sets a new password and ends the old sessions', async () => {
      const logger = new RecordingLogger();
      const logged = await startApp({ logger });
      try {
        const customer = await buildCustomer(logged.db);
        const session = await signIn(logged.http, customer);
        const resetPage = `${trustedOrigin()}/reset-password`;

        await logged.http
          .post(identityPath('/request-password-reset'))
          .set('Origin', trustedOrigin())
          .send({ email: customer.email, redirectTo: resetPage })
          .expect(200);

        const line = logger.lines.find((entry) => entry.includes(`Password reset link for ${customer.email}`));
        const link = new URL(line?.split(': ').at(-1)?.split(' ')[0] ?? 'http://missing');
        expect(`${link.origin}${link.pathname}`).toBe(resetPage);
        const token = link.searchParams.get('token');
        expect(token).toBeTruthy();

        await logged.http
          .post(identityPath('/reset-password'))
          .set('Origin', trustedOrigin())
          .send({ token, newPassword: 'a-new-password-1' })
          .expect(200);

        await logged.http.get(ME).set(session).expect(401);
        await signIn(logged.http, customer, 'a-new-password-1');
      } finally {
        await logged.close();
      }
    });

    it.each([
      ['a relative destination', { redirectTo: '/reset-password' }, 400],
      ['no destination', {}, 400],
      ['a destination on an untrusted origin', { redirectTo: 'https://evil.example/reset-password' }, 403],
    ])('refuses a reset request with %s before any token is made', async (_case, destination, status) => {
      const customer = await buildCustomer(testApp.db);
      const tokens = async () => (await side.db.select({ n: count() }).from(authVerifications))[0].n;
      const before = await tokens();

      const response = await testApp.http
        .post(identityPath('/request-password-reset'))
        .set('Origin', trustedOrigin())
        .send({ email: customer.email, ...destination });

      expect(response.status).toBe(status);
      expect(response.body.code).toBe('INVALID_REDIRECT_URL');
      expect(await tokens()).toBe(before);
    });

    it('logs a verification link that marks the email verified', async () => {
      const logger = new RecordingLogger();
      const logged = await startApp({ logger });
      try {
        const customer = await buildCustomer(logged.db);

        await logged.http
          .post(identityPath('/send-verification-email'))
          .set('Origin', trustedOrigin())
          .send({ email: customer.email, callbackURL: `${trustedOrigin()}/account` })
          .expect(200);

        const line = logger.lines.find((entry) => entry.includes(`Email verification link for ${customer.email}`));
        const link = new URL(line?.split(': ').at(-1)?.split(' ')[0] ?? 'http://missing');
        expect(link.pathname).toBe(identityPath('/verify-email'));
        const response = await logged.http.get(`${link.pathname}${link.search}`);
        expect(response.status).toBeLessThan(400);

        const [user] = await side.db.select().from(authUsers).where(eq(authUsers.id, customer.userId ?? ''));
        expect(user.emailVerified).toBe(true);
      } finally {
        await logged.close();
      }
    });
  });

  describe('the identity precondition', () => {
    const IDENTITY_CHANGED = {
      code: 'IDENTITY_CHANGED',
      message: 'The signed-in account has changed. Reload the page to continue.',
      details: null,
    };

    async function twoPeople() {
      const a = await buildCustomer(testApp.db);
      const b = await buildCustomer(testApp.db);
      return { a, b, sessionB: await signIn(testApp.http, b) };
    }

    it.each([
      ['POST', CONSENT],
      ['DELETE', '/api/v1/account'],
      ['POST', '/api/v1/quote-requests'],
      ['POST', '/api/v1/documents'],
      ['POST', '/api/v1/inspections'],
      ['POST', '/api/v1/insurer/quote-requests/x/quote'],
      ['POST', '/api/v1/insurers'],
      ['POST', '/api/v1/payments'],
      ['PUT', '/api/v1/config/pia'],
    ])('answers %s %s with 409 when the tab is bound to someone else', async (method, path) => {
      const { a, b, sessionB } = await twoPeople();

      const response = await testApp.http[method.toLowerCase() as 'post' | 'delete' | 'put'](path)
        .set(sessionB)
        .set('X-InsurShield-User', a.userId ?? '')
        .send({ noticeVersion: 'v1' });

      expect(response.status).toBe(409);
      expect(response.body).toEqual(IDENTITY_CHANGED);
      const [closed] = await side.db.select({ deletedAt: customers.deletedAt }).from(customers).where(eq(customers.id, b.id));
      expect(closed.deletedAt).toBeNull();
      const consents = await side.db.select().from(consentRecords).where(eq(consentRecords.customerId, b.id));
      expect(consents).toEqual([]);
    });

    it.each(['/sign-out', '/revoke-sessions', '/change-password'])(
      'answers 409 on %s when the tab is bound to someone else, and the session survives',
      async (path) => {
        const { a, sessionB } = await twoPeople();

        const response = await testApp.http
          .post(identityPath(path))
          .set(sessionB)
          .set('X-InsurShield-User', a.userId ?? '')
          .send({ currentPassword: TEST_PASSWORD, newPassword: 'another-pass-1' });

        expect(response.status).toBe(409);
        expect(response.body).toEqual(IDENTITY_CHANGED);
        await testApp.http.get(ME).set(sessionB).expect(200);
      },
    );

    it('answers 409 to a user id with no session, and to GET /auth/me with a mismatched id', async () => {
      const { a, sessionB } = await twoPeople();

      await testApp.http.get(ME).set('X-InsurShield-User', a.userId ?? '').expect(409);
      await testApp.http.get(ME).set(sessionB).set('X-InsurShield-User', a.userId ?? '').expect(409);
      await testApp.http.get('/api/v1/identity-probe/public').set('X-InsurShield-User', a.userId ?? '').expect(409);
    });

    it('runs public and optional routes as a guest for anonymous, whatever the cookie', async () => {
      const { sessionB } = await twoPeople();

      const optional = await testApp.http
        .get('/api/v1/identity-probe/optional')
        .set(sessionB)
        .set('X-InsurShield-User', 'anonymous')
        .expect(200);
      expect(optional.body).toEqual({ kind: 'guest' });
      const signedIn = await testApp.http.get('/api/v1/identity-probe/optional').set(sessionB).expect(200);
      expect(signedIn.body).toEqual({ kind: 'customer' });
      await testApp.http
        .get('/api/v1/vehicles/lookup?plate=ABC1234')
        .set(sessionB)
        .set('X-InsurShield-User', 'anonymous')
        .expect(200);
    });

    it('answers 409 for anonymous on a route that needs a session', async () => {
      const { sessionB } = await twoPeople();

      await testApp.http.get(ME).set(sessionB).set('X-InsurShield-User', 'anonymous').expect(409);
      await testApp.http.get(ME).set('X-InsurShield-User', 'anonymous').expect(409);
    });

    it('answers 409 for anonymous with a session on sign-out, and the session and cookie survive', async () => {
      const { b, sessionB } = await twoPeople();

      const response = await testApp.http
        .post(identityPath('/sign-out'))
        .set(sessionB)
        .set('X-InsurShield-User', 'anonymous')
        .expect(409);

      expect(response.headers['set-cookie']).toBeUndefined();
      const sessions = await side.db.select().from(authSessions).where(eq(authSessions.userId, b.userId ?? ''));
      expect(sessions).toHaveLength(1);
      await testApp.http.get(ME).set(sessionB).expect(200);
    });

    it('decides an identity route without a session cookie with no session query', async () => {
      const auth = testApp.app.get<Auth>(AUTH);
      const getSession = vi.spyOn(auth.api, 'getSession');
      try {
        await testApp.http
          .post(identityPath('/sign-out'))
          .set('Origin', trustedOrigin())
          .set('X-InsurShield-User', 'anonymous')
          .send({})
          .expect(200);
        await testApp.http
          .post(identityPath('/sign-out'))
          .set('Origin', trustedOrigin())
          .set('X-InsurShield-User', 'someone')
          .send({})
          .expect(409);
        expect(getSession).not.toHaveBeenCalled();
      } finally {
        getSession.mockRestore();
      }
    });

    it('checks a __Secure- prefixed session cookie against its session', async () => {
      const secure = await startApp({ env: { BETTER_AUTH_URL: 'https://api.insurshield.invalid' } });
      try {
        const a = await buildCustomer(secure.db);
        const b = await buildCustomer(secure.db);
        const session = await signIn(secure.http, b);
        expect(session.Cookie).toMatch(/^__Secure-insurshield\.session_token=/);

        await secure.http.post(identityPath('/sign-out')).set(session).set('X-InsurShield-User', a.userId ?? '').expect(409);
        await secure.http.post(identityPath('/sign-out')).set(session).set('X-InsurShield-User', b.userId ?? '').expect(200);
      } finally {
        await secure.close();
      }
    });

    it('lets an absent or matching header through, and GET /auth/me names the user', async () => {
      const { b, sessionB } = await twoPeople();

      const plain = await testApp.http.get(ME).set(sessionB).expect(200);
      const matching = await testApp.http.get(ME).set(sessionB).set('X-InsurShield-User', b.userId ?? '').expect(200);

      expect(plain.body.userId).toBe(b.userId);
      expect(matching.body).toEqual(plain.body);
      await testApp.http
        .post(CONSENT)
        .set(sessionB)
        .set('X-InsurShield-User', b.userId ?? '')
        .send({ noticeVersion: 'v1' })
        .expect(200);
    });

    it('is allowed by a CORS preflight from a trusted origin', async () => {
      const response = await testApp.http
        .options(ME)
        .set('Origin', trustedOrigin())
        .set('Access-Control-Request-Method', 'GET')
        .set('Access-Control-Request-Headers', 'x-insurshield-user');

      expect(response.status).toBeLessThan(300);
      expect(response.headers['access-control-allow-headers']).toMatch(/x-insurshield-user/i);
    });
  });
});

describe('the identity rate limits', () => {
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(() => {
    side = openTestDatabase();
  });

  afterAll(async () => {
    await side.close();
  });

  const LIMITED = { AUTH_RATE_LIMIT: 'on', TRUST_PROXY_HOPS: '1' };

  const attempt = signInAttempt;

  const failureRow = async (key: string) =>
    (await side.db.execute<{ attempts: number; lockedUntil: Date | null }>(
      sql`SELECT attempts, "lockedUntil" FROM auth_sign_in_failures WHERE "emailKey" = ${key}`,
    )).rows[0];

  describe('per address', () => {
    let limited: TestApp;

    beforeAll(async () => {
      limited = await startApp({ env: LIMITED });
    });

    afterAll(async () => {
      await limited.close();
    });

    it('answers the sixth sign-in within a minute from one address with 429', async () => {
      const address = uniqueAddress();
      const statuses: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        statuses.push((await attempt(limited.http, { email: uniqueEmail(), password: 'wrong-password' }, address)).status);
      }

      expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
    });

    it('answers the fourth registration within a minute from one address with 429, whatever it carries', async () => {
      const address = uniqueAddress();
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const response = await limited.http
          .post(identityPath('/register'))
          .set('Origin', trustedOrigin())
          .set('X-Forwarded-For', address)
          .send(registrationBody());
        statuses.push(response.status);
      }

      expect(statuses).toEqual([201, 201, 201, 429]);
    });

    it('answers the fourth password change within 10 seconds from one address with 429', async () => {
      const customer = await buildCustomer(limited.db);
      const address = uniqueAddress();
      const login = await attempt(limited.http, { email: customer.email, password: TEST_PASSWORD }, address).expect(200);
      const Cookie = cookiesSet(login.headers['set-cookie']).join('; ');
      const statuses: number[] = [];
      for (let i = 0; i < 4; i += 1) {
        const response = await limited.http
          .post(identityPath('/change-password'))
          .set({ Cookie, Origin: trustedOrigin(), 'X-Forwarded-For': address })
          .send({ currentPassword: 'not-the-password', newPassword: 'another-pass-1' });
        statuses.push(response.status);
      }

      expect(statuses.slice(0, 3)).not.toContain(429);
      expect(statuses[3]).toBe(429);
    });
  });

  it('records the address the proxy appended on consent, not the proxy’s or a forged one', async () => {
    const proxied = await startApp({ env: { TRUST_PROXY_HOPS: '1' } });
    try {
      const response = await proxied.http
        .post(identityPath('/register'))
        .set({ Origin: trustedOrigin(), 'X-Forwarded-For': '6.6.6.6, 203.0.113.20' })
        .send(registrationBody())
        .expect(201);
      const [customer] = await side.db.select().from(customers).where(eq(customers.userId, response.body.userId));
      const Cookie = cookiesSet(response.headers['set-cookie']).join('; ');
      await proxied.http
        .post(CONSENT)
        .set({ Cookie, Origin: trustedOrigin(), 'X-Forwarded-For': '6.6.6.6, 203.0.113.21' })
        .send({ noticeVersion: 'v2' })
        .expect(200);

      const records = await side.db
        .select({ version: consentRecords.privacyVersion, ipAddress: consentRecords.ipAddress })
        .from(consentRecords)
        .where(eq(consentRecords.customerId, customer.id));
      expect(records.sort((x, y) => x.version.localeCompare(y.version))).toEqual([
        { version: 'v1', ipAddress: '203.0.113.20' },
        { version: 'v2', ipAddress: '203.0.113.21' },
      ]);
    } finally {
      await proxied.close();
    }
  });

  it('records the same full IPv6 address on the registration consent as on a later one', async () => {
    const proxied = await startApp({ env: { TRUST_PROXY_HOPS: '1' } });
    const address = '2001:db8:1:2:3:4:5:6';
    try {
      const response = await proxied.http
        .post(identityPath('/register'))
        .set({ Origin: trustedOrigin(), 'X-Forwarded-For': address })
        .send(registrationBody())
        .expect(201);
      const [customer] = await side.db.select().from(customers).where(eq(customers.userId, response.body.userId));
      const Cookie = cookiesSet(response.headers['set-cookie']).join('; ');
      await proxied.http
        .post(CONSENT)
        .set({ Cookie, Origin: trustedOrigin(), 'X-Forwarded-For': address })
        .send({ noticeVersion: 'v2' })
        .expect(200);

      const records = await side.db
        .select({ ipAddress: consentRecords.ipAddress })
        .from(consentRecords)
        .where(eq(consentRecords.customerId, customer.id));
      expect(records).toEqual([{ ipAddress: address }, { ipAddress: address }]);
    } finally {
      await proxied.close();
    }
  });

  describe('per email', () => {
    let limited: TestApp;
    const MINUTE = 60_000;

    beforeAll(async () => {
      limited = await startApp({ env: LIMITED });
    });

    afterAll(async () => {
      await limited.close();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const wrong = (email: string, address?: string) => attempt(limited.http, { email, password: 'wrong-password' }, address);
    const right = (email: string, address?: string) => attempt(limited.http, { email, password: TEST_PASSWORD }, address);

    async function wrongTimes(email: string, times: number) {
      for (let i = 0; i < times; i += 1) await wrong(email).expect(401);
    }

    it('locks an email for 15 minutes after 10 attempts from 10 addresses, through Better Auth’s pruning', async () => {
      const start = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: start });
      const customer = await buildCustomer(limited.db);
      const addresses = Array.from({ length: 10 }, () => uniqueAddress());
      for (const address of addresses) await wrong(customer.email, address).expect(401);

      await right(customer.email).expect(429);

      vi.setSystemTime(start + 6 * MINUTE);
      const pruned = () =>
        side.db.execute(sql`SELECT key FROM auth_rate_limits WHERE key = ${`${addresses[1]}|/sign-in/email`}`);
      expect((await pruned()).rows).toHaveLength(1);
      await right(customer.email, addresses[0]).expect(429);
      expect((await pruned()).rows).toEqual([]);

      vi.setSystemTime(start + 15 * MINUTE - 1000);
      await right(customer.email).expect(429);
      expect((await failureRow(customer.email)).lockedUntil).not.toBeNull();

      vi.setSystemTime(start + 15 * MINUTE + 1000);
      await right(customer.email).expect(200);
    });

    it('keeps a lock set late in a window after the window ends', async () => {
      const start = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: start });
      const email = uniqueEmail('late');
      await wrongTimes(email, 1);
      vi.setSystemTime(start + 14 * MINUTE);
      await wrongTimes(email, 9);

      vi.setSystemTime(start + 20 * MINUTE);
      await wrong(email).expect(429);
    });

    it('answers a known and an unknown email the same, locked and unlocked', async () => {
      const start = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: start });
      const customer = await buildCustomer(limited.db);
      const unknown = uniqueEmail('unknown');

      const knownWrong = await wrong(customer.email).expect(401);
      const unknownWrong = await wrong(unknown).expect(401);
      expect(knownWrong.body).toEqual(betterAuthBody(BASE_ERROR_CODES.INVALID_EMAIL_OR_PASSWORD));
      expect(unknownWrong.body).toEqual(knownWrong.body);

      await wrongTimes(customer.email, 9);
      await wrongTimes(unknown, 9);
      const knownLocked = await right(customer.email).expect(429);
      const unknownLocked = await right(unknown).expect(429);
      expect(unknownLocked.body).toEqual(knownLocked.body);

      vi.setSystemTime(start + 16 * MINUTE);
      await right(customer.email).expect(200);
      const afterwards = await right(unknown).expect(401);
      expect(afterwards.body).toEqual(knownWrong.body);
    });

    it('does not lock 10 attempts spread over more than 15 minutes', async () => {
      const start = Date.now();
      vi.useFakeTimers({ toFake: ['Date'], now: start });
      const customer = await buildCustomer(limited.db);
      await wrongTimes(customer.email, 1);
      vi.setSystemTime(start + MINUTE);
      await wrongTimes(customer.email, 8);

      vi.setSystemTime(start + 15 * MINUTE);
      await wrongTimes(customer.email, 1);

      await right(customer.email).expect(200);
    });

    it('clears an unlocked count on success, and never a lock', async () => {
      const customer = await buildCustomer(limited.db);
      await wrongTimes(customer.email, 5);
      await right(customer.email).expect(200);
      expect(await failureRow(customer.email)).toBeUndefined();

      await wrongTimes(customer.email, 9);
      await right(customer.email).expect(200);
      expect((await failureRow(customer.email)).lockedUntil).not.toBeNull();
      await right(customer.email).expect(429);
    });

    it('admits one of 20 attempts queued behind a held row once nine are recorded, and verifies only its password', async () => {
      const crowded = await startApp({ env: { ...LIMITED, DATABASE_POOL_SIZE: '30' } });
      const verify = vi.spyOn((await crowded.app.get<Auth>(AUTH).$context).password, 'verify');
      try {
        const customer = await buildCustomer(crowded.db);
        for (let i = 0; i < 9; i += 1) await attempt(crowded.http, { email: customer.email, password: 'wrong-password' }).expect(401);
        verify.mockClear();
        const held = await holdLocks(side.pool, (_db, client) =>
          client.query(`SELECT 1 FROM auth_sign_in_failures WHERE "emailKey" = $1 FOR UPDATE`, [customer.email]),
        );

        let verifiedWhileHeld = -1;
        const requests = Array.from({ length: 20 }, () =>
          attempt(crowded.http, { email: customer.email, password: 'wrong-password' }).then((response) => response),
        );
        try {
          await until(async () => (await held.waiters('%INSERT INTO auth_sign_in_failures%')) === 20, '20 queued admissions');
          verifiedWhileHeld = verify.mock.calls.length;
        } finally {
          await held.release();
        }
        const statuses = (await Promise.all(requests)).map((response) => response.status);

        expect(verifiedWhileHeld).toBe(0);
        expect(verify).toHaveBeenCalledTimes(1);
        expect(statuses.filter((status) => status === 401)).toHaveLength(1);
        expect(statuses.filter((status) => status === 429)).toHaveLength(19);
      } finally {
        verify.mockRestore();
        await crowded.close();
      }
    });

    describe('on a password change', () => {
      const sessionFrom = (response: { headers: Record<string, unknown> }): SessionHeaders => {
        const cookies = cookiesSet(response.headers['set-cookie'] as string[] | undefined);
        expect(cookies).not.toEqual([]);
        return { Cookie: cookies.join('; '), Origin: trustedOrigin() };
      };
      const change = (http: TestApp['http'], session: SessionHeaders, currentPassword: string, newPassword = 'another-pass-1') =>
        http
          .post(identityPath('/change-password'))
          .set(session)
          .set('X-Forwarded-For', uniqueAddress())
          .send({ currentPassword, newPassword });

      it('locks after 10 wrong current passwords, and that lock leaves signing in open', async () => {
        const customer = await buildCustomer(limited.db);
        const session = sessionFrom(await right(customer.email).expect(200));

        for (let i = 0; i < 10; i += 1) {
          const refused = await change(limited.http, session, 'wrong-password').expect(400);
          expect(refused.body).toEqual(betterAuthBody(BASE_ERROR_CODES.INVALID_PASSWORD));
        }
        const locked = await change(limited.http, session, TEST_PASSWORD).expect(429);
        expect(locked.body).toEqual(SIGN_IN_LOCKED);

        await right(customer.email).expect(200);
        await change(limited.http, session, TEST_PASSWORD).expect(429);
      });

      it('stays open to a signed-in person whose email sign-in failures locked', async () => {
        const customer = await buildCustomer(limited.db);
        const session = sessionFrom(await right(customer.email).expect(200));
        await wrongTimes(customer.email, 10);
        await right(customer.email).expect(429);

        await change(limited.http, session, TEST_PASSWORD).expect(200);
        await right(customer.email).expect(429);
      });

      it('resets only its own count when it succeeds', async () => {
        const customer = await buildCustomer(limited.db);
        const session = sessionFrom(await right(customer.email).expect(200));
        await wrongTimes(customer.email, 5);
        for (let i = 0; i < 5; i += 1) await change(limited.http, session, 'wrong-password').expect(400);

        const renewed = sessionFrom(await change(limited.http, session, TEST_PASSWORD, 'another-pass-1').expect(200));
        for (let i = 0; i < 9; i += 1) await change(limited.http, renewed, 'wrong-password').expect(400);
        await change(limited.http, renewed, 'another-pass-1', 'third-pass-1').expect(200);

        await wrongTimes(customer.email, 5);
        await attempt(limited.http, { email: customer.email, password: 'third-pass-1' }).expect(429);
      });

      it('admits one of 20 changes queued behind a held row once nine are recorded, and verifies only its password', async () => {
        const crowded = await startApp({ env: { ...LIMITED, DATABASE_POOL_SIZE: '30' } });
        const verify = vi.spyOn((await crowded.app.get<Auth>(AUTH).$context).password, 'verify');
        const keys = async () =>
          (await side.db.execute<{ emailKey: string }>(sql`SELECT "emailKey" FROM auth_sign_in_failures WHERE attempts = 9`))
            .rows.map((row) => row.emailKey);
        try {
          const customer = await buildCustomer(crowded.db);
          const session = sessionFrom(
            await attempt(crowded.http, { email: customer.email, password: TEST_PASSWORD }).expect(200),
          );
          const before = new Set(await keys());
          for (let i = 0; i < 9; i += 1) await change(crowded.http, session, 'wrong-password').expect(400);
          const recorded = (await keys()).filter((key) => !before.has(key));
          expect(recorded).toHaveLength(1);
          verify.mockClear();
          const held = await holdLocks(side.pool, (_db, client) =>
            client.query(`SELECT 1 FROM auth_sign_in_failures WHERE "emailKey" = $1 FOR UPDATE`, [recorded[0]]),
          );

          let verifiedWhileHeld = -1;
          const requests = Array.from({ length: 20 }, () =>
            change(crowded.http, session, 'wrong-password').then((response) => response),
          );
          try {
            await until(async () => (await held.waiters('%INSERT INTO auth_sign_in_failures%')) === 20, '20 queued admissions');
            verifiedWhileHeld = verify.mock.calls.length;
          } finally {
            await held.release();
          }
          const statuses = (await Promise.all(requests)).map((response) => response.status);

          expect(verifiedWhileHeld).toBe(0);
          expect(verify).toHaveBeenCalledTimes(1);
          expect(statuses.filter((status) => status === 400)).toHaveLength(1);
          expect(statuses.filter((status) => status === 429)).toHaveLength(19);
        } finally {
          verify.mockRestore();
          await crowded.close();
        }
      });
    });

    it('counts letter-case variants of one email together', async () => {
      const email = uniqueEmail('case');
      for (let i = 0; i < 5; i += 1) await wrong(email.toUpperCase()).expect(401);
      await wrongTimes(email, 5);

      await wrong(email).expect(429);
      await wrong(email.toUpperCase()).expect(429);
    });

    it('neither checks nor counts a body it cannot key, and answers as without it', async () => {
      const unlimited = await startApp();
      try {
        const long = `${'a'.repeat(243)}@example.com`;
        expect(long).toHaveLength(255);
        const before = (await side.db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM auth_sign_in_failures`)).rows[0].n;
        for (const body of [
          'null',
          '"just a string"',
          { email: 42, password: 'x' },
          { email: long, password: 'x' },
          { email: 'not-an-email', password: 'x' },
        ]) {
          const withLimit = await attempt(limited.http, body);
          const withoutLimit = await attempt(unlimited.http, body);
          expect(withLimit.status, JSON.stringify(body)).toBe(withoutLimit.status);
          expect(withLimit.status).toBeLessThan(500);
        }
        const after = (await side.db.execute<{ n: string }>(sql`SELECT count(*) AS n FROM auth_sign_in_failures`)).rows[0].n;
        expect(after).toBe(before);
      } finally {
        await unlimited.close();
      }
    });

    describe('when its statements fail', () => {
      const trigger = (name: string, event: string, key: string) =>
        side.pool.query(`
          CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
          DECLARE k text;
          BEGIN
            IF TG_OP = 'DELETE' THEN k := OLD."emailKey"; ELSE k := NEW."emailKey"; END IF;
            IF k = '${key}' THEN RAISE EXCEPTION 'refused for the test'; END IF;
            RETURN COALESCE(NEW, OLD);
          END $$;
          CREATE TRIGGER ${name} BEFORE ${event} ON auth_sign_in_failures FOR EACH ROW EXECUTE FUNCTION ${name}();`);
      const dropTrigger = (name: string) =>
        side.pool.query(`DROP TRIGGER IF EXISTS ${name} ON auth_sign_in_failures; DROP FUNCTION IF EXISTS ${name}();`);

      it('refuses the sign-in with 503 TRY_AGAIN before checking the password', async () => {
        const customer = await buildCustomer(limited.db);
        const verify = vi.spyOn((await limited.app.get<Auth>(AUTH).$context).password, 'verify');
        await trigger('refuse_admission_for_test', 'INSERT OR UPDATE', customer.email);
        try {
          const response = await right(customer.email).expect(503);

          expect(response.body.code).toBe('TRY_AGAIN');
          expect(verify).not.toHaveBeenCalled();
          const sessions = await side.db.select().from(authSessions).where(eq(authSessions.userId, customer.userId ?? ''));
          expect(sessions).toEqual([]);
        } finally {
          verify.mockRestore();
          await dropTrigger('refuse_admission_for_test');
        }
      });

      it('logs a failed reset after a success and answers the sign-in unchanged', async () => {
        const logger = new RecordingLogger();
        const logged = await startApp({ env: LIMITED, logger });
        const customer = await buildCustomer(logged.db);
        await trigger('refuse_reset_for_test', 'DELETE', customer.email);
        try {
          await attempt(logged.http, { email: customer.email, password: TEST_PASSWORD }).expect(200);

          expect(logger.text).toContain('Sign-in limit reset failed');
        } finally {
          await dropTrigger('refuse_reset_for_test');
          await logged.close();
        }
      });
    });

    it('sweeps rows whose window and lock are over, never an active lock, and logs a failed sweep', async () => {
      const now = Date.now();
      const ago = (minutes: number) => new Date(now - minutes * MINUTE);
      const rows = {
        ended: uniqueEmail('ended'),
        lockPast: uniqueEmail('lock-past'),
        lockActive: uniqueEmail('lock-active'),
        open: uniqueEmail('open'),
      };
      await side.db.execute(sql`
        INSERT INTO auth_sign_in_failures ("emailKey", attempts, "windowStartedAt", "lockedUntil") VALUES
          (${rows.ended}, 3, ${ago(20)}, NULL),
          (${rows.lockPast}, 10, ${ago(40)}, ${ago(10)}),
          (${rows.lockActive}, 10, ${ago(20)}, ${new Date(now + 5 * MINUTE)}),
          (${rows.open}, 2, ${ago(5)}, NULL)`);
      const logger = new RecordingLogger();
      const fresh = await startApp({ env: LIMITED, logger });
      try {
        for (let i = 0; i < 20; i += 1) {
          await attempt(fresh.http, { email: uniqueEmail('sweep'), password: 'wrong-password' }).expect(401);
        }

        expect(await failureRow(rows.ended)).toBeUndefined();
        expect(await failureRow(rows.lockPast)).toBeUndefined();
        expect(await failureRow(rows.lockActive)).toBeDefined();
        expect(await failureRow(rows.open)).toBeDefined();

        const stuck = uniqueEmail('stuck');
        await side.db.execute(sql`
          INSERT INTO auth_sign_in_failures ("emailKey", attempts, "windowStartedAt", "lockedUntil")
          VALUES (${stuck}, 1, ${ago(30)}, NULL)`);
        await side.pool.query(`
          CREATE OR REPLACE FUNCTION refuse_sweep_for_test() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN RAISE EXCEPTION 'refused for the test'; END $$;
          CREATE TRIGGER refuse_sweep_for_test BEFORE DELETE ON auth_sign_in_failures
            FOR EACH ROW EXECUTE FUNCTION refuse_sweep_for_test();`);
        try {
          const statuses: number[] = [];
          for (let i = 0; i < 20; i += 1) {
            statuses.push((await attempt(fresh.http, { email: uniqueEmail('sweep'), password: 'wrong-password' })).status);
          }
          expect(new Set(statuses)).toEqual(new Set([401]));
          expect(logger.text).toContain('Sign-in limit cleanup failed');
        } finally {
          await side.pool.query(
            'DROP TRIGGER refuse_sweep_for_test ON auth_sign_in_failures; DROP FUNCTION refuse_sweep_for_test();',
          );
        }
      } finally {
        await fresh.close();
      }
    });
  });
});

describe('the identity routes when the session lookup fails', () => {
  let logger: RecordingLogger;
  let logged: TestApp;

  beforeAll(async () => {
    logger = new RecordingLogger();
    logged = await startApp({ logger });
  });

  afterAll(async () => {
    await logged.close();
  });

  async function changePasswordFailingWith(failure: Error) {
    const customer = await buildCustomer(logged.db);
    const session = await signIn(logged.http, customer);
    // Better Auth's getSession wraps any failure this way (api/routes/session.mjs).
    const wrapped = APIError.from('INTERNAL_SERVER_ERROR', BASE_ERROR_CODES.FAILED_TO_GET_SESSION, { cause: failure });
    const getSession = vi.spyOn(logged.app.get<Auth>(AUTH).api, 'getSession').mockRejectedValueOnce(wrapped);
    try {
      return await logged.http
        .post(identityPath('/change-password'))
        .set(session)
        .send({ currentPassword: TEST_PASSWORD, newPassword: 'another-pass-1' });
    } finally {
      getSession.mockRestore();
    }
  }

  const linesFor = (level: string, outcome: string) =>
    logger.lines.filter((line) => line.startsWith(`${level} `) && line.includes(`POST ${identityPath('/change-password')} -> ${outcome}`));

  it('answers a retryable database failure with 503 TRY_AGAIN and Retry-After, as the API does, and logs it', async () => {
    const response = await changePasswordFailingWith(new DatabaseConnectionError(new Error('connect ECONNREFUSED SECRET')));

    expect(response.status).toBe(503);
    expect(response.headers['retry-after']).toBe('1');
    expect(response.body).toEqual(errorBody('TRY_AGAIN', 'The service is busy right now. Please try again in a moment.'));
    expect(linesFor('warn', '503 TRY_AGAIN')).toHaveLength(1);
    expect(logger.text).not.toContain('SECRET');
  });

  it('answers any other failure with the API’s 500 body, and logs it', async () => {
    const response = await changePasswordFailingWith(new Error('session store fell over'));

    expect(response.status).toBe(500);
    expect(response.headers['retry-after']).toBeUndefined();
    expect(response.body).toEqual(errorBody('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.'));
    expect(linesFor('error', '500 INTERNAL_ERROR')).toHaveLength(1);
  });
});

describe('Better Auth’s own log lines when a statement fails', () => {
  let logger: RecordingLogger;
  let logged: TestApp;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    logger = new RecordingLogger();
    logged = await startApp({ logger });
    side = openTestDatabase();
  });

  afterAll(async () => {
    await logged.close();
    await side.close();
  });

  async function refusing<T>(table: string, event: string, userId: string, run: () => Promise<T>, code = 'P0099'): Promise<T> {
    const name = `refuse_${randomBytes(4).toString('hex')}`;
    await side.pool.query(`
      CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE owner uuid;
      BEGIN
        IF TG_OP = 'DELETE' THEN owner := OLD."userId"; ELSE owner := NEW."userId"; END IF;
        IF owner = '${userId}' THEN RAISE EXCEPTION 'refused for the test' USING ERRCODE = '${code}'; END IF;
        RETURN COALESCE(NEW, OLD);
      END $$;
      CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}();`);
    try {
      return await run();
    } finally {
      await side.pool.query(`DROP TRIGGER ${name} ON ${table}; DROP FUNCTION ${name}();`);
    }
  }

  async function recording<T>(run: () => Promise<T>) {
    const from = logger.lines.length;
    const printed: string[] = [];
    const consoles = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation((...parts: unknown[]) => {
        printed.push(parts.map((part) => (part instanceof Error ? `${part.message}\n${part.stack}` : String(part))).join(' '));
      }),
    );
    try {
      const result = await run();
      return { result, text: [...logger.lines.slice(from), ...printed].join('\n') };
    } finally {
      for (const spy of consoles) spy.mockRestore();
    }
  }

  function expectNothingSecret(text: string, ...secrets: string[]) {
    expect(text).not.toContain('params:');
    expect(text).not.toContain('Failed query');
    expect(text).not.toContain('refused for the test');
    for (const secret of secrets) expect(text).not.toContain(secret);
  }

  it('logs a failed session delete on sign-out with its code, not the session token', async () => {
    const customer = await buildCustomer(logged.db);
    const session = await signIn(logged.http, customer);
    const token = decodeURIComponent(/insurshield\.session_token=([^.;]+)/.exec(session.Cookie)?.[1] ?? '');
    expect(token).not.toBe('');

    const { result, text } = await recording(() =>
      refusing('auth_sessions', 'DELETE', customer.userId ?? '', () =>
        logged.http.post(identityPath('/sign-out')).set(session).send({}),
      ),
    );

    expect(result.status).toBe(200);
    expect(text).toContain('Failed to delete session from database');
    expect(text).toContain('P0099');
    expectNothingSecret(text, token, customer.email, customer.userId ?? '');
  });

  it('answers a failed session insert on sign-in as the API does, logging its code, not the statement, even when the request names a column', async () => {
    const customer = await buildCustomer(logged.db);

    const { result, text } = await recording(() =>
      refusing('auth_sessions', 'INSERT', customer.userId ?? '', () =>
        logged.http
          .post(identityPath('/sign-in/email'))
          .set('Origin', trustedOrigin())
          .set('User-Agent', 'a column and a table that does not exist')
          .send({ email: customer.email, password: TEST_PASSWORD }),
      ),
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual(errorBody('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.'));
    expect(text).toContain('P0099');
    expectNothingSecret(text, customer.email, customer.userId ?? '', 'a column and a table');
  });

  it('answers a retryable failure inside Better Auth with 503 TRY_AGAIN and Retry-After', async () => {
    const customer = await buildCustomer(logged.db);

    const { result, text } = await recording(() =>
      refusing(
        'auth_sessions',
        'INSERT',
        customer.userId ?? '',
        () =>
          logged.http
            .post(identityPath('/sign-in/email'))
            .set('Origin', trustedOrigin())
            .send({ email: customer.email, password: TEST_PASSWORD }),
        '40001',
      ),
    );

    expect(result.status).toBe(503);
    expect(result.headers['retry-after']).toBe('1');
    expect(result.body).toEqual(errorBody('TRY_AGAIN', 'The service is busy right now. Please try again in a moment.'));
    expect(text).toContain('40001');
    expectNothingSecret(text, customer.email, customer.userId ?? '');
  });

  it('still logs Better Auth’s own refusals with their message', async () => {
    const { result, text } = await recording(() =>
      logged.http
        .post(identityPath('/sign-in/email'))
        .set('Origin', 'https://elsewhere.example')
        .send({ email: uniqueEmail('origin'), password: TEST_PASSWORD }),
    );

    expect(result.status).toBe(403);
    expect(result.body).toEqual(betterAuthBody(BASE_ERROR_CODES.INVALID_ORIGIN));
    expect(text).toMatch(/^error .*Invalid origin: https:\/\/elsewhere\.example/m);
  });

  it('logs a failed password write on change-password with its code, not the hash or the account', async () => {
    const customer = await buildCustomer(logged.db);
    const session = await signIn(logged.http, customer);

    const { result, text } = await recording(() =>
      refusing('auth_accounts', 'UPDATE', customer.userId ?? '', () =>
        logged.http
          .post(identityPath('/change-password'))
          .set(session)
          .send({ currentPassword: TEST_PASSWORD, newPassword: 'another-pass-1' }),
      ),
    );

    expect(result.status).toBe(500);
    expect(result.body).toEqual(errorBody('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.'));
    expect(text).toContain('P0099');
    expectNothingSecret(text, customer.email, customer.userId ?? '');
    expect(text).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{64}/);
  });
});
