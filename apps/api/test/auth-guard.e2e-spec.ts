import { eq } from 'drizzle-orm';
import { authSessions, customers, insurers, staffUsers } from '../src/db/schema.js';
import { buildClaim, buildCustomer, buildInsurer, buildStaffUser, TEST_PASSWORD } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { cookiesSet, identityPath, signIn, trustedOrigin } from './sessions.js';

const ME = '/api/v1/auth/me';
const CONSENT = '/api/v1/auth/consent';
const CLAIMS = '/api/v1/insurer/claims';

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

  const sessionsOf = (userId: string | null) =>
    side.db.select().from(authSessions).where(eq(authSessions.userId, userId ?? ''));

  function signInAnswer(email: string) {
    return testApp.http
      .post(identityPath('/sign-in/email'))
      .set('Origin', trustedOrigin())
      .send({ email, password: TEST_PASSWORD });
  }

  describe('reading the session', () => {
    it('lets a signed-in customer through', async () => {
      const customer = await buildCustomer(testApp.db, { fullName: 'Chanda Mwale' });

      const response = await testApp.http.get(ME).set(await signIn(testApp.http, customer)).expect(200);

      expect(response.body.customer).toMatchObject({ id: customer.id, fullName: 'Chanda Mwale' });
    });

    it('refuses a request without a session cookie', async () => {
      const response = await testApp.http.get(ME).expect(401);

      expect(response.body.code).toBe('UNAUTHORIZED');
    });

    it('refuses a forged or tampered session cookie', async () => {
      const customer = await buildCustomer(testApp.db);
      const { Cookie } = await signIn(testApp.http, customer);
      const [name, value] = Cookie.split('=');
      const last = value.at(-1) === 'A' ? 'B' : 'A';

      await testApp.http.get(ME).set('Cookie', `${name}=${value.slice(0, -1)}${last}`).expect(401);
      await testApp.http.get(ME).set('Cookie', `${name}=forged.value`).expect(401);
    });

    it('never sets a cookie, for a valid, missing or expired session', async () => {
      const customer = await buildCustomer(testApp.db);
      const session = await signIn(testApp.http, customer);
      const valid = await testApp.http.get(ME).set(session).expect(200);
      const missing = await testApp.http.get(ME).expect(401);
      await side.db
        .update(authSessions)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(authSessions.userId, customer.userId ?? ''));
      const expired = await testApp.http.get(ME).set(session).expect(401);

      for (const response of [valid, missing, expired]) {
        expect(response.headers['set-cookie']).toBeUndefined();
      }
    });

    it('answers 401 to an invalid cookie planted before sign-in, which sign-in does not adopt', async () => {
      const customer = await buildCustomer(testApp.db);
      const planted = 'insurshield.session_token=planted.value';

      const response = await testApp.http
        .post(identityPath('/sign-in/email'))
        .set('Origin', trustedOrigin())
        .set('Cookie', planted)
        .send({ email: customer.email, password: TEST_PASSWORD })
        .expect(200);

      const issued = cookiesSet(response.headers['set-cookie']).find((cookie) =>
        cookie.startsWith('insurshield.session_token='),
      );
      expect(issued).toBeDefined();
      expect(issued).not.toBe(planted);
      await testApp.http.get(ME).set('Cookie', planted).expect(401);
      await testApp.http.get(ME).set('Cookie', issued ?? '').expect(200);
    });

    it('issues a new session when B signs in over A’s valid session, and A’s cookie stays A’s', async () => {
      const a = await buildCustomer(testApp.db);
      const b = await buildCustomer(testApp.db);
      const planted = await signIn(testApp.http, a);

      const response = await testApp.http
        .post(identityPath('/sign-in/email'))
        .set(planted)
        .send({ email: b.email, password: TEST_PASSWORD })
        .expect(200);

      const issued = cookiesSet(response.headers['set-cookie']).find((cookie) =>
        cookie.startsWith('insurshield.session_token='),
      );
      expect(issued).toBeDefined();
      expect(issued).not.toBe(planted.Cookie);
      const asB = await testApp.http.get(ME).set({ ...planted, Cookie: issued ?? '' }).expect(200);
      expect(asB.body.userId).toBe(b.userId);
      const asA = await testApp.http.get(ME).set(planted).expect(200);
      expect(asA.body.userId).toBe(a.userId);
    });
  });

  describe('resolving the principal', () => {
    it.each([
      ['ADMIN', false],
      ['SUPER_ADMIN', true],
    ] as const)('takes the %s role from the staff row', async (role, isSuperAdmin) => {
      const staff = await buildStaffUser(testApp.db, { role });

      const response = await testApp.http.get(ME).set(await signIn(testApp.http, staff)).expect(200);

      expect(response.body.staffSession).toMatchObject({ id: staff.id, role: 'admin', isSuperAdmin });
    });

    it('takes an insurer user’s role and insurer from the staff row', async () => {
      const { insurer, staff } = await buildInsurer(testApp.db);

      const response = await testApp.http.get(ME).set(await signIn(testApp.http, staff)).expect(200);

      expect(response.body.staffSession).toMatchObject({
        id: staff.id,
        role: 'insurer',
        isSuperAdmin: false,
        insurerId: insurer.id,
      });
    });

    it('applies a changed role on the next request of the same session', async () => {
      const staff = await buildStaffUser(testApp.db, { role: 'ADMIN' });
      const session = await signIn(testApp.http, staff);
      await testApp.http.get('/api/v1/admin/overview').set(session).expect(200);

      await side.db.update(staffUsers).set({ role: 'INSURER_USER' }).where(eq(staffUsers.id, staff.id));

      await testApp.http.get('/api/v1/admin/overview').set(session).expect(403);
      const me = await testApp.http.get(ME).set(session).expect(200);
      expect(me.body.staffSession.role).toBe('insurer');
    });

    it('refuses an admin-only route to an insurer user', async () => {
      const { staff } = await buildInsurer(testApp.db);

      await testApp.http.get('/api/v1/admin/overview').set(await signIn(testApp.http, staff)).expect(403);
    });

    it('applies a changed insurer on the next request of the same session, to the records it reaches', async () => {
      const former = await buildInsurer(testApp.db);
      const next = await buildInsurer(testApp.db);
      const formerClaim = await buildClaim(testApp.db, { insurerId: former.insurer.id });
      const nextClaim = await buildClaim(testApp.db, { insurerId: next.insurer.id });
      const session = await signIn(testApp.http, former.staff);
      const claimNumbers = async () =>
        ((await testApp.http.get(CLAIMS).set(session).expect(200)).body as { claimNumber: string }[]).map(
          (claim) => claim.claimNumber,
        );
      expect(await claimNumbers()).toEqual([formerClaim.claimNumber]);

      await side.db.update(staffUsers).set({ insurerId: next.insurer.id }).where(eq(staffUsers.id, former.staff.id));

      expect(await claimNumbers()).toEqual([nextClaim.claimNumber]);
      const me = await testApp.http.get(ME).set(session).expect(200);
      expect(me.body.staffSession.insurerId).toBe(next.insurer.id);
    });
  });

  describe('refusing accounts', () => {
    it('refuses a closed customer’s sign-in with ACCOUNT_CLOSED and writes no session', async () => {
      const customer = await buildCustomer(testApp.db, { deletedAt: new Date() });

      const response = await signInAnswer(customer.email).expect(403);

      expect(response.body.message).toBe('This account has been closed.');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await sessionsOf(customer.userId)).toEqual([]);
    });

    it('refuses an existing session once the customer is closed', async () => {
      const customer = await buildCustomer(testApp.db);
      const session = await signIn(testApp.http, customer);

      await side.db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, customer.id));

      const response = await testApp.http.get(ME).set(session).expect(403);
      expect(response.body.message).toBe('This account has been closed.');
    });

    it('refuses an inactive staff member’s sign-in and their existing session', async () => {
      const staff = await buildStaffUser(testApp.db);
      const session = await signIn(testApp.http, staff);
      await side.db.update(staffUsers).set({ isActive: false }).where(eq(staffUsers.id, staff.id));

      await signInAnswer(staff.email).expect(403);
      await testApp.http.get(ME).set(session).expect(403);
      expect(await sessionsOf(staff.userId)).toHaveLength(1);
    });

    it('refuses staff of a deleted insurer until the insurer is restored', async () => {
      const { insurer, staff } = await buildInsurer(testApp.db);
      const session = await signIn(testApp.http, staff);
      await side.db.update(insurers).set({ status: 'DELETED' }).where(eq(insurers.id, insurer.id));

      await signInAnswer(staff.email).expect(403);
      expect(await sessionsOf(staff.userId)).toHaveLength(1);
      await testApp.http.get(ME).set(session).expect(403);

      await side.db.update(insurers).set({ status: 'INACTIVE' }).where(eq(insurers.id, insurer.id));

      await testApp.http.get(ME).set(session).expect(200);
      await signInAnswer(staff.email).expect(200);
    });

    it('refuses a user with no customer or staff row at sign-in, writing no session', async () => {
      const customer = await buildCustomer(testApp.db);
      await side.db.delete(customers).where(eq(customers.id, customer.id));

      await signInAnswer(customer.email).expect(401);
      expect(await sessionsOf(customer.userId)).toEqual([]);
    });

    it('refuses a user linked to both a customer and a staff row, at sign-in and on an older session', async () => {
      const customer = await buildCustomer(testApp.db);
      const session = await signIn(testApp.http, customer);
      await buildStaffUser(testApp.db, { userId: customer.userId });

      await testApp.http.get(ME).set(session).expect(401);
      await signInAnswer(customer.email).expect(401);
      expect(await sessionsOf(customer.userId)).toHaveLength(1);
    });
  });

  describe('cross-site writes with the session cookie', () => {
    const notice = { noticeVersion: 'v1' };

    it.each([
      ['a trusted Origin', { Origin: 'TRUSTED' }, 200],
      ['no Origin with Sec-Fetch-Site same-origin', { 'Sec-Fetch-Site': 'same-origin' }, 200],
      ['a foreign Origin', { Origin: 'https://evil.example' }, 403],
      ['Origin null', { Origin: 'null', 'Sec-Fetch-Site': 'same-origin' }, 403],
      ['Sec-Fetch-Site cross-site', { 'Sec-Fetch-Site': 'cross-site' }, 403],
      ['neither header', {}, 403],
    ])('with %s answers %i', async (_case, headers: Record<string, string>, status) => {
      const customer = await buildCustomer(testApp.db);
      const { Cookie } = await signIn(testApp.http, customer);
      const sent = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [name, value === 'TRUSTED' ? trustedOrigin() : value]),
      );

      await testApp.http.post(CONSENT).set('Cookie', Cookie).set(sent).send(notice).expect(status);
    });

    it('refuses a cross-site multipart upload and stores nothing', async () => {
      const customer = await buildCustomer(testApp.db);
      const { Cookie } = await signIn(testApp.http, customer);

      const response = await testApp.http
        .post('/api/v1/documents')
        .set('Cookie', Cookie)
        .set('Origin', 'https://evil.example')
        .field('kind', 'CLAIM_ATTACHMENT')
        .attach('file', Buffer.from('%PDF-1.4'), { filename: 'a.pdf', contentType: 'application/pdf' })
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(testApp.storage.objects.size).toBe(0);
    });

    it('leaves a request without a cookie to answer as before', async () => {
      await testApp.http.post(CONSENT).set('Origin', 'https://evil.example').send(notice).expect(401);
    });
  });
});
