import { eq } from 'drizzle-orm';
import { customers } from '../src/db/schema.js';
import { buildCustomer, buildStaffUser } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

/**
 * The gate is fail-closed: an authenticated route is shut to a customer who has
 * not proved their address unless it is marked `@AllowUnverified`. These check
 * both halves, because a change that quietly opened it would otherwise pass —
 * every other spec builds a verified customer.
 */
describe('the verified-email gate', () => {
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

  const unverified = () => buildCustomer(testApp.db, { emailVerifiedAt: null });

  it('refuses a protected record to a customer who has not proved their address', async () => {
    const customer = await unverified();
    const session = await signIn(testApp.http, customer);

    const response = await testApp.http.get('/api/v1/policies').set(session).expect(403);

    expect(response.body).toEqual({
      code: 'EMAIL_NOT_VERIFIED',
      message: 'Confirm your email address to continue.',
      details: null,
    });
  });

  it.each(['/api/v1/quote-requests', '/api/v1/claims', '/api/v1/ncd/applications'])(
    'refuses %s too, because the gate is on the guard rather than on one route',
    async (path) => {
      const customer = await unverified();

      await testApp.http.get(path).set(await signIn(testApp.http, customer)).expect(403);
    },
  );

  it('still serves the route the browser needs to discover it must prompt', async () => {
    const customer = await unverified();

    const response = await testApp.http.get('/api/v1/auth/me').set(await signIn(testApp.http, customer)).expect(200);

    expect(response.body).toMatchObject({ customer: { email: customer.email } });
  });

  it('serves everything once the address is proved', async () => {
    const customer = await unverified();
    const session = await signIn(testApp.http, customer);
    await testApp.http.get('/api/v1/policies').set(session).expect(403);

    await side.db.update(customers).set({ emailVerifiedAt: new Date() }).where(eq(customers.id, customer.id));

    await testApp.http.get('/api/v1/policies').set(session).expect(200);
  });

  it('leaves staff alone, who are provisioned rather than registered', async () => {
    // Staff have no verification state at all. The gate must not invent one
    // from its absence and lock the portal out.
    const staff = await buildStaffUser(testApp.db, { role: 'ADMIN' });

    await testApp.http.get('/api/v1/insurers').set(await signIn(testApp.http, staff)).expect(200);
  });
});
