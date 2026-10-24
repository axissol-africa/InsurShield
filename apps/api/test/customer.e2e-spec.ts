import { randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type { Response } from 'supertest';
import { MAX_KWACHA } from '../src/common/domain/money-limits.js';
import { testDatabase } from '../src/config/env.js';
import { createDatabase, DATABASE, type Database } from '../src/db/database.module.js';
import * as schema from '../src/db/schema.js';
import {
  claimAttachments,
  claimNotifications,
  customers,
  inspectionShots,
  insurers,
  ncdApplications,
  payments,
  policies,
  quoteRequestRecipients,
  quoteRequests,
  vehicles,
  documents as documentsTable,
} from '../src/db/schema.js';
import {
  buildClaim,
  buildCustomer,
  buildDocument,
  buildInsurer,
  buildInsurerQuote,
  buildNcdCode,
  buildPurchasedPolicy,
  buildQuoteRequest,
  buildStaffUser,
  buildVehicle,
  unique,
  type Row,
} from './builders.js';
import { buildApprovedNcdCode, buildNcdApplication, buildRenewalRequest } from './builders/customer.js';
import { buildClaimAttachment, buildInspectionShot } from './builders/documents.js';
import { openTestDatabase, productionPool, startApp, until, type TestApp } from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';

type Customer = Row<typeof customers>;
type DocumentRow = Row<typeof documentsTable>;

const DAY_MS = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);
const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const LOCKING_THE_REQUEST = 'select % from "quote_requests" % for update';
const LOCKING_THE_POLICY = 'select % from "policies" % for update';
const LOCKING_THE_CUSTOMER = 'select % from "customers" % for update';
const SHARING_THE_INSURERS = 'select % from "insurers" % for share';
const LOCKING_THE_DOCUMENTS = 'select % from "documents" % for update';

const QUOTE_REQUEST_KEYS = [
  'coverageDurationId',
  'customer',
  'expiresAt',
  'id',
  'insuranceType',
  'insurerIds',
  'insurerQuotes',
  'insurers',
  'matchRtsaAnniversary',
  'photosCapturedAt',
  'policyDates',
  'requotedAs',
  'requotedFromId',
  'status',
  'submittedAt',
  'vehicle',
  'vehicleDetails',
  'vehicleUsage',
  'vehicleValue',
];
const INSURER_QUOTE_KEYS = ['document', 'extendedAt', 'insurerReference', 'notes', 'premium', 'sentAt', 'validUntil', 'validityDays'];
const POLICY_KEYS = [
  'certificateDocument',
  'coverage',
  'customerEmail',
  'customerName',
  'customerPhone',
  'insurer',
  'insurerPolicyNumber',
  'insurerQuoteReference',
  'issuedAt',
  'paymentProof',
  'plan',
  'policyDates',
  'policyNumber',
  'premium',
  'quoteDocument',
  'quoteRequestId',
  'receivedAt',
  'renewal',
  'status',
  'vehicle',
  'vehicleDetails',
];
const CLAIM_LIST_KEYS = [
  'claimNumber',
  'customerEmail',
  'description',
  'email',
  'estimatedLoss',
  'fullName',
  'incidentDate',
  'insurer',
  'insurerClaimReference',
  'location',
  'phone',
  'plate',
  'policeReport',
  'policeReportNumber',
  'policyNumber',
  'receivedAt',
  'status',
  'submittedAt',
  'supportingDocs',
  'type',
  'vehicle',
];
const CLAIM_NOTIFIED_KEYS = [
  'claimNumber',
  'description',
  'email',
  'estimatedLoss',
  'fullName',
  'incidentDate',
  'insurer',
  'lateReason',
  'location',
  'phone',
  'plate',
  'policeReport',
  'policeReportNumber',
  'policyNumber',
  'receivedAt',
  'status',
  'submittedAt',
  'supportingDocs',
  'type',
  'vehicle',
];
const NCD_APPLICATION_KEYS = [
  'applicationNumber',
  'approvedCode',
  'fullName',
  'id',
  'insurer',
  'phone',
  'policyNumber',
  'status',
  'submittedAt',
  'yearsClaimFree',
];
const DOCUMENT_KEYS = ['id', 'name', 'size', 'type', 'url'];

