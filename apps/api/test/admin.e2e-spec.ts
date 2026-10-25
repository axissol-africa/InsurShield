import { randomInt, randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { MAX_NGWEE } from '../src/common/domain/money-limits.js';
import { parseKwacha } from '../src/common/money.js';
import { payments, vehicles } from '../src/db/schema.js';
import { buildClaim, buildCustomer, buildInsurer, buildPayment, buildQuoteRequest, buildStaffUser, type Row } from './builders.js';
import {
  buildConfirmedPayments,
  buildConsent,
  buildPaymentTarget,
  buildSoldPolicy,
  type PaymentTarget,
} from './builders/admin.js';
import { buildNcdApplication } from './builders/customer.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';
import type { staffUsers } from '../src/db/schema.js';

const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const TWO_DECIMALS = /^\d+(\.\d{1,2})?$/;
const LUSAKA_MONTH = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lusaka', year: 'numeric', month: '2-digit' });
const LONG_AGO = new Date('2001-06-15T10:00:00.000Z');
// Zambia keeps UTC+2 all year.
const LUSAKA_OFFSET_MS = 2 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * 86_400_000);

const keysOf = (value: object) => Object.keys(value).sort();
const ngweeOf = (kwacha: number) => {
  expect(String(kwacha)).toMatch(TWO_DECIMALS);
  return parseKwacha(String(kwacha));
};

/** Amounts no larger than one payment may be, adding up to `total`. */
function piecesOf(total: bigint): number[] {
  const pieces: number[] = [];
  for (let left = total; left > 0n; ) {
    const piece = left > MAX_NGWEE ? MAX_NGWEE : left;
    pieces.push(Number(piece));
    left -= piece;
  }
  return pieces;
}

