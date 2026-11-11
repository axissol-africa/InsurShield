import { randomUUID } from 'node:crypto';
import { and, inArray } from 'drizzle-orm';
import { INSURER_STATUSES } from '../src/common/domain/enums.js';
import {
  type InsurerStanding,
  servicesExistingBusiness,
  servicesExistingBusinessWhere,
  takesNewBusiness,
  takesNewBusinessWhere,
} from '../src/common/insurer-standing.js';
import { insurers } from '../src/db/schema.js';
import { buildCustomer, buildDocument, buildInsurer, buildQuoteRequest, buildPurchasedPolicy, type Row } from './builders.js';
import { buildNcdApplication } from './builders/customer.js';
import { buildPiaConfig } from './builders/admin.js';
import { buildPayableQuote } from './builders/payments.js';
import { holdLocks, openTestDatabase, queueBehind, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';
import type { customers } from '../src/db/schema.js';

const EXPIRED = new Date('2020-06-30T00:00:00.000Z');
const CURRENT = new Date('2099-12-31T00:00:00.000Z');
const READING_THE_STANDING = 'select % from "insurers" where % for share';

/**
 * One rule about who may trade, read by every path that sells.
 *
 * Before this, `licenceExpiry` was read in a single place — the fan-out list —
 * so a licence that lapsed stopped new requests reaching an insurer while its
 * existing quotes stayed payable and extendable and it stayed on the public
 * directory. These checks hold each of those paths to the same rule.
 */
describe('an insurer that may no longer trade', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    // A floor low enough that the premiums here clear it; the floor is PIA's rule, not this one.
    await buildPiaConfig(testApp.db, { piaRateBps: 1 });
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const asCustomer = (customer: Row<typeof customers>) =>
    signIn(testApp.http, customer);

  const payFor = async (
    customer: Row<typeof customers>,
    quoteRequestId: string,
    insurer: string,
    amount: number,
  ) =>
    testApp.http
      .post('/api/v1/payments')
      .set(await asCustomer(customer))
      .set('Idempotency-Key', randomUUID())
      .send({
        quoteRequestId,
        insurer,
        amount,
        method: 'Mobile money',
        mobileNumber: '+260971234567',
      });

  describe('payment', () => {
    it('refuses a quote from an insurer whose licence has expired, and writes nothing', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(
        testApp.db,
        {
          insurer: await buildInsurer(testApp.db, {
            insurer: { licenceExpiry: EXPIRED },
          }),
        },
      );

      const response = await payFor(
        customer,
        quoteRequest.id,
        insurer.insurer.name,
        1234.56,
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INSURER_UNAVAILABLE');
      expect(response.body.message).toContain(insurer.insurer.name);
      const paid = await testApp.http
        .get(`/api/v1/quote-requests/${quoteRequest.id}`)
        .set(await asCustomer(customer));
      expect(paid.body.policy ?? null, 'no policy was issued').toBeNull();
    });

    it('refuses a quote from a deactivated insurer', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(
        testApp.db,
        {
          insurer: await buildInsurer(testApp.db, {
            insurer: { status: 'INACTIVE' },
          }),
        },
      );

      const response = await payFor(
        customer,
        quoteRequest.id,
        insurer.insurer.name,
        1234.56,
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INSURER_UNAVAILABLE');
    });

    it('refuses a payment that reached the check while the insurer was being deactivated', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(testApp.db);
      // The admin's update holds the insurer row exclusively and has not committed.
      const deactivating = await holdLocks(side.pool, (_db, client) =>
        client.query('UPDATE insurers SET status = $2 WHERE id = $1', [insurer.insurer.id, 'INACTIVE']),
      );

      const [response] = await queueBehind(deactivating, READING_THE_STANDING, 1, [
        () => payFor(customer, quoteRequest.id, insurer.insurer.name, 1234.56),
      ]);

      // The payment waited on the share lock rather than reading the old status.
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INSURER_UNAVAILABLE');
    });

    it('still takes payment for an insurer in good standing', async () => {
      const { customer, insurer, quoteRequest } = await buildPayableQuote(
        testApp.db,
        {
          insurer: await buildInsurer(testApp.db, {
            insurer: { licenceExpiry: CURRENT },
          }),
        },
      );

      const response = await payFor(
        customer,
        quoteRequest.id,
        insurer.insurer.name,
        1234.56,
      );

      expect(response.status).toBe(201);
      expect(response.body.policyNumber).toMatch(/^POL-[0-9A-Z]+$/);
    });
  });

  describe('the insurer portal', () => {
    const asInsurer = (staff: { email: string }) => signIn(testApp.http, staff);

    it('refuses a reply from an insurer whose licence has expired', async () => {
      const insurer = await buildInsurer(testApp.db, {
        insurer: { licenceExpiry: EXPIRED },
      });
      const customer = await buildCustomer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, {
        customerId: customer.id,
        insurerIds: [insurer.insurer.id],
      });
      const quotation = await buildDocument(
        testApp.db,
        { staffId: insurer.staff.id },
        { kind: 'QUOTATION' },
      );

      const response = await testApp.http
        .post(`/api/v1/insurer/quote-requests/${quoteRequest.id}/quote`)
        .set(await asInsurer(insurer.staff))
        .send({ premium: 100, documentId: quotation.id });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INSURER_UNAVAILABLE');
    });

    it('refuses an extension from a deactivated insurer, leaving the quote as it stands', async () => {
      const { insurer, quoteRequest, quote } = await buildPayableQuote(
        testApp.db,
      );
      await side.db
        .update(insurers)
        .set({ status: 'INACTIVE' })
        .where(inArray(insurers.id, [insurer.insurer.id]));

      const response = await testApp.http
        .post(`/api/v1/insurer/quote-requests/${quoteRequest.id}/extend`)
        .set(await asInsurer(insurer.staff))
        .send({ extraDays: 5 });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INSURER_UNAVAILABLE');
      const [unchanged] = await side.db
        .select()
        .from(insurers)
        .where(inArray(insurers.id, [insurer.insurer.id]));
      expect(unchanged.status).toBe('INACTIVE');
      expect(quote.extendedAt, 'and the quote was never extended').toBeNull();
    });
  });

  describe('what the customer already holds', () => {
    it('still notifies a claim to a deactivated insurer, because servicing continues', async () => {
      const insurer = await buildInsurer(testApp.db, { insurer: { licenceExpiry: EXPIRED, status: 'INACTIVE' } });
      const { customer, policy } = await buildPurchasedPolicy(testApp.db, { insurer });

      const response = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .send({
          insurerId: insurer.insurer.id,
          policyNumber: policy.policyNumber,
          fullName: 'Mwiza Banda',
          phone: '0970123456',
          plate: 'BAA 1234',
          vehicle: '2020 Toyota Hilux',
          type: 'Theft',
          incidentDate: '2026-10-20T06:15:00.000Z',
          location: 'Woodlands, Lusaka',
          description: 'Vehicle stolen from outside the residence overnight.',
        });

      expect(response.status, 'a lapsed licence does not strand a policyholder').toBe(201);
    });
  });

  describe('an NCD decision', () => {
    it('refuses to issue a code from an insurer whose licence has expired', async () => {
      const lapsed = await buildInsurer(testApp.db, { insurer: { licenceExpiry: EXPIRED } });
      const customer = await buildCustomer(testApp.db);
      const application = await buildNcdApplication(testApp.db, {
        customerId: customer.id,
        insurerId: lapsed.insurer.id,
      });

      const response = await testApp.http
        .post(`/api/v1/insurer/ncd/applications/${application.id}/decision`)
        .set(await signIn(testApp.http, lapsed.staff))
        .send({ status: 'APPROVED' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INSURER_UNAVAILABLE');
    });

    it('still lets that insurer decline, because answering an application it holds is servicing', async () => {
      const lapsed = await buildInsurer(testApp.db, { insurer: { licenceExpiry: EXPIRED } });
      const customer = await buildCustomer(testApp.db);
      const application = await buildNcdApplication(testApp.db, {
        customerId: customer.id,
        insurerId: lapsed.insurer.id,
      });

      const response = await testApp.http
        .post(`/api/v1/insurer/ncd/applications/${application.id}/decision`)
        .set(await signIn(testApp.http, lapsed.staff))
        .send({ status: 'REJECTED' });

      expect(response.status).toBe(200);
    });
  });

  describe('what a customer is shown', () => {
    it('leaves a licence-expired insurer out of the public directory', async () => {
      const lapsed = await buildInsurer(testApp.db, {
        insurer: { licenceExpiry: EXPIRED },
      });
      const current = await buildInsurer(testApp.db, {
        insurer: { licenceExpiry: CURRENT },
      });

      const { body } = await testApp.http
        .get('/api/v1/insurers/directory')
        .expect(200);
      const names = body.map((entry: { name: string }) => entry.name);

      expect(names).not.toContain(lapsed.insurer.name);
      expect(names).toContain(current.insurer.name);
    });

    it('refuses an NCD application to an insurer whose licence has expired', async () => {
      const customer = await buildCustomer(testApp.db);
      const lapsed = await buildInsurer(testApp.db, {
        insurer: { licenceExpiry: EXPIRED },
      });

      const response = await testApp.http
        .post('/api/v1/ncd/applications')
        .set(await asCustomer(customer))
        .send({
          insurerId: lapsed.insurer.id,
          policyNumber: 'PA-2023-0045',
          fullName: 'Mwiza Banda',
          phone: '0970123456',
          yearsClaimFree: 3,
        });

      expect(response.status).toBe(404);
    });

    it('refuses an inspection request to an insurer whose licence has expired', async () => {
      const customer = await buildCustomer(testApp.db);
      const lapsed = await buildInsurer(testApp.db, {
        insurer: { licenceExpiry: EXPIRED },
      });

      const response = await testApp.http
        .post('/api/v1/inspections')
        .set(await asCustomer(customer))
        .send({
          vehiclePlate: 'BAA 1234',
          vehicleLabel: '2019 Toyota Corolla',
          insurerId: lapsed.insurer.id,
        });

      expect(response.status).toBe(404);
    });
  });

  /**
   * Each rule is written twice, as a predicate and as a query condition. This
   * is what stops the two drifting: every status the enum defines, crossed with
   * every expiry shape, through both — and against what each case is declared
   * to mean here, so the check cannot pass by the two agreeing about the wrong
   * answer.
   */
  describe('the predicates and the query conditions', () => {
    // 11:30 on 10 November in Lusaka.
    const NOW = new Date('2026-11-10T09:30:00.000Z');
    const LICENCES: { label: string; expiry: Date | null; current: boolean }[] = [
      { label: 'never recorded', expiry: null, current: true },
      { label: 'lapsed yesterday', expiry: new Date('2026-11-09T00:00:00.000Z'), current: false },
      { label: 'lapses today', expiry: new Date('2026-11-10T00:00:00.000Z'), current: true },
      // Stored as 22:00 on the 9th in UTC, so only a Lusaka day reads it as the 10th.
      { label: 'lapses today, recorded at Lusaka midnight', expiry: new Date('2026-11-10T00:00:00.000+02:00'), current: true },
      { label: 'lapses tomorrow', expiry: new Date('2026-11-11T00:00:00.000Z'), current: true },
      { label: 'lapsed years ago', expiry: EXPIRED, current: false },
      { label: 'years to run', expiry: CURRENT, current: true },
    ];

    it('agree with each other, and with what each case means, on every status and expiry', async () => {
      const built: { id: string; label: string; standing: InsurerStanding; sells: boolean; services: boolean }[] = [];
      for (const status of INSURER_STATUSES) {
        for (const licence of LICENCES) {
          const { insurer } = await buildInsurer(testApp.db, { insurer: { status, licenceExpiry: licence.expiry } });
          built.push({
            id: insurer.id,
            label: `${status}, licence ${licence.label}`,
            standing: { status, licenceExpiry: licence.expiry },
            sells: status === 'ACTIVE' && licence.current,
            services: status !== 'DELETED',
          });
        }
      }
      const ids = built.map((row) => row.id);
      const admitted = async (conditions: ReturnType<typeof takesNewBusinessWhere>) =>
        new Set(
          (await side.db.select({ id: insurers.id }).from(insurers).where(and(inArray(insurers.id, ids), ...conditions)))
            .map((row) => row.id),
        );

      const sellers = await admitted(takesNewBusinessWhere(NOW));
      const serviceable = await admitted(servicesExistingBusinessWhere());

      expect(
        built.filter((row) => takesNewBusiness(row.standing, NOW) !== row.sells).map((row) => row.label),
        'the predicate says what each case means',
      ).toEqual([]);
      expect(
        built.filter((row) => sellers.has(row.id) !== row.sells).map((row) => row.label),
        'and so does the query condition',
      ).toEqual([]);
      expect(
        built.filter((row) => servicesExistingBusiness(row.standing) !== row.services).map((row) => row.label),
        'the servicing predicate too',
      ).toEqual([]);
      expect(
        built.filter((row) => serviceable.has(row.id) !== row.services).map((row) => row.label),
        'and its query condition',
      ).toEqual([]);
      // A dropped condition would admit every row, which the comparisons above
      // would still pass if `sells` were ever computed from the same predicate.
      expect(sellers.size, 'and the conditions filter at all').toBeLessThan(ids.length);
    });
  });
});
