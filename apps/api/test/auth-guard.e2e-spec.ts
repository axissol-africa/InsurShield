import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { customers } from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildStaffUser } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { bearer, customerToken, signToken, staffToken } from './jwks.js';

const ME = '/api/v1/auth/me';

function newCustomer() {
  const keycloakId = randomUUID();
  return { keycloakId, email: `${keycloakId}@example.test`, fullName: 'Chanda Mwale' };
}

describe('the auth guard', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  describe('verifying the token', () => {
    it('lets a valid token through', async () => {
      const response = await testApp.http.get(ME).set(bearer(await customerToken(newCustomer()))).expect(200);

      expect(response.body.customer).toMatchObject({ fullName: 'Chanda Mwale' });
    });

    it('refuses a request without a bearer token', async () => {
      const response = await testApp.http.get(ME).expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it.each([
      ['a wrong signature', { foreignKey: true }],
      ['a wrong issuer', { issuer: 'http://127.0.0.1:1/realms/another-realm' }],
      ['a wrong audience', { audience: 'another-client' }],
      ['an expiry in the past', { expiresAt: Math.floor(Date.now() / 1000) - 60 }],
    ])('refuses a token with %s and creates no customer', async (_case, options) => {
      const customer = newCustomer();

      const response = await testApp.http.get(ME).set(bearer(await customerToken(customer, options))).expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
      const rows = await side.db.select().from(customers).where(eq(customers.keycloakId, customer.keycloakId));
      expect(rows).toEqual([]);
    });

    it('refuses a token without a subject', async () => {
      const token = await signToken({ sub: '', email: 'nobody@example.test' });

      await testApp.http.get(ME).set(bearer(token)).expect(401);
    });
  });

  describe('resolving the principal', () => {
    it('lets a provisioned, active staff member through with the role from the token', async () => {
      const { insurer, staff } = await buildInsurer(testApp.db);

      const response = await testApp.http.get(ME).set(bearer(await staffToken(staff, ['insurer_user']))).expect(200);

      expect(response.body.staffSession).toMatchObject({ id: staff.id, role: 'insurer', insurerId: insurer.id });
    });

    it('refuses a staff token with no provisioned row, and creates no customer for it', async () => {
      const keycloakId = randomUUID();

      const response = await testApp.http
        .get(ME)
        .set(bearer(await staffToken({ keycloakId, email: `${keycloakId}@example.test` }, ['admin'])))
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      const rows = await side.db.select().from(customers).where(eq(customers.keycloakId, keycloakId));
      expect(rows).toEqual([]);
    });

    it('refuses an inactive staff member', async () => {
      const staff = await buildStaffUser(testApp.db, { role: 'ADMIN', isActive: false });

      await testApp.http.get(ME).set(bearer(await staffToken(staff, ['admin']))).expect(403);
    });

    it('refuses a closed customer account', async () => {
      const customer = await buildCustomer(testApp.db, { deletedAt: new Date() });

      const response = await testApp.http.get(ME).set(bearer(await customerToken(customer))).expect(403);

      expect(response.body.message).toBe('This account has been closed.');
    });

    it('refuses an admin-only route to an insurer user', async () => {
      const { staff } = await buildInsurer(testApp.db);

      await testApp.http.get('/api/v1/admin/overview').set(bearer(await staffToken(staff, ['insurer_user']))).expect(403);
    });
  });

  describe('creating a customer on first sign-in', () => {
    let lock: PoolClient | undefined;

    afterEach(async () => {
      if (lock) {
        await lock.query('ROLLBACK');
        lock.release();
        lock = undefined;
      }
    });

    // Holding SHARE on the table blocks every INSERT into it, so the requests'
    // inserts queue up and are released together when the lock goes.
    async function holdInserts(): Promise<{ release(): Promise<void>; waiting(): Promise<number> }> {
      const client = await side.pool.connect();
      lock = client;
      await client.query('BEGIN');
      await client.query('LOCK TABLE customers IN SHARE MODE');
      return {
        waiting: async () => {
          const { rows } = await side.pool.query<{ count: string }>(
            `SELECT count(*) FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE 'insert into%customers%'`,
          );
          return Number(rows[0].count);
        },
        release: async () => {
          await client.query('COMMIT');
          client.release();
          lock = undefined;
        },
      };
    }

    async function until(condition: () => Promise<boolean>, what: string) {
      const deadline = Date.now() + 15_000;
      while (!(await condition())) {
        if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    it('creates one customer when five first requests race, and all of them succeed', async () => {
      const customer = newCustomer();
      const token = await customerToken(customer);
      const inserts = await holdInserts();

      const responses = Promise.all(
        Array.from({ length: 5 }, () => testApp.http.get(ME).set(bearer(token)).then((response) => response)),
      );
      await until(async () => (await inserts.waiting()) === 5, 'five inserts to wait on the lock');
      await inserts.release();

      const settled = await responses;
      expect(settled.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
      const rows = await side.db.select().from(customers).where(eq(customers.keycloakId, customer.keycloakId));
      expect(rows).toHaveLength(1);
      expect(new Set(settled.map((response) => response.body.customer.id))).toEqual(new Set([rows[0].id]));
    });

    it('answers 409 ACCOUNT_CONFLICT for a new sign-in with another customer’s email', async () => {
      const first = newCustomer();
      await testApp.http.get(ME).set(bearer(await customerToken(first))).expect(200);

      const response = await testApp.http
        .get(ME)
        .set(bearer(await customerToken({ ...newCustomer(), email: first.email })))
        .expect(409);

      expect(response.body).toEqual({
        code: 'ACCOUNT_CONFLICT',
        message: 'Another InsurShield account already uses this email address or phone number.',
        details: null,
      });
    });

    it('stores the email in lower case and shows no placeholder phone', async () => {
      const customer = newCustomer();

      const response = await testApp.http
        .get(ME)
        .set(bearer(await customerToken({ ...customer, email: customer.email.toUpperCase() })))
        .expect(200);

      expect(response.body.customer).toEqual({
        id: expect.any(String),
        fullName: 'Chanda Mwale',
        email: customer.email,
        phone: null,
      });
    });
  });
});
