import { and, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireStaffMfa } from '../src/auth/credential-user.js';
import { identityBasePath } from '../src/auth/auth.constants.js';
import {
  auditLogs,
  authVerifications,
  supportPasswordResetAttempts,
} from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildStaffUser, TEST_PASSWORD } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { MailFake } from './mail-fake.js';
import { cookiesSet, trustedOrigin, type SessionHeaders } from './sessions.js';

const IDENTITY = identityBasePath('api/v1');
const RESET = '/api/v1/admin/customers/password-reset';
const RESET_REASON = 'Customer reported that they cannot sign in to their account.';

describe('administrator-assisted customer password resets', () => {
  const mail = new MailFake();
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp({ mail });
  });

  afterAll(async () => testApp.close());

  async function staffSession(staff: Awaited<ReturnType<typeof buildStaffUser>>): Promise<SessionHeaders> {
    await requireStaffMfa(testApp.db, staff.userId!);
    const signed = await testApp.http
      .post(`${IDENTITY}/sign-in/email`)
      .set('Origin', trustedOrigin())
      .send({ email: staff.email, password: TEST_PASSWORD })
      .expect(200);
    const pendingCookie = cookiesSet(signed.headers['set-cookie']).join('; ');
    await testApp.http
      .post(`${IDENTITY}/two-factor/send-otp`)
      .set({ Origin: trustedOrigin(), Cookie: pendingCookie })
      .send({})
      .expect(200);
    const code = mail.lastTo(staff.email)?.body.match(/\b\d{6}\b/)?.[0];
    if (!code) throw new Error('The MFA mail did not contain a code.');
    const verified = await testApp.http
      .post(`${IDENTITY}/two-factor/verify-otp`)
      .set({ Origin: trustedOrigin(), Cookie: pendingCookie })
      .send({ code })
      .expect(200);
    return { Origin: trustedOrigin(), Cookie: cookiesSet(verified.headers['set-cookie']).join('; ') };
  }

  const bodyFor = (customer: Awaited<ReturnType<typeof buildCustomer>>) => ({
    customerId: customer.id,
    confirmationEmail: customer.email,
    reason: RESET_REASON,
  });

  it('sends an expiring customer reset link after recording an auditable delivery receipt without exposing the token', async () => {
    const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const customer = await buildCustomer(testApp.db);
    const beforeMessages = mail.sent.length;

    const response = await testApp.http.post(RESET).set(await staffSession(admin)).send(bodyFor(customer)).expect(201);

    expect(response.body).toMatchObject({ id: expect.any(String), deliveryStatus: 'DELIVERED', requestedAt: expect.any(String) });
    expect(JSON.stringify(response.body)).not.toMatch(/token|reset-password/i);
    const message = mail.sent.at(-1);
    expect(mail.sent).toHaveLength(beforeMessages + 2); // MFA code plus the customer reset email.
    expect(message).toMatchObject({ to: customer.email, subject: 'Reset your InsurShield password' });
    expect(message?.body).toMatch(/reset-password\?token=[A-Za-z0-9_-]{40,}/);

    const [attempt] = await testApp.db
      .select()
      .from(supportPasswordResetAttempts)
      .where(eq(supportPasswordResetAttempts.id, response.body.id));
    expect(attempt).toMatchObject({
      customerId: customer.id,
      requestedByStaffId: admin.id,
      deliveryChannel: 'EMAIL',
      deliveryStatus: 'DELIVERED',
      deliveryProvider: 'fake',
      deliveryReference: 'fake-1',
    });
    expect(attempt.reason).toBe(RESET_REASON);
    expect(attempt.deliveredAt).toBeInstanceOf(Date);

    const [verification] = await testApp.db
      .select({ identifier: authVerifications.identifier, value: authVerifications.value, expiresAt: authVerifications.expiresAt })
      .from(authVerifications)
      .where(and(eq(authVerifications.value, customer.userId!), like(authVerifications.identifier, 'reset-password:%')));
    expect(verification).toMatchObject({ value: customer.userId });
    expect(verification.identifier).not.toContain(customer.email);
    expect(verification.expiresAt.getTime()).toBeGreaterThan(Date.now() + 55 * 60 * 1000);

    const audit = await testApp.db
      .select({ action: auditLogs.action, actorId: auditLogs.actorId, after: auditLogs.after, note: auditLogs.note })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, response.body.id));
    expect(audit).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: 'customer_password_reset.requested', actorId: admin.id,
        after: expect.objectContaining({ deliveryStatus: 'PENDING', deliveryChannel: 'EMAIL' }),
      }),
      expect.objectContaining({
        action: 'customer_password_reset.delivered', actorId: admin.id,
        after: expect.objectContaining({ deliveryStatus: 'DELIVERED', deliveryChannel: 'EMAIL' }),
      }),
    ]));
    expect(JSON.stringify(audit.map(({ after, note }) => ({ after, note })))).not.toContain(customer.email);
  });

  it('refuses an insurer support user and a mismatched confirmation without sending a customer email', async () => {
    const customer = await buildCustomer(testApp.db);
    const { staff: insurerSupport } = await buildInsurer(testApp.db, { staff: { role: 'SUPPORT' } });
    const beforeMessages = mail.sent.length;

    await testApp.http.post(RESET).set(await staffSession(insurerSupport)).send(bodyFor(customer)).expect(403);

    const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const mismatched = await testApp.http
      .post(RESET)
      .set(await staffSession(admin))
      .send({ ...bodyFor(customer), confirmationEmail: 'different@example.invalid' })
      .expect(403);
    expect(mismatched.body.code).toBe('FORBIDDEN');
    expect(mail.sent).toHaveLength(beforeMessages + 2); // Only the two staff MFA codes were sent.
    expect(await testApp.db
      .select({ id: supportPasswordResetAttempts.id })
      .from(supportPasswordResetAttempts)
      .where(eq(supportPasswordResetAttempts.customerId, customer.id))).toEqual([]);
  });

  it('enforces both per-customer and per-administrator limits inside the database-backed workflow', async () => {
    const customer = await buildCustomer(testApp.db);
    const customerLimitedAdmin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const customerSession = await staffSession(customerLimitedAdmin);
    for (let count = 0; count < 3; count += 1) {
      await testApp.http.post(RESET).set(customerSession).send(bodyFor(customer)).expect(201);
    }
    const customerLimited = await testApp.http.post(RESET).set(customerSession).send(bodyFor(customer)).expect(429);
    expect(customerLimited.body.code).toBe('PASSWORD_RESET_RATE_LIMITED');

    const staffLimitedAdmin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const staffSessionHeaders = await staffSession(staffLimitedAdmin);
    for (let count = 0; count < 5; count += 1) {
      const target = await buildCustomer(testApp.db);
      await testApp.http.post(RESET).set(staffSessionHeaders).send(bodyFor(target)).expect(201);
    }
    const sixthCustomer = await buildCustomer(testApp.db);
    const staffLimited = await testApp.http.post(RESET).set(staffSessionHeaders).send(bodyFor(sixthCustomer)).expect(429);
    expect(staffLimited.body.code).toBe('PASSWORD_RESET_RATE_LIMITED');
  });

  it('records failed delivery, removes its unused reset credential, and does not claim success', async () => {
    const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const customer = await buildCustomer(testApp.db);
    const session = await staffSession(admin);
    mail.result = { result: 'failed', retryable: false, reason: 'provider rejected the address' };
    try {
      const response = await testApp.http.post(RESET).set(session).send(bodyFor(customer)).expect(503);
      expect(response.body.code).toBe('PASSWORD_RESET_DELIVERY_FAILED');

      const [attempt] = await testApp.db
        .select()
        .from(supportPasswordResetAttempts)
        .where(eq(supportPasswordResetAttempts.customerId, customer.id));
      expect(attempt).toMatchObject({ deliveryStatus: 'FAILED', deliveredAt: null });
      expect(attempt.failedAt).toBeInstanceOf(Date);
      expect(await testApp.db
        .select({ id: authVerifications.id })
        .from(authVerifications)
        .where(and(eq(authVerifications.value, customer.userId!), like(authVerifications.identifier, 'reset-password:%')))).toEqual([]);
      expect(await testApp.db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, attempt.id), eq(auditLogs.action, 'customer_password_reset.delivery_failed')))).toHaveLength(1);
    } finally {
      mail.result = { result: 'sent', providerId: 'fake-1' };
    }
  });
});