describe('admin console', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let admin: Row<typeof staffUsers>;
  let asAdmin: { Authorization: string };

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    asAdmin = bearer(await staffToken(admin, ['admin']));
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const get = (path: string) => testApp.http.get(`/api/v1/admin/${path}`).set(asAdmin);

  async function confirmedSum(): Promise<bigint> {
    const result = await side.db.execute<{ total: string }>(
      sql`SELECT coalesce(sum("amountMinor"), 0)::text AS total FROM payments WHERE status = 'CONFIRMED'`,
    );
    return BigInt(result.rows[0].total);
  }

  describe('access', () => {
    it.each(['overview', 'premium-by-month', 'policies', 'customers/find?query=someone@example.test'])(
      'refuses a customer and an insurer user on %s',
      async (path) => {
        const customer = await buildCustomer(testApp.db);
        const { staff } = await buildInsurer(testApp.db);
        const asCustomer = bearer(await customerToken(customer));
        const asInsurer = bearer(await staffToken(staff, ['insurer_user']));

        const refused = [
          await testApp.http.get(`/api/v1/admin/${path}`).set(asCustomer),
          await testApp.http.get(`/api/v1/admin/${path}`).set(asInsurer),
          await testApp.http.get(`/api/v1/admin/${path}`),
        ];

        expect(refused.map((response) => response.status)).toEqual([403, 403, 401]);
      },
    );

    it('answers a super admin', async () => {
      const superAdmin = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
      await testApp.http
        .get('/api/v1/admin/overview')
        .set(bearer(await staffToken(superAdmin, ['super_admin'])))
        .expect(200);
    });
  });

  describe('overview', () => {
    it('returns exactly the expected keys, with counts as numbers', async () => {
      const { body } = await get('overview').expect(200);

      expect(keysOf(body)).toEqual(['claims', 'customers', 'insurers', 'ncd', 'policies', 'premium', 'quoteRequests']);
      expect(keysOf(body.policies)).toEqual(['active', 'awaitingCertificate', 'expiringIn30Days', 'total']);
      expect(keysOf(body.insurers)).toEqual(['active', 'inactive', 'total']);
      expect(keysOf(body.claims)).toEqual(['open', 'total']);
      expect(keysOf(body.quoteRequests)).toEqual(['awaitingQuotes', 'quoted']);
      expect(keysOf(body.ncd)).toEqual(['open']);
      expect(keysOf(body.customers)).toEqual(['total']);
      expect(keysOf(body.premium)).toEqual(['allTime', 'currency', 'thisMonth']);
      expect(body.premium.currency).toBe('ZMW');
      for (const group of ['policies', 'insurers', 'claims', 'quoteRequests', 'ncd', 'customers']) {
        for (const count of Object.values(body[group] as Record<string, unknown>)) {
          expect(Number.isSafeInteger(count)).toBe(true);
        }
      }
    });

    it('counts each kind of record by its status', async () => {
      const before = (await get('overview').expect(200)).body;

      const insurer = await buildInsurer(testApp.db);
      await buildInsurer(testApp.db, { insurer: { status: 'INACTIVE' } });
      await buildInsurer(testApp.db, { insurer: { status: 'DELETED', deletedAt: new Date() } });
      const customer = await buildCustomer(testApp.db);
      await buildCustomer(testApp.db, { deletedAt: new Date() });
      const parties = { customer, insurer };
      await buildSoldPolicy(testApp.db, parties);
      await buildSoldPolicy(testApp.db, parties, { status: 'ACTIVE', policyEndDate: daysFromNow(10) });
      await buildSoldPolicy(testApp.db, parties, { status: 'ACTIVE', policyEndDate: daysFromNow(40) });
      await buildSoldPolicy(testApp.db, parties, { status: 'ACTIVE', policyEndDate: daysFromNow(-1) });
      await buildSoldPolicy(testApp.db, parties, { status: 'AWAITING_INSURER_CERTIFICATE', policyEndDate: daysFromNow(5) });
      await buildClaim(testApp.db, { insurerId: insurer.insurer.id, customerId: customer.id });
      await buildClaim(testApp.db, { insurerId: insurer.insurer.id }, { status: 'RECEIVED_BY_INSURER' });
      await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] });
      await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] }, { status: 'EXPIRED' });
      for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED'] as const) {
        await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id }, { status });
      }

      const after = (await get('overview').expect(200)).body;

      const delta = (group: string, key: string) => after[group][key] - before[group][key];
      expect({
        policies: delta('policies', 'total'),
        active: delta('policies', 'active'),
        awaiting: delta('policies', 'awaitingCertificate'),
        expiring: delta('policies', 'expiringIn30Days'),
        insurers: delta('insurers', 'total'),
        activeInsurers: delta('insurers', 'active'),
        inactiveInsurers: delta('insurers', 'inactive'),
        openClaims: delta('claims', 'open'),
        claims: delta('claims', 'total'),
        awaitingQuotes: delta('quoteRequests', 'awaitingQuotes'),
        quoted: delta('quoteRequests', 'quoted'),
        openNcd: delta('ncd', 'open'),
        customers: delta('customers', 'total'),
      }).toEqual({
        policies: 5,
        active: 3,
        awaiting: 2,
        expiring: 1,
        insurers: 2,
        activeInsurers: 1,
        inactiveInsurers: 1,
        openClaims: 1,
        claims: 2,
        awaitingQuotes: 1,
        quoted: 5,
        openNcd: 2,
        customers: 1,
      });
    });

    it('takes premium from confirmed payments only, this month by the Lusaka calendar', async () => {
      const target = await buildPaymentTarget(testApp.db);
      const before = (await get('overview').expect(200)).body.premium;

      await buildConfirmedPayments(testApp.db, target, [123_456, 10, 20], new Date());
      await buildConfirmedPayments(testApp.db, target, [500], LONG_AGO);
      await buildPayment(testApp.db, target, { status: 'PENDING', amountMinor: 999 });
      await buildPayment(testApp.db, target, { status: 'FAILED', amountMinor: 999, confirmedAt: new Date() });

      const after = (await get('overview').expect(200)).body.premium;
      expect(ngweeOf(after.allTime) - ngweeOf(before.allTime)).toBe(123_986n);
      expect(ngweeOf(after.thisMonth) - ngweeOf(before.thisMonth)).toBe(123_486n);
      expect(ngweeOf(after.allTime)).toBe(await confirmedSum());
    });

    it('counts this month from midnight on the 1st in Lusaka', async () => {
      const [year, month] = LUSAKA_MONTH.format(new Date()).split('-').map(Number);
      const monthStart = new Date(Date.UTC(year, month - 1, 1) - LUSAKA_OFFSET_MS);
      const target = await buildPaymentTarget(testApp.db);
      const before = (await get('overview').expect(200)).body.premium;

      await buildConfirmedPayments(testApp.db, target, [10], new Date(monthStart.getTime() - 1));
      await buildConfirmedPayments(testApp.db, target, [20], monthStart);

      const after = (await get('overview').expect(200)).body.premium;
      expect(ngweeOf(after.thisMonth) - ngweeOf(before.thisMonth)).toBe(20n);
      expect(ngweeOf(after.allTime) - ngweeOf(before.allTime)).toBe(30n);
    });

    it('ends this month before midnight on the 1st of the next Lusaka month', async () => {
      const [year, month] = LUSAKA_MONTH.format(new Date()).split('-').map(Number);
      const nextMonthStart = new Date(Date.UTC(year, month, 1) - LUSAKA_OFFSET_MS);
      const target = await buildPaymentTarget(testApp.db);
      const before = (await get('overview').expect(200)).body.premium;

      await buildConfirmedPayments(testApp.db, target, [10], new Date(nextMonthStart.getTime() - 1));
      await buildConfirmedPayments(testApp.db, target, [20], nextMonthStart);
      await buildConfirmedPayments(testApp.db, target, [40], new Date(Date.UTC(year + 1, month - 1, 15)));

      const after = (await get('overview').expect(200)).body.premium;
      expect(ngweeOf(after.thisMonth) - ngweeOf(before.thisMonth)).toBe(10n);
      expect(ngweeOf(after.allTime) - ngweeOf(before.allTime)).toBe(70n);
    });

    describe('large totals', () => {
      let target: PaymentTarget;
      const added: string[] = [];

      beforeAll(async () => {
        target = await buildPaymentTarget(testApp.db);
      });

      afterAll(async () => {
        if (added.length > 0) {
          await side.db.update(payments).set({ status: 'FAILED' }).where(inArray(payments.id, added));
        }
      });

      async function raiseConfirmedSumTo(total: bigint) {
        const current = await confirmedSum();
        expect(current <= total).toBe(true);
        const rows = await buildConfirmedPayments(testApp.db, target, piecesOf(total - current), LONG_AGO);
        added.push(...rows.map((row) => row.id));
      }

      it.each([
        ['K1 trillion', 100_000_000_000_000n, 1_000_000_000_000],
        ['K70 trillion', 7_000_000_000_000_000n, 70_000_000_000_000],
        ['K70 trillion and one ngwee', 7_000_000_000_000_001n, 70_000_000_000_000.01],
      ])('sends a total of %s exactly', async (_label, total, kwacha) => {
        await raiseConfirmedSumTo(total);

        const { body } = await get('overview').expect(200);

        expect(body.premium.allTime).toBe(kwacha);
        expect(parseKwacha(String(body.premium.allTime))).toBe(total);
      });

      it('refuses with 500, never a rounded number, a total that no Kwacha number carries exactly', async () => {
        await raiseConfirmedSumTo(7_100_000_000_000_001n);

        const response = await get('overview').expect(500);

        expect(response.body).toEqual({
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong on our side. Please try again.',
          details: null,
        });
      });
    });
  });

  describe('premium by month', () => {
    const months = async (query = '') => (await get(`premium-by-month${query}`).expect(200)).body as { month: string; total: number }[];
    const totalOf = (buckets: { month: string; total: number }[], month: string) => {
      const bucket = buckets.find((entry) => entry.month === month);
      expect(bucket).toBeDefined();
      return ngweeOf(bucket?.total ?? 0);
    };

    it('lists every month of the window, oldest first, ending with this Lusaka month', async () => {
      const buckets = await months();

      expect(buckets).toHaveLength(12);
      expect(buckets.every((bucket) => keysOf(bucket).join() === 'month,total')).toBe(true);
      expect(buckets.at(-1)?.month).toBe(LUSAKA_MONTH.format(new Date()));
      const sorted = [...buckets].map((bucket) => bucket.month).sort();
      expect(buckets.map((bucket) => bucket.month)).toEqual(sorted);
      expect(new Set(buckets.map((bucket) => bucket.month)).size).toBe(12);
    });

    it.each([
      ['?months=0', 1],
      ['?months=1', 1],
      ['?months=24', 24],
      ['?months=99', 24],
    ])('clamps %s to %i months', async (query, length) => {
      expect(await months(query)).toHaveLength(length);
    });

    it('reads a months value that is not a number as the default of 12', async () => {
      expect(await months('?months=many')).toHaveLength(12);
    });

    it('counts a payment at 23:30 UTC on 31 January in February, the Lusaka month', async () => {
      const now = new Date();
      const year = now.getUTCMonth() >= 1 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      const target = await buildPaymentTarget(testApp.db);
      const before = await months('?months=24');

      await buildConfirmedPayments(testApp.db, target, [12_345], new Date(`${year}-01-31T23:30:00.000Z`));

      const after = await months('?months=24');
      expect(totalOf(after, `${year}-02`) - totalOf(before, `${year}-02`)).toBe(12_345n);
      expect(totalOf(after, `${year}-01`) - totalOf(before, `${year}-01`)).toBe(0n);
    });

    it('adds amounts exactly, with no floating-point error', async () => {
      const target = await buildPaymentTarget(testApp.db);
      const month = LUSAKA_MONTH.format(new Date());
      const before = await months();

      await buildConfirmedPayments(testApp.db, target, [10, 20, 123_456], new Date());
      await buildPayment(testApp.db, target, { status: 'FAILED', amountMinor: 700, confirmedAt: new Date() });

      const after = await months();
      expect(totalOf(after, month) - totalOf(before, month)).toBe(123_486n);
    });
  });

  describe('recent policies', () => {
    it('returns each policy with exactly the expected keys and wire values', async () => {
      const customer = await buildCustomer(testApp.db, { fullName: 'Mutale Banda' });
      const insurer = await buildInsurer(testApp.db, { insurer: { name: `Recent ${randomUUID()}` } });
      const receivedAt = new Date(Date.now() + 60_000);
      receivedAt.setUTCMilliseconds(123);
      const { policy, target } = await buildSoldPolicy(testApp.db, { customer, insurer }, { premiumMinor: 123_456, receivedAt });
      const [vehicle] = await side.db.select().from(vehicles).where(eq(vehicles.id, target.vehicleId));

      const { body } = await get('policies?limit=1').expect(200);

      expect(body).toEqual([
        {
          policyNumber: policy.policyNumber,
          status: 'Awaiting insurer certificate',
          insurer: insurer.insurer.name,
          customerName: 'Mutale Banda',
          vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
          plateNumber: vehicle.plateNumber,
          premium: 1234.56,
          receivedAt: receivedAt.toISOString(),
          issuedAt: null,
        },
      ]);
    });

    it('sends an issued policy with its issue time', async () => {
      const { policy } = await buildSoldPolicy(
        testApp.db,
        {},
        {
          status: 'ACTIVE',
          premiumMinor: 1,
          issuedAt: new Date('2026-04-02T22:00:00.007Z'),
          receivedAt: new Date(Date.now() + 120_000),
        },
      );

      const { body } = await get('policies?limit=1').expect(200);

      expect(body[0]).toMatchObject({
        policyNumber: policy.policyNumber,
        status: 'Active',
        premium: 0.01,
        issuedAt: '2026-04-02T22:00:00.007Z',
      });
      expect(body[0].receivedAt).toMatch(ISO_MS);
    });

    describe('limits', () => {
      beforeAll(async () => {
        for (let index = 0; index < 50; index += 1) await buildSoldPolicy(testApp.db);
      });

      it.each([
        ['', 8],
        ['?limit=0', 1],
        ['?limit=3', 3],
        ['?limit=500', 50],
      ])('limits "%s" to %i policies, newest first', async (query, length) => {
        const { body } = await get(`policies${query}`).expect(200);

        expect(body).toHaveLength(length);
        const times: string[] = body.map((policy: { receivedAt: string }) => policy.receivedAt);
        expect(times).toEqual([...times].sort().reverse());
      });
    });
  });

  describe('customer lookup', () => {
    const find = (query: string) => get(`customers/find?query=${encodeURIComponent(query)}`);

    it('finds a customer by exact email, in any case, with exactly the expected keys', async () => {
      const email = `${randomUUID()}@example.test`;
      const customer = await buildCustomer(testApp.db, { email, fullName: 'Chanda Mwila' });
      const insurer = await buildInsurer(testApp.db);
      await buildConsent(testApp.db, customer.id, { acceptedAt: new Date('2026-01-01T08:00:00.001Z') });
      await buildConsent(testApp.db, customer.id, { privacyVersion: 'privacy-2', acceptedAt: new Date('2026-03-01T08:00:00.002Z') });
      await buildSoldPolicy(testApp.db, { customer, insurer });
      await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] });
      await buildClaim(testApp.db, { insurerId: insurer.insurer.id, customerId: customer.id });

      const { body } = await find(`  ${email.toUpperCase()} `).expect(200);

      expect(body).toEqual({
        id: customer.id,
        fullName: 'Chanda Mwila',
        email,
        phone: customer.phone,
        createdAt: customer.createdAt.toISOString(),
        consent: { noticeVersion: 'privacy-2', acceptedAt: '2026-03-01T08:00:00.002Z' },
        counts: { quoteRequests: 2, policies: 1, claims: 1 },
      });
      expect(body.createdAt).toMatch(ISO_MS);
    });

    it('finds a customer by exact phone, and hides a placeholder phone', async () => {
      const phone = `+2609${String(randomInt(1_000_000_000)).padStart(9, '0')}`;
      const byPhone = await buildCustomer(testApp.db, { phone });
      const pending = await buildCustomer(testApp.db, { phone: `pending:${randomUUID()}` });

      expect((await find(phone).expect(200)).body).toMatchObject({ id: byPhone.id, consent: null });
      expect((await find(pending.email).expect(200)).body).toMatchObject({ id: pending.id, phone: null });
    });

    it('does not match part of an email, a closed account or an unknown one', async () => {
      const customer = await buildCustomer(testApp.db);
      const closed = await buildCustomer(testApp.db, { deletedAt: new Date() });

      for (const query of [customer.email.slice(0, -3), closed.email, `${randomUUID()}@example.test`]) {
        const response = await find(query).expect(404);
        expect(response.body).toEqual({ code: 'NOT_FOUND', message: 'Customer account was not found.', details: null });
      }
    });

    it('refuses a query shorter than three characters', async () => {
      const response = await find('  ab ').expect(400);

      expect(response.body).toEqual({
        code: 'QUERY_TOO_SHORT',
        message: 'Enter the full email address or mobile number.',
        details: null,
      });
    });
  });
});
