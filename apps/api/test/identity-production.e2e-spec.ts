import './production-process.js';
import { getIP } from 'better-auth/api';
import { sql } from 'drizzle-orm';
import { AUTH } from '../src/auth/auth.constants.js';
import type { Auth } from '../src/auth/auth.instance.js';
import { buildCustomer, TEST_PASSWORD } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { identityPath, signInAttempt, trustedOrigin, uniqueAddress, uniqueEmail } from './sessions.js';

const OUR_NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found.', details: null };
const LIMITED = { AUTH_RATE_LIMIT: 'on', TRUST_PROXY_HOPS: '1' };

describe('the identity routes in production', () => {
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(() => {
    side = openTestDatabase();
  });

  afterAll(async () => {
    await side.close();
  });

  it('run where Better Auth itself sees production, so it has no local fallback address', async () => {
    const production = await startApp({ env: LIMITED });
    try {
      const auth = production.app.get<Auth>(AUTH);
      expect(getIP(new Headers(), auth.options)).toBeNull();
    } finally {
      await production.close();
    }
  });

  it('answers 404 to the mail routes in production', async () => {
    const production = await startApp({ env: LIMITED });
    try {
      for (const route of ['POST /request-password-reset', 'POST /reset-password', 'POST /send-verification-email', 'GET /verify-email']) {
        const [method, path] = route.split(' ');
        const response = await production.http[method.toLowerCase() as 'get' | 'post'](identityPath(path))
          .set('X-Forwarded-For', uniqueAddress())
          .set('Origin', trustedOrigin())
          .send({});
        expect(response.status, route).toBe(404);
        expect(response.body, route).toEqual(OUR_NOT_FOUND);
      }
    } finally {
      await production.close();
    }
  });

  describe('behind a proxy in production', () => {
    let production: TestApp;

    beforeAll(async () => {
      production = await startApp({ env: LIMITED });
    });

    afterAll(async () => {
      await production.close();
    });

    it('gives each proxied client its own sign-in bucket, which no header can change', async () => {
      const exhausted = uniqueAddress();
      const fresh = uniqueAddress();
      for (let i = 0; i < 5; i += 1) {
        await signInAttempt(production.http, { email: uniqueEmail(), password: 'wrong-password' }, exhausted).expect(401);
      }
      const customer = await buildCustomer(production.db);

      await signInAttempt(production.http, { email: customer.email, password: TEST_PASSWORD }, exhausted).expect(429);
      await signInAttempt(production.http, { email: customer.email, password: TEST_PASSWORD }, `${fresh}, ${exhausted}`).expect(429);
      await production.http
        .post(identityPath('/sign-in/email'))
        .set({ Origin: trustedOrigin(), 'X-Forwarded-For': exhausted, 'x-insurshield-client-ip': fresh })
        .send({ email: customer.email, password: TEST_PASSWORD })
        .expect(429);
      await signInAttempt(production.http, { email: customer.email, password: TEST_PASSWORD }, fresh).expect(200);

      const shared = await side.db.execute(sql`SELECT key FROM auth_rate_limits WHERE key LIKE 'no-trusted-ip%'`);
      expect(shared.rows).toEqual([]);
    });

    it('ignores a spoofed X-Forwarded-For when no proxy is trusted', async () => {
      const direct = await startApp({ env: { ...LIMITED, TRUST_PROXY_HOPS: '0' } });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 6; i += 1) {
          statuses.push((await signInAttempt(direct.http, { email: uniqueEmail(), password: 'wrong-password' })).status);
        }

        expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
      } finally {
        await direct.close();
        await side.db.execute(sql`DELETE FROM auth_rate_limits WHERE key LIKE '127.0.0.1|%' OR key LIKE '::ffff:127.0.0.1|%'`);
      }
    });
  });

});
