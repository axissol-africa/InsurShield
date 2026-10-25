import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { consentRecords } from '../src/db/schema.js';
import { buildInsurer, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';

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

  async function signedInCustomer() {
    const keycloakId = randomUUID();
    const headers = bearer(await customerToken({ keycloakId, email: `${keycloakId}@example.test`, fullName: 'Mutale Phiri' }));
    const me = await testApp.http.get(ME).set(headers).expect(200);
    return { headers, id: me.body.customer.id as string, email: `${keycloakId}@example.test` };
  }

  describe('me, for a customer', () => {
    it('returns the profile and no consent before one is accepted', async () => {
      const customer = await signedInCustomer();

      const response = await testApp.http.get(ME).set(customer.headers).expect(200);

      expect(response.body).toEqual({
        customer: { id: customer.id, fullName: 'Mutale Phiri', email: customer.email, phone: null },
        consent: { accepted: false, noticeVersion: null, acceptedAt: null },
        staffSession: null,
      });
    });
  });

  describe('me, for staff', () => {
    it('returns an insurer user’s session with the insurer name', async () => {
      const { insurer, staff } = await buildInsurer(testApp.db);

      const response = await testApp.http.get(ME).set(bearer(await staffToken(staff, ['insurer_user']))).expect(200);

      expect(response.body).toEqual({
        customer: null,
        staffSession: {
          id: staff.id,
          name: staff.fullName,
          email: staff.email,
          role: 'insurer',
          insurerId: insurer.id,
          insurerName: insurer.name,
        },
      });
    });

    it('returns an admin’s session with no insurer', async () => {
      const staff = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });

      const response = await testApp.http.get(ME).set(bearer(await staffToken(staff, ['super_admin']))).expect(200);

      expect(response.body.staffSession).toEqual({
        id: staff.id,
        name: staff.fullName,
        email: staff.email,
        role: 'admin',
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
        .set(bearer(await staffToken(staff, ['admin'])))
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
