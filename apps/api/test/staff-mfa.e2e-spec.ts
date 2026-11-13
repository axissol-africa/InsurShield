import { and, count, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireStaffMfa } from '../src/auth/credential-user.js';
import { identityBasePath } from '../src/auth/auth.constants.js';
import { auditLogs, authSessions, authUsers } from '../src/db/schema.js';
import { buildCustomer, buildStaffUser, TEST_PASSWORD } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { MailFake } from './mail-fake.js';
import { cookiesSet, trustedOrigin } from './sessions.js';

const IDENTITY = identityBasePath('api/v1');
const ADMIN_OVERVIEW = '/api/v1/admin/overview';

describe('staff email-code MFA', () => {
  const mail = new MailFake();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp({ mail });
  });

  afterAll(async () => testApp.close());

  async function begin(email: string) {
    const signed = await testApp.http
      .post(`${IDENTITY}/sign-in/email`)
      .set('Origin', trustedOrigin())
      .send({ email, password: TEST_PASSWORD })
      .expect(200);
    expect(signed.body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ['otp'] });
    const pendingCookie = cookiesSet(signed.headers['set-cookie']).join('; ');
    await testApp.http
      .post(`${IDENTITY}/two-factor/send-otp`)
      .set({ Origin: trustedOrigin(), Cookie: pendingCookie })
      .send({})
      .expect(200);
    const message = mail.lastTo(email);
    const code = message?.body.match(/\b\d{6}\b/)?.[0];
    if (!code) throw new Error('The MFA mail did not contain a six-digit code.');
    return { pendingCookie, code };
  }

  async function complete(email: string) {
    const { pendingCookie, code } = await begin(email);
    const verified = await testApp.http
      .post(`${IDENTITY}/two-factor/verify-otp`)
      .set({ Origin: trustedOrigin(), Cookie: pendingCookie })
      .send({ code })
      .expect(200);
    return cookiesSet(verified.headers['set-cookie']).join('; ');
  }

  it('requires a staff email code, while customer password sign-in remains unchanged', async () => {
    const unconfiguredStaff = await buildStaffUser(testApp.db, { withMfa: false });
    await testApp.http
      .post(`${IDENTITY}/sign-in/email`)
      .set('Origin', trustedOrigin())
      .send({ email: unconfiguredStaff.email, password: TEST_PASSWORD })
      .expect(403);

    const staff = await buildStaffUser(testApp.db);
    await requireStaffMfa(testApp.db, staff.userId!);
    const customer = await buildCustomer(testApp.db);

    const pending = await testApp.http
      .post(`${IDENTITY}/sign-in/email`)
      .set('Origin', trustedOrigin())
      .send({ email: staff.email, password: TEST_PASSWORD })
      .expect(200);
    expect(pending.body).toMatchObject({ twoFactorRedirect: true });
    // Better Auth emits an expired session cookie to clear the password-step session. The durable
    // guarantee is that no usable server-side session exists until the code is accepted.
    const [staffSessions] = await testApp.db
      .select({ count: count() })
      .from(authSessions)
      .where(eq(authSessions.userId, staff.userId!));
    expect(staffSessions.count).toBe(0);

    const customerLogin = await testApp.http
      .post(`${IDENTITY}/sign-in/email`)
      .set('Origin', trustedOrigin())
      .send({ email: customer.email, password: TEST_PASSWORD })
      .expect(200);
    expect(customerLogin.body.twoFactorRedirect).toBeUndefined();
    expect(cookiesSet(customerLogin.headers['set-cookie']).some((cookie) => cookie.includes('session_token'))).toBe(true);
  });

  it('does not let a signed-in customer use a staff MFA endpoint to enrol a second factor', async () => {
    const customer = await buildCustomer(testApp.db);
    const signIn = await testApp.http
      .post(`${IDENTITY}/sign-in/email`)
      .set('Origin', trustedOrigin())
      .send({ email: customer.email, password: TEST_PASSWORD })
      .expect(200);

    await testApp.http
      .post(`${IDENTITY}/two-factor/send-otp`)
      .set({ Origin: trustedOrigin(), Cookie: cookiesSet(signIn.headers['set-cookie']).join('; ') })
      .send({})
      .expect(400);

    const [identity] = await testApp.db
      .select({ twoFactorEnabled: authUsers.twoFactorEnabled })
      .from(authUsers)
      .where(eq(authUsers.id, customer.userId!));
    expect(identity.twoFactorEnabled).toBe(false);
  });

  it('locks a staff account after repeated incorrect codes and never allows a trusted device bypass', async () => {
    const staff = await buildStaffUser(testApp.db);
    await requireStaffMfa(testApp.db, staff.userId!);
    const { pendingCookie } = await begin(staff.email);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await testApp.http
        .post(`${IDENTITY}/two-factor/verify-otp`)
        .set({ Origin: trustedOrigin(), Cookie: pendingCookie })
        .send({ code: '000000', trustDevice: true })
        .expect(401);
    }

    const next = await begin(staff.email);
    await testApp.http
      .post(`${IDENTITY}/two-factor/verify-otp`)
      .set({ Origin: trustedOrigin(), Cookie: next.pendingCookie })
      .send({ code: next.code, trustDevice: true })
      .expect(429);

    const entries = await testApp.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, staff.id));
    expect(entries.map((entry) => entry.action)).toEqual(expect.arrayContaining(['staff_mfa.failed', 'staff_mfa.locked']));
  });

  it('keeps at most three concurrent staff sessions', async () => {
    const staff = await buildStaffUser(testApp.db);
    await requireStaffMfa(testApp.db, staff.userId!);

    const sessions: string[] = [];
    for (let index = 0; index < 3; index += 1) sessions.push(await complete(staff.email));

    await testApp.http
      .post(`${IDENTITY}/sign-in/email`)
      .set('Origin', trustedOrigin())
      .send({ email: staff.email, password: TEST_PASSWORD })
      .expect(200);
    const [beforeCode] = await testApp.db
      .select({ count: count() })
      .from(authSessions)
      .where(eq(authSessions.userId, staff.userId!));
    expect(beforeCode.count).toBe(3);

    sessions.push(await complete(staff.email));

    const [stored] = await testApp.db
      .select({ count: count() })
      .from(authSessions)
      .where(eq(authSessions.userId, staff.userId!));
    expect(stored.count).toBe(3);

    await testApp.http.get(ADMIN_OVERVIEW).set({ Origin: trustedOrigin(), Cookie: sessions[0] }).expect(401);
  });

  it('ends a staff session after 30 minutes without activity', async () => {
    const staff = await buildStaffUser(testApp.db);
    await requireStaffMfa(testApp.db, staff.userId!);
    const session = await complete(staff.email);

    await testApp.db
      .update(authSessions)
      .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(authSessions.userId, staff.userId!));

    await testApp.http.get(ADMIN_OVERVIEW).set({ Origin: trustedOrigin(), Cookie: session }).expect(401);

    const [stored] = await testApp.db
      .select({ count: count() })
      .from(authSessions)
      .where(eq(authSessions.userId, staff.userId!));
    expect(stored.count).toBe(0);
  });

  it('also refuses an idle staff session on the identity routes', async () => {
    const staff = await buildStaffUser(testApp.db);
    await requireStaffMfa(testApp.db, staff.userId!);
    const session = await complete(staff.email);

    await testApp.db
      .update(authSessions)
      .set({ updatedAt: new Date(Date.now() - 31 * 60 * 1000) })
      .where(eq(authSessions.userId, staff.userId!));

    await testApp.http
      .post(`${IDENTITY}/revoke-sessions`)
      .set({ Origin: trustedOrigin(), Cookie: session })
      .send({})
      .expect(401);

    const [audit] = await testApp.db
      .select({ action: auditLogs.action, after: auditLogs.after })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'staff_session.expired'), eq(auditLogs.actorId, staff.id)))
      .orderBy(desc(auditLogs.createdAt))
      .limit(1);
    expect(audit).toMatchObject({ action: 'staff_session.expired', after: { expiry: 'idle' } });
  });
});
