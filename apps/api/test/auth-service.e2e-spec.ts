import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { consentRecords } from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const ME = '/api/v1/auth/me';
const CONSENT = '/api/v1/auth/consent';
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('the auth service', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function signedInCustomer(overrides: Parameters<typeof buildCustomer>[1] = {}) {
    const customer = await buildCustomer(testApp.db, { fullName: 'Mutale Phiri', ...overrides });
    return { headers: await signIn(testApp.http, customer), id: customer.id, email: customer.email, customer };
  }

  describe('me, for a customer', () => {
    it('returns the profile and no consent before one is accepted', async () => {
      const customer = await signedInCustomer();

      const response = await testApp.http.get(ME).set(customer.headers).expect(200);

      expect(response.body).toEqual({
        userId: customer.customer.userId,
        customer: { id: customer.id, fullName: 'Mutale Phiri', email: customer.email, phone: customer.customer.phone },
        consent: { accepted: false, noticeVersion: null, acceptedAt: null },
        staffSession: null,
      });
    });

    it('shows no phone for a customer still holding the old placeholder', async () => {
      const customer = await signedInCustomer({ phone: `pending:${randomUUID()}` });

      const response = await testApp.http.get(ME).set(customer.headers).expect(200);

      expect(response.body.customer.phone).toBeNull();
    });
  });

  describe('me, for staff', () => {
    it('returns an insurer user’s session with the insurer name', async () => {
      const { insurer, staff } = await buildInsurer(testApp.db);

      const response = await testApp.http.get(ME).set(await signIn(testApp.http, staff)).expect(200);

      expect(response.body).toEqual({
        userId: staff.userId,
        customer: null,
        staffSession: {
          id: staff.id,
          name: staff.fullName,
          email: staff.email,
          role: 'insurer',
          isSuperAdmin: false,
          insurerId: insurer.id,
          insurerName: insurer.name,
        },
      });
    });

    it.each([
      ['SUPER_ADMIN', true],
      ['ADMIN', false],
    ] as const)('returns a %s’s session with no insurer', async (role, isSuperAdmin) => {
      const staff = await buildStaffUser(testApp.db, { role });

      const response = await testApp.http.get(ME).set(await signIn(testApp.http, staff)).expect(200);

      expect(response.body.staffSession).toEqual({
        id: staff.id,
        name: staff.fullName,
        email: staff.email,
        role: 'admin',
        isSuperAdmin,
        insurerId: null,
        insurerName: null,
      });
    });
  });

  describe('accepting consent', () => {
    it('refuses a staff member', async () => {
      const staff = await buildStaffUser(testApp.db, { role: 'ADMIN' });

      const response = await testApp.http
        .post(CONSENT)
        .set(await signIn(testApp.http, staff))
        .send({ noticeVersion: '2026-10' })
        .expect(403);

      expect(response.body.message).toBe('Only a customer account can accept these terms.');
    });

    it('records the acceptance with the request context and returns it', async () => {
      const customer = await signedInCustomer();

      const response = await testApp.http
        .post(CONSENT)
        .set(customer.headers)
        .set('User-Agent', 'e2e-agent')
        .send({ noticeVersion: '2026-10' })
        .expect(200);

      expect(response.body).toEqual({ accepted: true, noticeVersion: '2026-10', acceptedAt: expect.stringMatching(ISO_MS) });
      const rows = await testApp.db.select().from(consentRecords).where(eq(consentRecords.customerId, customer.id));
      expect(rows).toEqual([
        expect.objectContaining({ privacyVersion: '2026-10', termsVersion: '2026-10', userAgent: 'e2e-agent' }),
      ]);
      expect(rows[0].ipAddress).toEqual(expect.any(String));
    });

    it('keeps every acceptance and reports the latest on me', async () => {
      const customer = await signedInCustomer();
      await testApp.http.post(CONSENT).set(customer.headers).send({ noticeVersion: '2026-01' }).expect(200);
      const latest = await testApp.http.post(CONSENT).set(customer.headers).send({ noticeVersion: '2026-10' }).expect(200);

      const response = await testApp.http.get(ME).set(customer.headers).expect(200);

      expect(response.body.consent).toEqual({
        accepted: true,
        noticeVersion: '2026-10',
        acceptedAt: latest.body.acceptedAt,
      });
      const rows = await testApp.db.select().from(consentRecords).where(eq(consentRecords.customerId, customer.id));
      expect(rows).toHaveLength(2);
    });

    it('refuses an empty notice version', async () => {
      const customer = await signedInCustomer();

      const response = await testApp.http.post(CONSENT).set(customer.headers).send({ noticeVersion: '' }).expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
    });
  });
});