describe('customer', () => {
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

  const asCustomer = async (customer: Customer) =>
    bearer(await customerToken({ keycloakId: customer.keycloakId, email: customer.email }));

  const documentResponse = async (document: DocumentRow) => ({
    id: document.id,
    name: document.fileName,
    type: document.mimeType,
    size: document.sizeBytes,
    url: await testApp.storage.signedDownloadUrl(document.storageKey, document.fileName),
  });

  const storedRequest = async (id: string) => {
    const [row] = await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.id, id));
    return row;
  };
  const recipientsOf = (id: string) =>
    testApp.db.select().from(quoteRequestRecipients).where(eq(quoteRequestRecipients.quoteRequestId, id));
  const shotsOf = (id: string) => testApp.db.select().from(inspectionShots).where(eq(inspectionShots.quoteRequestId, id));
  const requestsOf = (customerId: string) =>
    testApp.db.select().from(quoteRequests).where(eq(quoteRequests.customerId, customerId));
  const claimsOf = (customerId: string) =>
    testApp.db.select().from(claimNotifications).where(eq(claimNotifications.customerId, customerId));

  const submission = (plate: string, overrides: Record<string, unknown> = {}) => ({
    vehicleDetails: { plateNumber: plate, make: 'Toyota', model: 'Hilux', year: '2020', color: 'White' },
    vehicleValue: 1234.56,
    vehicleUsage: 'Individual',
    insuranceType: 'Comprehensive',
    coverageDurationId: '4q',
    ...overrides,
  });

  const claim = (insurerId: string, overrides: Record<string, unknown> = {}) => ({
    insurerId,
    fullName: 'Mwiza Banda',
    phone: '0970123456',
    plate: 'BAA 1234',
    vehicle: '2020 Toyota Hilux',
    type: 'Theft',
    incidentDate: '2026-10-20T06:15:00.000Z',
    location: 'Woodlands, Lusaka',
    description: 'Vehicle stolen from outside the residence overnight.',
    ...overrides,
  });

  /** Runs `work` while every active insurer is inactive, then puts them back. */
  async function withNoActiveInsurers(work: () => Promise<void>) {
    const active = await testApp.db.select({ id: insurers.id }).from(insurers).where(eq(insurers.status, 'ACTIVE'));
    const ids = active.map((insurer) => insurer.id);
    await testApp.db.update(insurers).set({ status: 'INACTIVE' }).where(inArray(insurers.id, ids));
    try {
      await work();
    } finally {
      await testApp.db.update(insurers).set({ status: 'ACTIVE' }).where(inArray(insurers.id, ids));
    }
  }

  /**
   * A side transaction on its own connection that keeps the locks `work` takes until `release`. `waiters` counts the
   * backends queued behind it (directly or behind another waiter) in a statement like `statement`, so a leftover from
   * another test is not counted.
   */
  async function holdLocks(work: (db: Database) => Promise<unknown>) {
    const client: PoolClient = await side.pool.connect();
    let holder: number;
    try {
      await client.query('BEGIN');
      holder = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await work(drizzle(client, { schema }));
    } catch (error) {
      client.release(error as Error);
      throw error;
    }
    const waiters = async (statement: string) => {
      const result = await side.pool.query<{ count: string }>(
        `WITH RECURSIVE queued AS (
           SELECT pid FROM pg_stat_activity WHERE $1::int = ANY (pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a JOIN queued q ON q.pid = ANY (pg_blocking_pids(a.pid))
         )
         SELECT count(*) FROM queued JOIN pg_stat_activity a USING (pid)
          WHERE a.wait_event_type = 'Lock' AND a.query ILIKE $2`,
        [holder, statement],
      );
      return Number(result.rows[0].count);
    };
    const release = async () => {
      try {
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    };
    return { waiters, release };
  }

  /** Starts `calls` behind `held`, commits it once `queued` of them wait in `statement`, and answers every response. */
  async function queueBehind(
    held: Awaited<ReturnType<typeof holdLocks>>,
    statement: string,
    queued: number,
    calls: (() => Promise<Response>)[],
  ): Promise<Response[]> {
    const requests = calls.map((call) => call());
    const settled = Promise.allSettled(requests);
    try {
      await until(async () => (await held.waiters(statement)) === queued, `${queued} requests to wait in ${statement}`);
    } finally {
      try {
        await held.release();
      } finally {
        await settled;
      }
    }
    return Promise.all(requests);
  }

  const statuses = (responses: Response[]) => responses.map((response) => response.status).sort((a, b) => a - b);

  it('refuses a staff token on a customer route', async () => {
    const staff = await buildStaffUser(testApp.db);
    const response = await testApp.http
      .get('/api/v1/quote-requests')
      .set(bearer(await staffToken(staff, ['admin'])))
      .expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  describe('GET /quote-requests', () => {
    it('returns the known values of a request with its quotes, and exactly the expected keys', async () => {
      const customer = await buildCustomer(testApp.db, { fullName: 'Mwiza Banda', phone: '+260970123456' });
      const tag = unique('Insurer');
      const quoted = await buildInsurer(testApp.db, { insurer: { name: `${tag} A` } });
      const silent = await buildInsurer(testApp.db, { insurer: { name: `${tag} B` } });
      const vehicle = await buildVehicle(testApp.db, {
        plateNumber: 'BAA 1234',
        make: 'Toyota',
        model: 'Hilux',
        year: '2020',
        color: 'White',
        registrationCountry: 'Zambia',
        chassisNumber: 'JTEH1234560012345',
        engineNumber: null,
        registrationDate: new Date('2020-03-01T00:00:00.123Z'),
        rtsaAnniversaryDate: new Date('2027-03-01T00:00:00.456Z'),
      });
      const { quoteRequest } = await buildQuoteRequest(
        testApp.db,
        { customerId: customer.id, insurerIds: [quoted.insurer.id, silent.insurer.id], vehicleId: vehicle.id },
        {
          status: 'QUOTED',
          submittedAt: new Date('2026-10-01T08:00:00.123Z'),
          expiresAt: new Date('2026-10-08T08:00:00.123Z'),
          vehicleValueMinor: 123_456,
          vehicleUsage: 'Individual',
          insuranceType: 'THIRD_PARTY',
          coverageDuration: 'Q2',
          matchRtsaAnniversary: true,
          policyStartDate: new Date('2026-11-01T00:00:00.000Z'),
          policyEndDate: new Date('2027-05-01T00:00:00.000Z'),
          coverageDays: 181,
          photosCapturedAt: new Date('2026-10-01T07:59:00.789Z'),
        },
      );
      const { quote, document } = await buildInsurerQuote(
        testApp.db,
        { quoteRequestId: quoteRequest.id, insurerId: quoted.insurer.id, staffId: quoted.staff.id },
        {
          premiumMinor: 123_456,
          notes: 'Includes windscreen cover',
          validityDays: 14,
          sentAt: new Date('2026-10-02T09:30:00.001Z'),
          validUntil: new Date('2026-10-16T09:30:00.001Z'),
          extendedAt: new Date('2026-10-10T09:30:00.002Z'),
        },
      );
      const { quoteRequest: again } = await buildQuoteRequest(
        testApp.db,
        { customerId: customer.id, insurerIds: [], vehicleId: vehicle.id },
        { requotedFromId: quoteRequest.id },
      );

      const response = await testApp.http.get('/api/v1/quote-requests').set(await asCustomer(customer)).expect(200);

      expect(response.body.map((request: { id: string }) => request.id)).toEqual([again.id, quoteRequest.id]);
      const [, body] = response.body;
      expect(Object.keys(body).sort()).toEqual(QUOTE_REQUEST_KEYS);
      expect(Object.keys(body.insurerQuotes[quoted.insurer.name]).sort()).toEqual(INSURER_QUOTE_KEYS);
      expect(Object.keys(body.insurerQuotes[quoted.insurer.name].document).sort()).toEqual(DOCUMENT_KEYS);
      expect(body).toEqual({
        id: quoteRequest.id,
        status: 'Quoted',
        submittedAt: '2026-10-01T08:00:00.123Z',
        expiresAt: '2026-10-08T08:00:00.123Z',
        customer: { fullName: 'Mwiza Banda', email: customer.email, phone: '+260970123456' },
        vehicle: '2020 Toyota Hilux',
        vehicleDetails: {
          plateNumber: 'BAA 1234',
          make: 'Toyota',
          model: 'Hilux',
          year: '2020',
          color: 'White',
          registrationCountry: 'Zambia',
          chassisNumber: 'JTEH1234560012345',
          engineNumber: null,
          registrationDate: '2020-03-01T00:00:00.123Z',
          rtsaAnniversaryDate: '2027-03-01T00:00:00.456Z',
        },
        vehicleValue: 1234.56,
        vehicleUsage: 'Individual',
        insuranceType: 'ThirdParty',
        coverageDurationId: '2q',
        matchRtsaAnniversary: true,
        policyDates: { startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-05-01T00:00:00.000Z', daysTotal: 181 },
        insurers: [quoted.insurer.name, silent.insurer.name],
        insurerIds: [quoted.insurer.id, silent.insurer.id],
        insurerQuotes: {
          [quoted.insurer.name]: {
            premium: 1234.56,
            notes: 'Includes windscreen cover',
            insurerReference: quote.insurerReference,
            validityDays: 14,
            sentAt: '2026-10-02T09:30:00.001Z',
            validUntil: '2026-10-16T09:30:00.001Z',
            extendedAt: '2026-10-10T09:30:00.002Z',
            document: await documentResponse(document),
          },
        },
        photosCapturedAt: '2026-10-01T07:59:00.789Z',
        requotedFromId: null,
        requotedAs: again.id,
      });
      expect(response.body[0]).toMatchObject({ requotedFromId: quoteRequest.id, requotedAs: null, policyDates: null });
    });

    it('answers 404 for another customer’s request and leaves it out of the list', async () => {
      const owner = await buildCustomer(testApp.db);
      const other = await buildCustomer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: owner.id, insurerIds: [] });

      const response = await testApp.http
        .get(`/api/v1/quote-requests/${quoteRequest.id}`)
        .set(await asCustomer(other))
        .expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
      const list = await testApp.http.get('/api/v1/quote-requests').set(await asCustomer(other)).expect(200);
      expect(list.body).toEqual([]);
      await testApp.http.get(`/api/v1/quote-requests/${quoteRequest.id}`).set(await asCustomer(owner)).expect(200);
    });
  });

  describe('POST /quote-requests', () => {
    it('sends one request to every active insurer with the photos attached, and stores the value in ngwee', async () => {
      const customer = await buildCustomer(testApp.db);
      const active = await buildInsurer(testApp.db);
      const inactive = await buildInsurer(testApp.db, { insurer: { status: 'INACTIVE' } });
      const deleted = await buildInsurer(testApp.db, { insurer: { status: 'DELETED', deletedAt: new Date() } });
      const front = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });
      const rear = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });

      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(
          submission(unique('BAB').toUpperCase(), {
            insuranceType: 'ThirdParty',
            coverageDurationId: '2q',
            policyDates: { startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-05-01T00:00:00.000Z' },
            inspectionShots: [
              { shotKey: 'insp_front', documentId: front.id },
              { shotKey: 'insp_rear', documentId: rear.id },
            ],
            photosCapturedAt: '2026-10-24T10:00:00.250Z',
          }),
        )
        .expect(201);

      expect(Object.keys(response.body).sort()).toEqual(QUOTE_REQUEST_KEYS);
      expect(response.body).toMatchObject({
        status: 'Submitted',
        insuranceType: 'ThirdParty',
        coverageDurationId: '2q',
        vehicleValue: 1234.56,
        vehicle: '2020 Toyota Hilux',
        policyDates: { startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-05-01T00:00:00.000Z', daysTotal: 181 },
        insurerQuotes: {},
        photosCapturedAt: '2026-10-24T10:00:00.250Z',
        requotedFromId: null,
        requotedAs: null,
      });
      expect(response.body.id).toMatch(/^QR-/);
      expect(response.body.submittedAt).toMatch(ISO_MS);
      expect(response.body.expiresAt).toBe(new Date(Date.parse(response.body.submittedAt) + 7 * DAY_MS).toISOString());
      expect(response.body.insurerIds).toContain(active.insurer.id);
      expect(response.body.insurerIds).not.toContain(inactive.insurer.id);
      expect(response.body.insurerIds).not.toContain(deleted.insurer.id);
      expect(response.body.insurers).toHaveLength(response.body.insurerIds.length);

      const stored = await storedRequest(response.body.id);
      expect(stored).toMatchObject({ vehicleValueMinor: 123_456, customerId: customer.id, ncdCode: null, ncdPercentage: null });
      const activeNow = await testApp.db.select({ id: insurers.id }).from(insurers).where(eq(insurers.status, 'ACTIVE'));
      expect((await recipientsOf(stored.id)).map((recipient) => recipient.insurerId).sort()).toEqual(
        activeNow.map((insurer) => insurer.id).sort(),
      );
      const shots = (await shotsOf(stored.id)).sort((a, b) => a.shotKey.localeCompare(b.shotKey));
      expect(shots.map((shot) => [shot.shotKey, shot.documentId])).toEqual([
        ['insp_front', front.id],
        ['insp_rear', rear.id],
      ]);
    });

    it('derives the cover period from the duration when the client sends none', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);

      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('BAC').toUpperCase(), { coverageDurationId: '1q' }))
        .expect(201);

      const { startDate, endDate, daysTotal } = response.body.policyDates;
      expect(Date.parse(endDate)).toBeGreaterThan(Date.parse(startDate));
      expect(daysTotal).toBeGreaterThanOrEqual(89);
      expect(daysTotal).toBeLessThanOrEqual(92);
      expect((await storedRequest(response.body.id)).coverageDays).toBe(daysTotal);
    });

    it('reuses the vehicle already on file for that plate, however it is spaced, and takes the confirmed details', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);
      const plate = unique('bad').replace('-', '');
      const existing = await buildVehicle(testApp.db, { plateNumber: plate.toLowerCase(), color: 'Red' });

      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(`${plate.slice(0, 3).toUpperCase()} ${plate.slice(3)}`))
        .expect(201);

      const stored = await storedRequest(response.body.id);
      expect(stored.vehicleId).toBe(existing.id);
      const [vehicle] = await testApp.db.select().from(vehicles).where(eq(vehicles.id, existing.id));
      expect(vehicle).toMatchObject({ plateNumber: `${plate.slice(0, 3).toUpperCase()} ${plate.slice(3)}`, color: 'White' });
      expect(response.body.vehicleDetails.plateNumber).toBe(`${plate.slice(0, 3).toUpperCase()} ${plate.slice(3)}`);
    });

    it('refuses a value above the supported maximum with 400 and stores nothing', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);
      const plate = unique('BAE').toUpperCase();

      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(plate, { vehicleValue: MAX_KWACHA + 0.01 }))
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(await requestsOf(customer.id)).toEqual([]);
      expect(await testApp.db.select().from(vehicles).where(eq(vehicles.plateNumber, plate))).toEqual([]);
    });

    it('creates the request, its recipients and its photos atomically', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);
      const plate = unique('BAF').toUpperCase();
      const first = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });
      const second = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });

      // Two photos for one shot key: the request and its recipients are written before the photos clash.
      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(
          submission(plate, {
            inspectionShots: [
              { shotKey: 'insp_front', documentId: first.id },
              { shotKey: 'insp_front', documentId: second.id },
            ],
          }),
        )
        .expect(409);

      expect(response.body.code).toBe('CONFLICT');
      expect(await requestsOf(customer.id)).toEqual([]);
      expect(await testApp.db.select().from(vehicles).where(eq(vehicles.plateNumber, plate))).toEqual([]);
      expect(await testApp.db.select().from(inspectionShots).where(inArray(inspectionShots.documentId, [first.id, second.id]))).toEqual([]);
    });

    describe('attaching photos', () => {
      const attempt = async (customer: Customer, documentIds: string[], status: number) =>
        testApp.http
          .post('/api/v1/quote-requests')
          .set(await asCustomer(customer))
          .send(
            submission(unique('BAG').toUpperCase(), {
              inspectionShots: documentIds.map((documentId, index) => ({ shotKey: `shot_${index}`, documentId })),
            }),
          )
          .expect(status);

      it('refuses a photo uploaded by someone else, of the wrong kind, already attached or never uploaded, and stores nothing', async () => {
        const customer = await buildCustomer(testApp.db);
        const other = await buildCustomer(testApp.db);
        await buildInsurer(testApp.db);
        const theirs = await buildDocument(testApp.db, { customerId: other.id }, { kind: 'INSPECTION_PHOTO' });
        const wrongKind = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'QUOTATION' });
        const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] });
        const { document: attached } = await buildInspectionShot(testApp.db, {
          quoteRequestId: quoteRequest.id,
          uploader: { customerId: customer.id },
        });

        for (const documentId of [theirs.id, wrongKind.id, attached.id, randomUUID()]) {
          const response = await attempt(customer, [documentId], 409);
          expect(response.body.code).toBe('DOCUMENT_NOT_ATTACHABLE');
        }
        expect((await requestsOf(customer.id)).map((request) => request.id)).toEqual([quoteRequest.id]);
      });

      it('refuses one photo named twice with 400', async () => {
        const customer = await buildCustomer(testApp.db);
        await buildInsurer(testApp.db);
        const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO' });

        const response = await attempt(customer, [photo.id, photo.id.toUpperCase()], 400);
        expect(response.body.code).toBe('VALIDATION_FAILED');
        expect(await requestsOf(customer.id)).toEqual([]);
      });

      it('attaches a fresh upload of the customer’s own', async () => {
        const customer = await buildCustomer(testApp.db);
        await buildInsurer(testApp.db);
        const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO' });

        const response = await attempt(customer, [photo.id], 201);
        expect(await shotsOf(response.body.id)).toMatchObject([{ shotKey: 'shot_0', documentId: photo.id }]);
      });
    });

    describe('with a no-claim discount code', () => {
      const submitWithCode = async (customer: Customer, code: string) => {
        const response = await testApp.http
          .post('/api/v1/quote-requests')
          .set(await asCustomer(customer))
          .send(submission(unique('BAH').toUpperCase(), { ncdCode: code }))
          .expect(201);
        return storedRequest(response.body.id);
      };

      it('records the customer’s own approved code, in any letter case', async () => {
        const customer = await buildCustomer(testApp.db);
        const { insurer } = await buildInsurer(testApp.db);
        const code = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.id }, { percentage: 15 });

        const stored = await submitWithCode(customer, ` ${code.code.toLowerCase()} `);
        expect(stored).toMatchObject({ ncdCode: code.code, ncdPercentage: 15 });
      });

      it('drops another customer’s valid code exactly as it drops an unknown one', async () => {
        const customer = await buildCustomer(testApp.db);
        const other = await buildCustomer(testApp.db);
        const { insurer } = await buildInsurer(testApp.db);
        const theirs = await buildApprovedNcdCode(testApp.db, { customerId: other.id, insurerId: insurer.id });
        const unowned = await buildNcdCode(testApp.db, { insurerId: insurer.id });

        for (const code of [theirs.code, unowned.code, 'NCD-NOBODY-HAS-THIS']) {
          const stored = await submitWithCode(customer, code);
          expect(stored).toMatchObject({ ncdCode: null, ncdPercentage: null });
        }
      });

      it('drops the customer’s own code once it is redeemed or expired', async () => {
        const customer = await buildCustomer(testApp.db);
        const { insurer } = await buildInsurer(testApp.db);
        const redeemed = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.id }, { redeemedAt: new Date() });
        const expired = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.id }, { expiresAt: inDays(-1) });

        for (const code of [redeemed.code, expired.code]) {
          const stored = await submitWithCode(customer, code);
          expect(stored).toMatchObject({ ncdCode: null, ncdPercentage: null });
        }
      });
    });

    it('waits for an insurer being deactivated, and leaves it out once the change commits', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer: leaving } = await buildInsurer(testApp.db);
      const { insurer: staying } = await buildInsurer(testApp.db);
      const held = await holdLocks((db) => db.update(insurers).set({ status: 'INACTIVE' }).where(eq(insurers.id, leaving.id)));
      const submit = async () =>
        testApp.http.post('/api/v1/quote-requests').set(await asCustomer(customer)).send(submission(unique('BAK').toUpperCase()));

      const [response] = await queueBehind(held, SHARING_THE_INSURERS, 1, [submit]);

      expect(response.status).toBe(201);
      expect(response.body.insurerIds).toContain(staying.id);
      expect(response.body.insurerIds).not.toContain(leaving.id);
      expect((await recipientsOf(response.body.id)).map((recipient) => recipient.insurerId)).not.toContain(leaving.id);
    });

    it('refuses when no insurer is accepting requests, and stores nothing', async () => {
      const customer = await buildCustomer(testApp.db);
      const plate = unique('BAJ').toUpperCase();
      await withNoActiveInsurers(async () => {
        const response = await testApp.http
          .post('/api/v1/quote-requests')
          .set(await asCustomer(customer))
          .send(submission(plate))
          .expect(409);
        expect(response.body.code).toBe('NO_ACTIVE_INSURERS');
      });
      expect(await requestsOf(customer.id)).toEqual([]);
      expect(await testApp.db.select().from(vehicles).where(eq(vehicles.plateNumber, plate))).toEqual([]);
    });
  });

  describe('POST /quote-requests/:id/requote', () => {
    it('sends the same vehicle out again, linked both ways, and only once', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(
        testApp.db,
        { customerId: customer.id, insurerIds: [insurer.id] },
        { status: 'EXPIRED', vehicleValueMinor: 250_000_00, vehicleUsage: 'Commercial', insuranceType: 'THIRD_PARTY', coverageDuration: 'Q3' },
      );

      const response = await testApp.http
        .post(`/api/v1/quote-requests/${quoteRequest.id}/requote`)
        .set(await asCustomer(customer))
        .expect(201);

      expect(Object.keys(response.body).sort()).toEqual(QUOTE_REQUEST_KEYS);
      expect(response.body).toMatchObject({
        status: 'Submitted',
        vehicleValue: 250_000,
        vehicleUsage: 'Commercial',
        insuranceType: 'ThirdParty',
        coverageDurationId: '3q',
        requotedFromId: quoteRequest.id,
        requotedAs: null,
        policyDates: null,
      });
      expect(response.body.id).not.toBe(quoteRequest.id);
      expect((await storedRequest(response.body.id)).vehicleId).toBe(quoteRequest.vehicleId);
      expect((await recipientsOf(response.body.id)).length).toBeGreaterThan(0);

      const original = await testApp.http.get(`/api/v1/quote-requests/${quoteRequest.id}`).set(await asCustomer(customer)).expect(200);
      expect(original.body.requotedAs).toBe(response.body.id);

      const again = await testApp.http
        .post(`/api/v1/quote-requests/${quoteRequest.id}/requote`)
        .set(await asCustomer(customer))
        .expect(409);
      expect(again.body.code).toBe('ALREADY_REQUOTED');
    });

    it('sends a request again once when two requotes arrive together, and answers the other ALREADY_REQUOTED', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] }, { status: 'EXPIRED' });
      const held = await holdLocks((db) =>
        db.select({ id: quoteRequests.id }).from(quoteRequests).where(eq(quoteRequests.id, quoteRequest.id)).for('update'),
      );
      const requote = async () =>
        testApp.http.post(`/api/v1/quote-requests/${quoteRequest.id}/requote`).set(await asCustomer(customer));

      const responses = await queueBehind(held, LOCKING_THE_REQUEST, 2, [requote, requote]);

      expect(statuses(responses)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_REQUOTED');
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.requotedFromId, quoteRequest.id))).toHaveLength(1);
    });

    it('answers 404 for another customer’s request', async () => {
      const owner = await buildCustomer(testApp.db);
      const other = await buildCustomer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: owner.id, insurerIds: [] });

      await testApp.http.post(`/api/v1/quote-requests/${quoteRequest.id}/requote`).set(await asCustomer(other)).expect(404);
      expect(await requestsOf(other.id)).toEqual([]);
    });
  });

  describe('GET /policies', () => {
    it('returns the known values of a policy with its documents and renewal state, and exactly the expected keys', async () => {
      const customer = await buildCustomer(testApp.db, { fullName: 'Mwiza Banda', phone: '+260970654321' });
      const insurer = await buildInsurer(testApp.db);
      const endDate = inDays(65);
      const purchase = await buildPurchasedPolicy(testApp.db, { customer, insurer });
      await testApp.db
        .update(quoteRequests)
        .set({ policyStartDate: inDays(-300), policyEndDate: endDate })
        .where(eq(quoteRequests.id, purchase.quoteRequest.id));
      await testApp.db
        .update(vehicles)
        .set({
          plateNumber: 'BAZ 9901',
          make: 'Toyota',
          model: 'Hilux',
          year: '2020',
          color: 'White',
          registrationCountry: 'Zambia',
          chassisNumber: 'JTEH1234560012345',
          engineNumber: null,
          rtsaAnniversaryDate: new Date('2027-03-01T00:00:00.456Z'),
        })
        .where(eq(vehicles.id, purchase.quoteRequest.vehicleId));
      await testApp.db
        .update(policies)
        .set({
          insurerPolicyNumber: 'GG-2026-0001',
          plan: 'Elite Security Policy',
          premiumMinor: 123_456,
          policyStartDate: new Date('2026-01-01T00:00:00.000Z'),
          policyEndDate: endDate,
          receivedAt: new Date('2026-01-01T10:00:00.123Z'),
        })
        .where(eq(policies.policyNumber, purchase.policy.policyNumber));
      await testApp.db
        .update(payments)
        .set({ amountMinor: 123_456, confirmedAt: new Date('2026-01-01T09:59:59.999Z') })
        .where(eq(payments.id, purchase.payment.id));

      const response = await testApp.http.get('/api/v1/policies').set(await asCustomer(customer)).expect(200);

      expect(response.body).toHaveLength(1);
      const [body] = response.body;
      expect(Object.keys(body).sort()).toEqual(POLICY_KEYS);
      expect(Object.keys(body.quoteDocument).sort()).toEqual(DOCUMENT_KEYS);
      expect(body).toEqual({
        policyNumber: purchase.policy.policyNumber,
        insurerPolicyNumber: 'GG-2026-0001',
        status: 'Awaiting insurer certificate',
        customerName: 'Mwiza Banda',
        customerEmail: customer.email,
        customerPhone: '+260970654321',
        insurer: insurer.insurer.name,
        coverage: 'Comprehensive',
        plan: 'Elite Security Policy',
        premium: 1234.56,
        vehicle: '2020 Toyota Hilux',
        vehicleDetails: {
          plateNumber: 'BAZ 9901',
          make: 'Toyota',
          model: 'Hilux',
          year: '2020',
          color: 'White',
          registrationCountry: 'Zambia',
          chassisNumber: 'JTEH1234560012345',
          engineNumber: null,
          rtsaAnniversaryDate: '2027-03-01T00:00:00.456Z',
        },
        renewal: { window: 'NOT_DUE', daysRemaining: 65, endDate: endDate.toISOString(), renewable: true, renewalRequestId: null },
        policyDates: { startDate: '2026-01-01T00:00:00.000Z', endDate: endDate.toISOString() },
        quoteRequestId: purchase.quoteRequest.id,
        insurerQuoteReference: purchase.quote.insurerReference,
        quoteDocument: await documentResponse(purchase.quotation),
        certificateDocument: null,
        paymentProof: {
          transactionId: purchase.payment.transactionId,
          status: 'Confirmed',
          method: 'Mobile money',
          amount: 1234.56,
          currency: 'ZMW',
          confirmedAt: '2026-01-01T09:59:59.999Z',
        },
        receivedAt: '2026-01-01T10:00:00.123Z',
        issuedAt: null,
      });
    });

    it('marks a policy inside the window as due, a lapsed one as expired, and the last day as still in force', async () => {
      const customer = await buildCustomer(testApp.db);
      const cases: [number, string][] = [
        [30, 'DUE'],
        [-9, 'EXPIRED'],
        [0, 'DUE'],
        [200, 'NOT_DUE'],
      ];
      const expected: Record<string, { window: string; daysRemaining: number }> = {};
      for (const [days, window] of cases) {
        const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
        await testApp.db.update(policies).set({ policyEndDate: inDays(days) }).where(eq(policies.policyNumber, policy.policyNumber));
        expected[policy.policyNumber] = { window, daysRemaining: days };
      }

      const response = await testApp.http.get('/api/v1/policies').set(await asCustomer(customer)).expect(200);

      for (const body of response.body) {
        expect(body.renewal).toMatchObject({ ...expected[body.policyNumber], renewable: true, renewalRequestId: null });
      }
    });

    it('reports a renewal in flight instead of offering another, until it lapses', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const { policy, quoteRequest } = await buildPurchasedPolicy(testApp.db, { customer, insurer });
      const { quoteRequest: open } = await buildRenewalRequest(testApp.db, {
        customerId: customer.id,
        vehicleId: quoteRequest.vehicleId,
        policyNumber: policy.policyNumber,
        insurerIds: [insurer.insurer.id],
      });

      const inFlight = await testApp.http.get(`/api/v1/policies/${policy.policyNumber}`).set(await asCustomer(customer)).expect(200);
      expect(inFlight.body.renewal).toMatchObject({ renewable: false, renewalRequestId: open.id });

      await testApp.db.update(quoteRequests).set({ status: 'EXPIRED', expiresAt: inDays(-1) }).where(eq(quoteRequests.id, open.id));
      const lapsed = await testApp.http.get(`/api/v1/policies/${policy.policyNumber}`).set(await asCustomer(customer)).expect(200);
      expect(lapsed.body.renewal).toMatchObject({ renewable: true, renewalRequestId: null });
    });

    it('answers 404 for another customer’s policy and leaves it out of the list', async () => {
      const other = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db);

      await testApp.http.get(`/api/v1/policies/${policy.policyNumber}`).set(await asCustomer(other)).expect(404);
      const list = await testApp.http.get('/api/v1/policies').set(await asCustomer(other)).expect(200);
      expect(list.body).toEqual([]);
    });
  });

  describe('POST /policies/:policyNumber/renew', () => {
    it('carries the vehicle and cover forward and starts cover when the old policy ends', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const endDate = new Date('2027-02-01T00:00:00.000Z');
      const { policy, quoteRequest } = await buildPurchasedPolicy(testApp.db, { customer, insurer });
      await testApp.db
        .update(quoteRequests)
        .set({ vehicleValueMinor: 320_000_00, vehicleUsage: 'Commercial', insuranceType: 'THIRD_PARTY', coverageDuration: 'Q2', matchRtsaAnniversary: true })
        .where(eq(quoteRequests.id, quoteRequest.id));
      await testApp.db.update(policies).set({ policyEndDate: endDate }).where(eq(policies.policyNumber, policy.policyNumber));

      const response = await testApp.http
        .post(`/api/v1/policies/${policy.policyNumber}/renew`)
        .set(await asCustomer(customer))
        .expect(201);

      expect(Object.keys(response.body).sort()).toEqual(QUOTE_REQUEST_KEYS);
      expect(response.body).toMatchObject({
        status: 'Submitted',
        vehicleValue: 320_000,
        vehicleUsage: 'Commercial',
        insuranceType: 'ThirdParty',
        coverageDurationId: '2q',
        matchRtsaAnniversary: true,
        policyDates: null,
        requotedFromId: null,
      });
      expect(response.body.insurerIds).toContain(insurer.insurer.id);
      const stored = await storedRequest(response.body.id);
      expect(stored).toMatchObject({
        vehicleId: quoteRequest.vehicleId,
        renewalOfPolicyNumber: policy.policyNumber,
        policyStartDate: endDate,
        policyEndDate: null,
      });

      const again = await testApp.http
        .post(`/api/v1/policies/${policy.policyNumber}/renew`)
        .set(await asCustomer(customer))
        .expect(409);
      expect(again.body.code).toBe('RENEWAL_IN_PROGRESS');
      expect(again.body.message).toContain(response.body.id);
    });

    it('still renews a policy whose original request is gone, using safe defaults', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      await testApp.db
        .update(policies)
        .set({ quoteRequestId: null, premiumMinor: 12_800_00 })
        .where(eq(policies.policyNumber, policy.policyNumber));

      const response = await testApp.http
        .post(`/api/v1/policies/${policy.policyNumber}/renew`)
        .set(await asCustomer(customer))
        .expect(201);

      expect(response.body).toMatchObject({
        insuranceType: 'Comprehensive',
        coverageDurationId: '4q',
        vehicleUsage: 'Individual',
        vehicleValue: 12_800,
        matchRtsaAnniversary: false,
      });
    });

    it('offers renewal again once the previous renewal request has lapsed', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const { policy, quoteRequest } = await buildPurchasedPolicy(testApp.db, { customer, insurer });
      await buildRenewalRequest(
        testApp.db,
        { customerId: customer.id, vehicleId: quoteRequest.vehicleId, policyNumber: policy.policyNumber, insurerIds: [] },
        { status: 'EXPIRED', expiresAt: inDays(-1) },
      );

      await testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(customer)).expect(201);
    });

    it('starts one renewal when two arrive together, and answers the other RENEWAL_IN_PROGRESS', async () => {
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      const held = await holdLocks((db) =>
        db.select({ policyNumber: policies.policyNumber }).from(policies).where(eq(policies.policyNumber, policy.policyNumber)).for('update'),
      );
      const renew = async () => testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(customer));

      const responses = await queueBehind(held, LOCKING_THE_POLICY, 2, [renew, renew]);

      expect(statuses(responses)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('RENEWAL_IN_PROGRESS');
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.renewalOfPolicyNumber, policy.policyNumber))).toHaveLength(1);
    });

    it('answers 404 for another customer’s policy, and 409 when no insurer accepts requests', async () => {
      const other = await buildCustomer(testApp.db);
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });

      await testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(other)).expect(404);
      await withNoActiveInsurers(async () => {
        const response = await testApp.http
          .post(`/api/v1/policies/${policy.policyNumber}/renew`)
          .set(await asCustomer(customer))
          .expect(409);
        expect(response.body.code).toBe('NO_ACTIVE_INSURERS');
      });
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.renewalOfPolicyNumber, policy.policyNumber))).toEqual([]);
    });
  });

  describe('GET /claims', () => {
    it('returns the known values of the customer’s claims with their attachments, and exactly the expected keys', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      const small = await buildClaim(
        testApp.db,
        { insurerId: insurer.id, customerId: customer.id, policyNumber: policy.policyNumber },
        {
          status: 'RECEIVED_BY_INSURER',
          fullName: 'Mwiza Banda',
          phone: '0970123456',
          email: 'mwiza@example.invalid',
          plate: 'BAA 1234',
          vehicleLabel: '2020 Toyota Hilux',
          type: 'Theft',
          incidentDate: new Date('2026-10-20T06:15:00.000Z'),
          location: 'Woodlands, Lusaka',
          description: 'Vehicle stolen from outside the residence overnight.',
          estimatedLossMinor: 1,
          policeReport: true,
          policeReportNumber: 'PR-77',
          submittedAt: new Date('2026-10-21T08:00:00.123Z'),
          receivedAt: new Date('2026-10-22T08:00:00.456Z'),
          insurerClaimReference: 'INS-CLM-9',
        },
      );
      const { document } = await buildClaimAttachment(testApp.db, { claimNumber: small.claimNumber, uploader: { customerId: customer.id } });
      const unknownLoss = await buildClaim(
        testApp.db,
        { insurerId: insurer.id, customerId: customer.id },
        { estimatedLossMinor: null, submittedAt: new Date('2026-10-23T08:00:00.000Z') },
      );
      await buildClaim(testApp.db, { insurerId: insurer.id, customerId: (await buildCustomer(testApp.db)).id });

      const response = await testApp.http.get('/api/v1/claims').set(await asCustomer(customer)).expect(200);

      expect(response.body.map((item: { claimNumber: string }) => item.claimNumber)).toEqual([unknownLoss.claimNumber, small.claimNumber]);
      const [later, body] = response.body;
      expect(Object.keys(body).sort()).toEqual(CLAIM_LIST_KEYS);
      expect(Object.keys(body.supportingDocs[0]).sort()).toEqual(DOCUMENT_KEYS);
      expect(body).toEqual({
        claimNumber: small.claimNumber,
        status: 'Received by insurer',
        insurer: insurer.name,
        customerEmail: customer.email,
        fullName: 'Mwiza Banda',
        phone: '0970123456',
        email: 'mwiza@example.invalid',
        plate: 'BAA 1234',
        vehicle: '2020 Toyota Hilux',
        type: 'Theft',
        incidentDate: '2026-10-20T06:15:00.000Z',
        location: 'Woodlands, Lusaka',
        description: 'Vehicle stolen from outside the residence overnight.',
        estimatedLoss: 0.01,
        policeReport: true,
        policeReportNumber: 'PR-77',
        policyNumber: policy.policyNumber,
        insurerClaimReference: 'INS-CLM-9',
        submittedAt: '2026-10-21T08:00:00.123Z',
        receivedAt: '2026-10-22T08:00:00.456Z',
        supportingDocs: [await documentResponse(document)],
      });
      expect(later).toMatchObject({ estimatedLoss: null, receivedAt: null, supportingDocs: [], policyNumber: null });
    });
  });

  describe('POST /claims', () => {
    it('issues a claim number, attaches the documents and stores the loss in ngwee', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });

      const response = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .send(
          claim(insurer.id, {
            policyNumber: policy.policyNumber,
            estimatedLoss: 0.01,
            policeReport: true,
            policeReportNumber: ' PR-77 ',
            lateReason: 'I was in hospital.',
            supportingDocumentIds: [photo.id],
          }),
        )
        .expect(201);

      expect(Object.keys(response.body).sort()).toEqual(CLAIM_NOTIFIED_KEYS);
      expect(response.body).toEqual({
        claimNumber: expect.stringMatching(/^CLM-/),
        status: 'Notified',
        insurer: insurer.name,
        fullName: 'Mwiza Banda',
        phone: '0970123456',
        email: null,
        plate: 'BAA 1234',
        vehicle: '2020 Toyota Hilux',
        type: 'Theft',
        incidentDate: '2026-10-20T06:15:00.000Z',
        location: 'Woodlands, Lusaka',
        description: 'Vehicle stolen from outside the residence overnight.',
        estimatedLoss: 0.01,
        policeReport: true,
        policeReportNumber: 'PR-77',
        lateReason: 'I was in hospital.',
        policyNumber: policy.policyNumber,
        submittedAt: expect.stringMatching(ISO_MS),
        receivedAt: null,
        supportingDocs: [await documentResponse(photo)],
      });
      const [stored] = await claimsOf(customer.id);
      expect(stored).toMatchObject({ claimNumber: response.body.claimNumber, estimatedLossMinor: 1, status: 'NOTIFIED', lateReason: 'I was in hospital.' });
      expect(await testApp.db.select().from(claimAttachments).where(eq(claimAttachments.claimNumber, stored.claimNumber))).toMatchObject([
        { documentId: photo.id },
      ]);
    });

    it('drops a policy number that is not the customer’s rather than refusing the claim', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db);

      const response = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .send(claim(insurer.id, { policyNumber: policy.policyNumber }))
        .expect(201);

      expect(response.body.policyNumber).toBeNull();
      expect(response.body.estimatedLoss).toBeNull();
    });

    it('stores neither the claim nor its attachments when the claim fails after it was written', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });
      const notify = async () =>
        testApp.http.post('/api/v1/claims').set(await asCustomer(customer)).send(claim(insurer.id, { supportingDocumentIds: [photo.id] }));

      const signing = vi.spyOn(testApp.storage, 'signedDownloadUrl').mockRejectedValueOnce(new Error('signing failed'));
      try {
        expect((await notify()).status).toBe(500);
      } finally {
        signing.mockRestore();
      }

      expect(await claimsOf(customer.id)).toEqual([]);
      expect(await testApp.db.select().from(claimAttachments).where(eq(claimAttachments.documentId, photo.id))).toEqual([]);
      expect((await notify()).status).toBe(201);
    });

    it('refuses a loss above the supported maximum with 400 and stores nothing', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);

      const response = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .send(claim(insurer.id, { estimatedLoss: MAX_KWACHA + 0.01 }))
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(await claimsOf(customer.id)).toEqual([]);
    });

    it('answers 404 for a deleted insurer', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db, { insurer: { status: 'DELETED', deletedAt: new Date() } });

      await testApp.http.post('/api/v1/claims').set(await asCustomer(customer)).send(claim(insurer.id)).expect(404);
      await testApp.http.post('/api/v1/claims').set(await asCustomer(customer)).send(claim(randomUUID())).expect(404);
      expect(await claimsOf(customer.id)).toEqual([]);
    });

    describe('on a pool of two connections', () => {
      let small: TestApp;
      let pool: Pool;

      beforeAll(async () => {
        pool = productionPool(testDatabase().url, 2);
        small = await startApp({
          override: (builder) => builder.overrideProvider(DATABASE).useValue(createDatabase(pool, { schema })),
        });
      });

      afterAll(async () => {
        await small.close();
        await pool.end();
      });

      it('notifies two claims with attachments at once, each reading its documents in its own transaction', async () => {
        const { insurer } = await buildInsurer(testApp.db);
        const claimants = [await buildCustomer(testApp.db), await buildCustomer(testApp.db)];
        const photos = [
          await buildDocument(testApp.db, { customerId: claimants[0].id }, { kind: 'CLAIM_ATTACHMENT' }),
          await buildDocument(testApp.db, { customerId: claimants[1].id }, { kind: 'CLAIM_ATTACHMENT' }),
        ];
        const held = await holdLocks((db) =>
          db.select({ id: documentsTable.id }).from(documentsTable).where(inArray(documentsTable.id, photos.map((photo) => photo.id))).for('update'),
        );
        const notify = (index: number) => async () =>
          small.http
            .post('/api/v1/claims')
            .set(await asCustomer(claimants[index]))
            .send(claim(insurer.id, { supportingDocumentIds: [photos[index].id] }));

        const responses = await queueBehind(held, LOCKING_THE_DOCUMENTS, 2, [notify(0), notify(1)]);

        expect(statuses(responses)).toEqual([201, 201]);
        expect(responses.map((response) => response.body.supportingDocs[0].id)).toEqual(photos.map((photo) => photo.id));
      });
    });

    describe('attaching documents', () => {
      it('refuses a document uploaded by someone else, of the wrong kind, already attached or never uploaded, and stores nothing', async () => {
        const customer = await buildCustomer(testApp.db);
        const other = await buildCustomer(testApp.db);
        const { insurer } = await buildInsurer(testApp.db);
        const theirs = await buildDocument(testApp.db, { customerId: other.id }, { kind: 'CLAIM_ATTACHMENT' });
        const wrongKind = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO' });
        const earlier = await buildClaim(testApp.db, { insurerId: insurer.id, customerId: customer.id });
        const { document: attached } = await buildClaimAttachment(testApp.db, { claimNumber: earlier.claimNumber, uploader: { customerId: customer.id } });

        for (const documentId of [theirs.id, wrongKind.id, attached.id, randomUUID()]) {
          const response = await testApp.http
            .post('/api/v1/claims')
            .set(await asCustomer(customer))
            .send(claim(insurer.id, { supportingDocumentIds: [documentId] }))
            .expect(409);
          expect(response.body.code).toBe('DOCUMENT_NOT_ATTACHABLE');
        }
        expect((await claimsOf(customer.id)).map((row) => row.claimNumber)).toEqual([earlier.claimNumber]);
      });

      it('refuses one document named twice with 400', async () => {
        const customer = await buildCustomer(testApp.db);
        const { insurer } = await buildInsurer(testApp.db);
        const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });

        const response = await testApp.http
          .post('/api/v1/claims')
          .set(await asCustomer(customer))
          .send(claim(insurer.id, { supportingDocumentIds: [photo.id, photo.id] }))
          .expect(400);
        expect(response.body.code).toBe('VALIDATION_FAILED');
        expect(await claimsOf(customer.id)).toEqual([]);
      });
    });
  });

  describe('NCD applications', () => {
    it('lists the customer’s applications with known values and exactly the expected keys', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const code = await buildNcdCode(testApp.db, { insurerId: insurer.id });
      const approved = await buildNcdApplication(
        testApp.db,
        { customerId: customer.id, insurerId: insurer.id, approvedCode: code },
        { policyNumber: 'PA-2023-0045', fullName: 'Mwiza Banda', phone: '0970123456', yearsClaimFree: 3, submittedAt: new Date('2026-09-01T08:00:00.123Z') },
      );
      const pending = await buildNcdApplication(
        testApp.db,
        { customerId: customer.id, insurerId: insurer.id },
        { status: 'UNDER_REVIEW', submittedAt: new Date('2026-09-02T08:00:00.000Z') },
      );
      await buildNcdApplication(testApp.db, { customerId: (await buildCustomer(testApp.db)).id, insurerId: insurer.id });

      const response = await testApp.http.get('/api/v1/ncd/applications').set(await asCustomer(customer)).expect(200);

      expect(response.body.map((item: { id: string }) => item.id)).toEqual([pending.id, approved.id]);
      const [, body] = response.body;
      expect(Object.keys(body).sort()).toEqual(NCD_APPLICATION_KEYS);
      expect(body).toEqual({
        id: approved.id,
        applicationNumber: approved.applicationNumber,
        insurer: insurer.name,
        policyNumber: 'PA-2023-0045',
        fullName: 'Mwiza Banda',
        phone: '0970123456',
        yearsClaimFree: 3,
        status: 'Approved',
        approvedCode: code.code,
        submittedAt: '2026-09-01T08:00:00.123Z',
      });
      expect(response.body[0]).toMatchObject({ status: 'Under Review', approvedCode: null });
    });

    it('applies to an active insurer and answers 404 for an inactive one', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const inactive = await buildInsurer(testApp.db, { insurer: { status: 'INACTIVE' } });
      const application = { insurerId: insurer.id, policyNumber: ' PA-2023-0045 ', fullName: ' Mwiza Banda ', phone: ' 0970123456 ', yearsClaimFree: 3 };

      const response = await testApp.http.post('/api/v1/ncd/applications').set(await asCustomer(customer)).send(application).expect(201);

      expect(Object.keys(response.body).sort()).toEqual(NCD_APPLICATION_KEYS);
      expect(response.body).toEqual({
        id: expect.any(String),
        applicationNumber: expect.stringMatching(/^NCDA-/),
        insurer: insurer.name,
        policyNumber: 'PA-2023-0045',
        fullName: 'Mwiza Banda',
        phone: '0970123456',
        yearsClaimFree: 3,
        status: 'Submitted',
        approvedCode: null,
        submittedAt: expect.stringMatching(ISO_MS),
      });
      const [stored] = await testApp.db.select().from(ncdApplications).where(eq(ncdApplications.customerId, customer.id));
      expect(stored).toMatchObject({ id: response.body.id, insurerId: insurer.id, status: 'SUBMITTED' });

      await testApp.http
        .post('/api/v1/ncd/applications')
        .set(await asCustomer(customer))
        .send({ ...application, insurerId: inactive.insurer.id })
        .expect(404);
    });
  });

  describe('POST /ncd/codes/validate', () => {
    it('describes a usable code, and says why one is not, without signing in', async () => {
      const { insurer } = await buildInsurer(testApp.db);
      const expiresAt = inDays(90);
      const usable = await buildNcdCode(testApp.db, { insurerId: insurer.id }, { percentage: 15, yearsClaimFree: 3, expiresAt });
      const used = await buildNcdCode(testApp.db, { insurerId: insurer.id }, { redeemedAt: new Date() });
      const expired = await buildNcdCode(testApp.db, { insurerId: insurer.id }, { expiresAt: inDays(-1) });

      const valid = await testApp.http.post('/api/v1/ncd/codes/validate').send({ code: ` ${usable.code.toLowerCase()} ` }).expect(200);
      expect(valid.body).toEqual({
        valid: true,
        code: usable.code,
        insurerId: insurer.id,
        insurer: insurer.name,
        percentage: 15,
        yearsClaimFree: 3,
        expiresAt: expiresAt.toISOString(),
      });
      for (const [code, reason] of [
        [used.code, 'ALREADY_USED'],
        [expired.code, 'EXPIRED'],
        ['NCD-NOBODY-HAS-THIS', 'NOT_FOUND'],
      ]) {
        const response = await testApp.http.post('/api/v1/ncd/codes/validate').send({ code }).expect(200);
        expect(response.body).toEqual({ valid: false, reason });
      }
    });
  });

  describe('DELETE /account', () => {
    const closeAccount = async (customer: Customer) => testApp.http.delete('/api/v1/account').set(await asCustomer(customer));
    const isOpen = async (customer: Customer) => {
      const [row] = await testApp.db.select().from(customers).where(eq(customers.id, customer.id));
      return row.deletedAt === null;
    };

    it('refuses while an active policy is in force', async () => {
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      await testApp.db.update(policies).set({ status: 'ACTIVE' }).where(eq(policies.policyNumber, policy.policyNumber));

      const response = await closeAccount(customer);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ACTIVE_POLICY_EXISTS');
      expect(response.body.message).toBe('This account holds 1 policy in force. Cover must end before the account can be closed.');
      expect(await isOpen(customer)).toBe(true);
    });

    it('refuses while a paid policy awaits its certificate, and counts every policy in force', async () => {
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      expect(policy.status).toBe('AWAITING_INSURER_CERTIFICATE');

      const response = await closeAccount(customer);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ACTIVE_POLICY_EXISTS');

      await buildPurchasedPolicy(testApp.db, { customer });
      expect((await closeAccount(customer)).body.message).toContain('holds 2 policies in force');
      expect(await isOpen(customer)).toBe(true);
    });

    it('refuses while a renewal holding the policy is about to insert, and lets the renewal finish', async () => {
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      const { insurer } = await buildInsurer(testApp.db);
      const held = await holdLocks((db) => db.select({ id: insurers.id }).from(insurers).where(eq(insurers.id, insurer.id)).for('update'));
      const renew = async () => testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(customer));

      const calls = [renew()];
      let closureAnswered = false;
      try {
        await until(async () => (await held.waiters(SHARING_THE_INSURERS)) === 1, 'the renewal to hold its policy');
        calls.push(
          closeAccount(customer).finally(() => {
            closureAnswered = true;
          }),
        );
        await until(
          async () => closureAnswered || (await held.waiters(LOCKING_THE_POLICY)) === 1,
          'the closure to answer or wait on the policy',
        );
      } finally {
        try {
          await held.release();
        } finally {
          await Promise.allSettled(calls);
        }
      }
      const [renewed, closed] = await Promise.all(calls);

      expect([renewed.status, closed.status]).toEqual([201, 409]);
      expect(closed.body.code).toBe('ACTIVE_POLICY_EXISTS');
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.renewalOfPolicyNumber, policy.policyNumber))).toHaveLength(1);
      expect(await isOpen(customer)).toBe(true);
    });

    it('waits for a payment creating the customer’s first policy, then refuses', async () => {
      const customer = await buildCustomer(testApp.db);
      const held = await holdLocks((db) => buildPurchasedPolicy(db, { customer }));

      const [response] = await queueBehind(held, LOCKING_THE_CUSTOMER, 1, [() => closeAccount(customer)]);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ACTIVE_POLICY_EXISTS');
      expect(await isOpen(customer)).toBe(true);
    });

    it('closes an account without policies and refuses the token afterwards', async () => {
      const customer = await buildCustomer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] });

      const response = await closeAccount(customer);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ closed: true, closedAt: expect.stringMatching(ISO_MS) });
      const [row] = await testApp.db.select().from(customers).where(and(eq(customers.id, customer.id), isNull(customers.deletedAt)));
      expect(row).toBeUndefined();
      expect((await storedRequest(quoteRequest.id)).customerId).toBe(customer.id);
      await testApp.http.get('/api/v1/policies').set(await asCustomer(customer)).expect(403);
    });
  });
});
