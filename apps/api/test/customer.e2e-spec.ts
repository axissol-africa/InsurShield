import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { Response } from 'supertest';
import { MAX_KWACHA } from '../src/common/domain/money-limits.js';
import { testDatabase } from '../src/config/env.js';
import { createDatabase, DATABASE } from '../src/db/database.module.js';
import * as schema from '../src/db/schema.js';
import {
  claimAttachments,
  claimNotifications,
  customers,
  inspectionShots,
  integrationDeliveries,
  insurerEvidence,
  inspectionRequestProducts,
  inspections,
  insurerProductVersions,
  insurerProducts,
  insurers,
  ncdApplications,
  payments,
  paymentRefunds,
  reconciliationItems,
  serviceRequests,
  insurerQuotes,
  policies,
  quoteRequestRecipients,
  quoteRequestDrafts,
  quoteRequestProductRequirementAnswers,
  quoteRequestProductRequirementDeclarations,
  quoteRequestProductRequirementDocuments,
  quoteRequestProductVersions,
  productVersionRequirements,
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
  buildPayment,
  buildQuoteRequest,
  buildStaffUser,
  buildVehicle,
  unique,
  type Row,
} from './builders.js';
import { buildPayableQuote } from './builders/payments.js';
import { lusakaDay } from '../src/common/domain/lusaka.js';
import { buildApprovedNcdCode, buildNcdApplication, buildRenewalRequest } from './builders/customer.js';
import { buildClaimAttachment, buildInspectionShot } from './builders/documents.js';
import {
  holdLocks,
  openTestDatabase,
  productionPool,
  queueBehind,
  startApp,
  startRepeatableReadApp,
  type TestApp,
} from './helpers.js';
import { signIn } from './sessions.js';

type Customer = Row<typeof customers>;
type DocumentRow = Row<typeof documentsTable>;

const DAY_MS = 86_400_000;
const inDays = (days: number) => new Date(Date.now() + days * DAY_MS);
const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const LOCKING_THE_REQUEST = 'select % from "quote_requests" % for update';
const LOCKING_THE_POLICY = 'select % from "policies" % for update';
const LOCKING_THE_CUSTOMER = 'select % from "customers" % for update';
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
  'productQuotes',
  'progress',
  'progressLabel',
  'requotedAs',
  'requotedFromId',
  'rtsaAnniversaryFee',
  'selectedProducts',
  'selection',
  'status',
  'submittedAt',
  'unavailableInsurers',
  'vehicle',
  'vehicleDetails',
  'vehicleUsage',
  'vehicleValue',
];
const INSURER_QUOTE_KEYS = [
  'addOns',
  'components',
  'conditions',
  'document',
  'excess',
  'extendedAt',
  'id',
  'insurerReference',
  'notes',
  'premium',
  'productVersionId',
  'sentAt',
  'unavailableAt',
  'validUntil',
  'validityDays',
];
const POLICY_KEYS = [
  'certificateDocument',
  'coverage',
  'customerEmail',
  'customerName',
  'customerPhone',
  'insurer',
  'insurerPolicyNumber',
  'insurerQuoteReference',
  'issuance',
  'issuedAt',
  'paymentProof',
  'plan',
  'policyDates',
  'policyNumber',
  'premium',
  'product',
  'quoteDocument',
  'quoteRequestId',
  'receivedAt',
  'renewal',
  'renewalProduct',
  'rtsaAnniversaryFee',
  'status',
  'vehicle',
  'vehicleDetails',
  'vehicleUsage',
  'vehicleValue',
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
  let defaultSelection: Awaited<ReturnType<typeof productVersionForSelection>>;
  let defaultInsurer: Awaited<ReturnType<typeof buildInsurer>>;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    defaultInsurer = await buildInsurer(testApp.db);
    defaultSelection = await productVersionForSelection(defaultInsurer, unique('DEFAULT_SELECTION'));
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const asCustomer = (customer: Customer) => signIn(testApp.http, customer);

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
  const selectedProductsOf = (id: string) =>
    testApp.db.select().from(quoteRequestProductVersions).where(eq(quoteRequestProductVersions.quoteRequestId, id));
  const requestsOf = (customerId: string) =>
    testApp.db.select().from(quoteRequests).where(eq(quoteRequests.customerId, customerId));
  const claimsOf = (customerId: string) =>
    testApp.db.select().from(claimNotifications).where(eq(claimNotifications.customerId, customerId));
  const vehicleRows = () => testApp.db.select().from(vehicles).orderBy(asc(vehicles.id));

  const submission = (plate: string, overrides: Record<string, unknown> = {}) => ({
    vehicleDetails: { plateNumber: plate, make: 'Toyota', model: 'Hilux', year: '2020', color: 'White' },
    vehicleValue: 1234.56,
    vehicleUsage: 'Individual',
    insuranceType: 'Comprehensive',
    coverageDurationId: '4q',
    selectedProductVersionIds: [defaultSelection.version.id],
    ...overrides,
  });

  async function productVersionForSelection(
    insurer: Awaited<ReturnType<typeof buildInsurer>>,
    code: string,
    overrides: Partial<typeof insurerProductVersions.$inferInsert> = {},
    coverType: 'COMPREHENSIVE' | 'THIRD_PARTY' = 'COMPREHENSIVE',
  ) {
    await testApp.db.insert(insurerEvidence).values({
      insurerId: insurer.insurer.id,
      kind: 'LICENCE',
      state: 'APPROVED',
      reference: `${code}-LICENCE`,
    });
    const [product] = await testApp.db
      .insert(insurerProducts)
      .values({ insurerId: insurer.insurer.id, code, coverType })
      .returning();
    const [version] = await testApp.db
      .insert(insurerProductVersions)
      .values({
        productId: product.id,
        versionNumber: 1,
        status: 'APPROVED',
        name: `${code} cover`,
        coverType,
        coverGuide: { planName: `${code} cover`, summary: 'Customer-facing terms.' },
        inspectionRule: 'NOT_REQUIRED',
        rateBps: 525,
        allowedDurations: ['Q1', 'Q2', 'Q3', 'Q4'],
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdByStaffId: insurer.staff.id,
        ...overrides,
      })
      .returning();
    return { product, version };
  }

  const claim = (insurerId: string, overrides: Record<string, unknown> = {}) => ({
    insurerId,
    fullName: 'Mwiza Banda',
    phone: '0970123456',
    plate: 'BAA 1234',
    vehicle: '2020 Toyota Hilux',
    type: 'Accident / Collision',
    incidentDate: lusakaDay(inDays(-2)),
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

  const statuses = (responses: Response[]) => responses.map((response) => response.status).sort((a, b) => a - b);

  it('refuses a staff token on a customer route', async () => {
    const staff = await buildStaffUser(testApp.db);
    const response = await testApp.http
      .get('/api/v1/quote-requests')
      .set(await signIn(testApp.http, staff))
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
        rtsaAnniversaryFee: 500,
        policyDates: { startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-05-01T00:00:00.000Z', daysTotal: 181 },
        insurers: [quoted.insurer.name, silent.insurer.name],
        insurerIds: [quoted.insurer.id, silent.insurer.id],
        selectedProducts: [],
        insurerQuotes: {
          [quoted.insurer.name]: {
            id: quote.id,
            productVersionId: null,
            premium: 1234.56,
            notes: 'Includes windscreen cover',
            insurerReference: quote.insurerReference,
            validityDays: 14,
            sentAt: '2026-10-02T09:30:00.001Z',
            validUntil: '2026-10-16T09:30:00.001Z',
            extendedAt: '2026-10-10T09:30:00.002Z',
            unavailableAt: null,
            document: await documentResponse(document),
            components: [],
            excess: null,
            addOns: [],
            conditions: [],
          },
        },
        productQuotes: [],
        unavailableInsurers: [],
        photosCapturedAt: '2026-10-01T07:59:00.789Z',
        requotedFromId: null,
        requotedAs: again.id,
        // A request from before product selection keeps its stored status only.
        progress: null,
        progressLabel: null,
        selection: null,
      });
      expect(response.body[0]).toMatchObject({ requotedFromId: quoteRequest.id, requotedAs: null, policyDates: null });
    });

    it('keeps the RTSA fee that was charged on a paid aligned request', async () => {
      const purchase = await buildPurchasedPolicy(testApp.db);
      await testApp.db
        .update(quoteRequests)
        .set({ matchRtsaAnniversary: true })
        .where(eq(quoteRequests.id, purchase.quoteRequest.id));
      await testApp.db
        .update(payments)
        .set({ rtsaAnniversaryFeeMinor: 12_345 })
        .where(eq(payments.id, purchase.payment.id));

      const response = await testApp.http
        .get(`/api/v1/quote-requests/${purchase.quoteRequest.id}`)
        .set(await asCustomer(purchase.customer))
        .expect(200);

      expect(response.body).toMatchObject({ matchRtsaAnniversary: true, rtsaAnniversaryFee: 123.45 });
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
    it('sends a request only to the selected current product’s insurer with the photos attached, and stores the value in ngwee', async () => {
      const customer = await buildCustomer(testApp.db);
      const active = await buildInsurer(testApp.db);
      const inactive = await buildInsurer(testApp.db, { insurer: { status: 'INACTIVE' } });
      const deleted = await buildInsurer(testApp.db, { insurer: { status: 'DELETED', deletedAt: new Date() } });
      const expired = await buildInsurer(testApp.db, { insurer: { licenceExpiry: inDays(-1) } });
      const front = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });
      const rear = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg' });
      const selected = await productVersionForSelection(active, unique('THIRD_PARTY_SELECTION'), {}, 'THIRD_PARTY');

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
            selectedProductVersionIds: [selected.version.id],
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
      expect(response.body.insurerIds).not.toContain(defaultInsurer.insurer.id);
      expect(response.body.insurerIds).not.toContain(inactive.insurer.id);
      expect(response.body.insurerIds).not.toContain(deleted.insurer.id);
      expect(response.body.insurerIds).not.toContain(expired.insurer.id);
      expect(response.body.insurers).toHaveLength(response.body.insurerIds.length);

      const stored = await storedRequest(response.body.id);
      expect(stored).toMatchObject({ model: 'PRODUCT_SELECTION', vehicleValueMinor: 123_456, customerId: customer.id, ncdCode: null, ncdPercentage: null });
      const byId = (left: string, right: string) => left.localeCompare(right);
      expect((await recipientsOf(stored.id)).map((recipient) => recipient.insurerId).sort(byId)).toEqual(
        [...response.body.insurerIds].sort(byId),
      );
      const shots = (await shotsOf(stored.id)).sort((a, b) => a.shotKey.localeCompare(b.shotKey));
      expect(shots.map((shot) => [shot.shotKey, shot.documentId])).toEqual([
        ['insp_front', front.id],
        ['insp_rear', rear.id],
      ]);
    });

    it('selects one to five current product versions, snapshots their terms, and creates one recipient per insurer', async () => {
      const customer = await buildCustomer(testApp.db);
      const firstInsurer = await buildInsurer(testApp.db);
      const secondInsurer = await buildInsurer(testApp.db);
      const unrelated = await buildInsurer(testApp.db);
      const first = await productVersionForSelection(firstInsurer, unique('FIRST'));
      const second = await productVersionForSelection(firstInsurer, unique('SECOND'));
      const third = await productVersionForSelection(secondInsurer, unique('THIRD'));

      const submitted = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(
          submission(unique('S').toUpperCase(), {
            selectedProductVersionIds: [first.version.id, second.version.id, third.version.id],
          }),
        )
        .expect(201);

      expect(submitted.body).toMatchObject({
        insurers: expect.arrayContaining([firstInsurer.insurer.name, secondInsurer.insurer.name]),
        selectedProducts: expect.arrayContaining([
          expect.objectContaining({ productVersionId: first.version.id, productCode: first.product.code, insurerId: firstInsurer.insurer.id }),
          expect.objectContaining({ productVersionId: second.version.id, productCode: second.product.code, insurerId: firstInsurer.insurer.id }),
          expect.objectContaining({ productVersionId: third.version.id, productCode: third.product.code, insurerId: secondInsurer.insurer.id }),
        ]),
        productQuotes: [],
        insurerQuotes: {},
      });
      expect(submitted.body.insurerIds).toHaveLength(2);
      expect(submitted.body.insurerIds).not.toContain(unrelated.insurer.id);
      expect((await recipientsOf(submitted.body.id)).map((recipient) => recipient.insurerId).sort()).toEqual(
        [firstInsurer.insurer.id, secondInsurer.insurer.id].sort(),
      );
      expect(await selectedProductsOf(submitted.body.id)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ productVersionId: first.version.id, insurerId: firstInsurer.insurer.id, productCode: first.product.code }),
          expect.objectContaining({ productVersionId: second.version.id, insurerId: firstInsurer.insurer.id, productCode: second.product.code }),
          expect.objectContaining({ productVersionId: third.version.id, insurerId: secondInsurer.insurer.id, productCode: third.product.code }),
        ]),
      );
      expect(await storedRequest(submitted.body.id)).toMatchObject({ model: 'PRODUCT_SELECTION' });
      // Each chosen product starts waiting for its insurer, due by the reply
      // deadline rule's default of seven days.
      const submittedAt = new Date(submitted.body.submittedAt).getTime();
      for (const selection of await selectedProductsOf(submitted.body.id)) {
        expect(selection).toMatchObject({ status: 'SUBMITTED', pausedAt: null });
        expect(selection.replyDueAt!.getTime() - submittedAt).toBe(7 * 24 * 60 * 60 * 1000);
      }
      for (const product of submitted.body.selectedProducts) {
        expect(product).toMatchObject({ status: 'SUBMITTED', statusLabel: 'Waiting for the insurer', decline: null, informationRequests: [] });
      }
      const deliveries = await testApp.db
        .select()
        .from(integrationDeliveries)
        .where(eq(integrationDeliveries.referenceId, submitted.body.id));
      expect(deliveries).toHaveLength(2);
      expect(deliveries.map((delivery) => delivery.insurerId).sort((left, right) => left!.localeCompare(right!))).toEqual(
        [firstInsurer.insurer.id, secondInsurer.insurer.id].sort((left, right) => left.localeCompare(right)),
      );
      const firstDelivery = deliveries.find((delivery) => delivery.insurerId === firstInsurer.insurer.id)!;
      expect(firstDelivery).toMatchObject({ targetKind: 'INSURER_API', kind: 'QUOTE_REQUEST', status: 'PENDING' });
      expect((firstDelivery.requestPayload as { selectedProducts: { productVersionId: string }[] }).selectedProducts).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ productVersionId: first.version.id }),
          expect.objectContaining({ productVersionId: second.version.id }),
        ]),
      );
    });

    it('opens one optional inspection per insurer for the products that ask for one, without holding any product up', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const other = await buildInsurer(testApp.db);
      const physicalFirst = await productVersionForSelection(insurer, unique('INSPECT_A'), {
        inspectionRule: 'REQUIRED', inspectionTiming: 'BEFORE_QUOTATION', inspectionMethod: 'PHYSICAL',
      });
      const photosBeforePaying = await productVersionForSelection(insurer, unique('INSPECT_B'), {
        inspectionRule: 'REQUIRED', inspectionTiming: 'BEFORE_PAYMENT', inspectionMethod: 'SELF_CAPTURE',
      });
      const noInspection = await productVersionForSelection(other, unique('INSPECT_C'));

      const submitted = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('I').toUpperCase(), {
          selectedProductVersionIds: [physicalFirst.version.id, photosBeforePaying.version.id, noInspection.version.id],
        }))
        .expect(201);

      const opened = await testApp.db.select().from(inspections).where(eq(inspections.quoteRequestId, submitted.body.id));
      expect(opened).toEqual([
        expect.objectContaining({
          purpose: 'UNDERWRITING', status: 'REQUESTED', insurerId: insurer.insurer.id, method: 'PHYSICAL', stage: 'BEFORE_QUOTATION',
        }),
      ]);
      const served = await testApp.db
        .select({ productVersionId: inspectionRequestProducts.productVersionId })
        .from(inspectionRequestProducts)
        .where(eq(inspectionRequestProducts.inspectionId, opened[0].id));
      expect(served.map((link) => link.productVersionId).sort()).toEqual([physicalFirst.version.id, photosBeforePaying.version.id].sort());
      const statuses = Object.fromEntries(
        (await selectedProductsOf(submitted.body.id)).map((selection) => [selection.productVersionId, selection.status]),
      );
      expect(statuses).toEqual({
        [physicalFirst.version.id]: 'SUBMITTED',
        [photosBeforePaying.version.id]: 'SUBMITTED',
        [noInspection.version.id]: 'SUBMITTED',
      });
    });

    it('validates insurer-configured requirements, shares identical answers safely, and stores them against each selected version', async () => {
      const customer = await buildCustomer(testApp.db);
      const firstInsurer = await buildInsurer(testApp.db);
      const secondInsurer = await buildInsurer(testApp.db);
      const first = await productVersionForSelection(firstInsurer, unique('REQUIREMENT_A'));
      const second = await productVersionForSelection(secondInsurer, unique('REQUIREMENT_B'));
      const proof = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK' });

      for (const productVersionId of [first.version.id, second.version.id]) {
        await testApp.db.insert(productVersionRequirements).values([
          {
            productVersionId,
            key: 'driver_age',
            kind: 'QUESTION',
            label: 'Main driver age',
            required: true,
            config: { inputType: 'NUMBER' },
            displayOrder: 1,
          },
          {
            productVersionId,
            key: 'ownership_proof',
            kind: 'DOCUMENT',
            label: 'Proof of ownership',
            required: true,
            config: { documentKind: 'WHITE_BOOK' },
            displayOrder: 2,
          },
          {
            productVersionId,
            key: 'truth_declaration',
            kind: 'DECLARATION',
            label: 'I confirm the details are accurate',
            required: true,
            config: { text: 'I confirm the details are accurate.' },
            displayOrder: 3,
          },
        ]);
      }

      const missing = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('REQ').toUpperCase(), { selectedProductVersionIds: [first.version.id, second.version.id] }))
        .expect(400);
      expect(missing.body.code).toBe('PRODUCT_REQUIREMENTS_INCOMPLETE');
      expect(await requestsOf(customer.id)).toEqual([]);

      const submitted = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('REQ').toUpperCase(), {
          selectedProductVersionIds: [first.version.id, second.version.id],
          // One unscoped answer is accepted only because the two product
          // versions use precisely the same requirement definition.
          productRequirementAnswers: [{ requirementKey: 'driver_age', value: 32 }],
          productRequirementDocuments: [{ requirementKey: 'ownership_proof', documentId: proof.id }],
          productRequirementDeclarations: [{ requirementKey: 'truth_declaration', accepted: true }],
        }))
        .expect(201);

      const whereRequest = (table: typeof quoteRequestProductRequirementAnswers | typeof quoteRequestProductRequirementDeclarations | typeof quoteRequestProductRequirementDocuments) =>
        testApp.db.select().from(table).where(eq(table.quoteRequestId, submitted.body.id));
      expect(await whereRequest(quoteRequestProductRequirementAnswers)).toEqual(expect.arrayContaining([
        expect.objectContaining({ productVersionId: first.version.id, requirementKey: 'driver_age', value: 32 }),
        expect.objectContaining({ productVersionId: second.version.id, requirementKey: 'driver_age', value: 32 }),
      ]));
      expect(await whereRequest(quoteRequestProductRequirementDeclarations)).toEqual(expect.arrayContaining([
        expect.objectContaining({ productVersionId: first.version.id, requirementKey: 'truth_declaration' }),
        expect.objectContaining({ productVersionId: second.version.id, requirementKey: 'truth_declaration' }),
      ]));
      expect(await whereRequest(quoteRequestProductRequirementDocuments)).toEqual(expect.arrayContaining([
        expect.objectContaining({ productVersionId: first.version.id, requirementKey: 'ownership_proof', documentId: proof.id }),
        expect.objectContaining({ productVersionId: second.version.id, requirementKey: 'ownership_proof', documentId: proof.id }),
      ]));

      const unselected = await productVersionForSelection(await buildInsurer(testApp.db), unique('REQUIREMENT_C'));
      const rejected = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('REQ').toUpperCase(), {
          selectedProductVersionIds: [first.version.id],
          productRequirementAnswers: [{ productVersionId: unselected.version.id, requirementKey: 'driver_age', value: 32 }],
        }))
        .expect(400);
      expect(rejected.body.code).toBe('PRODUCT_REQUIREMENTS_INCOMPLETE');
    });

    it('refuses a sixth, unavailable, duplicate or duration-ineligible product selection without creating a request', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const versions = await Promise.all(
        Array.from({ length: 6 }, (_, index) => productVersionForSelection(insurer, unique(`CHOICE${index}`), { allowedDurations: ['Q4'] })),
      );
      const six = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('S').toUpperCase(), { selectedProductVersionIds: versions.map(({ version }) => version.id) }))
        .expect(400);
      expect(six.body.code).toBe('VALIDATION_FAILED');

      const duplicate = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('D').toUpperCase(), { selectedProductVersionIds: [versions[0].version.id, versions[0].version.id] }))
        .expect(400);
      expect(duplicate.body.code).toBe('VALIDATION_FAILED');

      const unavailable = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('M').toUpperCase(), { selectedProductVersionIds: [randomUUID()] }))
        .expect(409);
      expect(unavailable.body.code).toBe('PRODUCT_VERSION_UNAVAILABLE');

      const duration = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('T').toUpperCase(), { coverageDurationId: '1q', selectedProductVersionIds: [versions[0].version.id] }))
        .expect(409);
      expect(duration.body.code).toBe('PRODUCT_DURATION_UNAVAILABLE');
      expect(await requestsOf(customer.id)).toEqual([]);
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

    it('replays a submitted request once, refuses a changed replay, and scopes a key to its customer', async () => {
      const customer = await buildCustomer(testApp.db);
      const other = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);
      const key = 'quote-request-retry';
      const payload = submission(unique('BID').toUpperCase());

      const first = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      const replay = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .set('Idempotency-Key', key)
        .send({ ...payload, vehicleDetails: { ...payload.vehicleDetails } })
        .expect(201);

      expect(replay.body).toEqual(first.body);
      expect(await requestsOf(customer.id)).toHaveLength(1);

      const changed = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .set('Idempotency-Key', key)
        .send({ ...payload, vehicleValue: 1234.57 })
        .expect(409);
      expect(changed.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await requestsOf(customer.id)).toHaveLength(1);

      await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(other))
        .set('Idempotency-Key', key)
        .send(submission(unique('BIE').toUpperCase()))
        .expect(201);
      expect(await requestsOf(other.id)).toHaveLength(1);
    });

    it('attaches the customer’s White Book to the request and exposes it only to recipient insurers', async () => {
      const customer = await buildCustomer(testApp.db);
      const recipient = await buildInsurer(testApp.db);
      const selected = await productVersionForSelection(recipient, unique('WHITE_BOOK'));
      const whiteBook = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'WHITE_BOOK', mimeType: 'application/pdf' });

      const submitted = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('BCW').toUpperCase(), { whiteBookDocumentId: whiteBook.id, selectedProductVersionIds: [selected.version.id] }))
        .expect(201);

      expect(await storedRequest(submitted.body.id)).toMatchObject({ whiteBookDocumentId: whiteBook.id });
      const received = await testApp.http
        .get('/api/v1/insurer/quote-requests')
        .set(await signIn(testApp.http, recipient.staff))
        .expect(200);
      const request = received.body.find((candidate: { id: string }) => candidate.id === submitted.body.id);
      expect(request).toMatchObject({
        id: submitted.body.id,
        whiteBook: await documentResponse(whiteBook),
      });
      expect(request.insurerIds).toBeUndefined();
      expect(recipient.insurer.id).toBeDefined();
    });

    it('derives policy dates on the server and uses the RTSA anniversary when alignment is selected', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);

      const requested = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(
          submission(unique('BCT').toUpperCase(), {
            coverageDurationId: '1q',
            policyDates: { startDate: '2026-11-01T00:00:00.000Z', endDate: '2030-01-01T00:00:00.000Z' },
          }),
        )
        .expect(201);
      expect(requested.body.policyDates).toEqual({
        startDate: '2026-11-01T00:00:00.000Z',
        endDate: '2027-02-01T00:00:00.000Z',
        daysTotal: 92,
      });

      const policyYear = new Date().getUTCFullYear();
      const rtsaStart = new Date(Date.UTC(policyYear, 9, 31)).toISOString();
      const rtsaEnd = new Date(Date.UTC(policyYear + 1, 0, 31)).toISOString();
      const aligned = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(
          submission(unique('BCR').toUpperCase(), {
            coverageDurationId: '1q',
            matchRtsaAnniversary: true,
            rtsaRegistrationDate: '2023-10-31T00:00:00.000Z',
            policyDates: { startDate: '2029-01-01T00:00:00.000Z', endDate: '2029-02-01T00:00:00.000Z' },
          }),
        )
        .expect(201);
      expect(aligned.body.policyDates).toEqual({ startDate: rtsaStart, endDate: rtsaEnd, daysTotal: 92 });
      expect(await storedRequest(aligned.body.id)).toMatchObject({
        policyStartDate: new Date(rtsaStart),
        policyEndDate: new Date(rtsaEnd),
        coverageDays: 92,
      });
    });

    it('refuses RTSA date alignment when no RTSA anniversary is supplied', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);

      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('BCD').toUpperCase(), { matchRtsaAnniversary: true }))
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(await requestsOf(customer.id)).toEqual([]);
    });

    it('creates a new immutable vehicle for a matching plate without changing another customer’s request, policy or lookup', async () => {
      const owner = await buildCustomer(testApp.db);
      const purchaser = await buildPurchasedPolicy(testApp.db, { customer: owner });
      const [ownerVehicle] = await testApp.db.select().from(vehicles).where(eq(vehicles.id, purchaser.quoteRequest.vehicleId));
      const originalRequest = await testApp.http
        .get(`/api/v1/quote-requests/${purchaser.quoteRequest.id}`)
        .set(await asCustomer(owner))
        .expect(200);
      const originalPolicy = await testApp.http
        .get(`/api/v1/policies/${purchaser.policy.policyNumber}`)
        .set(await asCustomer(owner))
        .expect(200);
      const originalLookup = await testApp.http
        .get('/api/v1/vehicles/lookup')
        .query({ plate: ownerVehicle.plateNumber })
        .set(await asCustomer(owner))
        .expect(200);
      const other = await buildCustomer(testApp.db);

      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(other))
        .send(
          submission(ownerVehicle.plateNumber, {
            vehicleDetails: {
              plateNumber: ownerVehicle.plateNumber,
              make: 'Ford',
              model: 'Ranger',
              year: '2025',
              color: 'Blue',
              chassisNumber: 'OTHER-CUSTOMER-CHASSIS',
              engineNumber: 'OTHER-CUSTOMER-ENGINE',
            },
          }),
        )
        .expect(201);

      const stored = await storedRequest(response.body.id);
      expect(stored.vehicleId).not.toBe(ownerVehicle.id);
      const [storedOwnerVehicle] = await testApp.db.select().from(vehicles).where(eq(vehicles.id, ownerVehicle.id));
      expect(storedOwnerVehicle).toEqual(ownerVehicle);
      expect(response.body.vehicleDetails).toMatchObject({
        make: 'Ford',
        model: 'Ranger',
        chassisNumber: 'OTHER-CUSTOMER-CHASSIS',
        engineNumber: 'OTHER-CUSTOMER-ENGINE',
      });

      const ownerRequest = await testApp.http
        .get(`/api/v1/quote-requests/${purchaser.quoteRequest.id}`)
        .set(await asCustomer(owner))
        .expect(200);
      const ownerPolicy = await testApp.http
        .get(`/api/v1/policies/${purchaser.policy.policyNumber}`)
        .set(await asCustomer(owner))
        .expect(200);
      const ownerLookup = await testApp.http
        .get('/api/v1/vehicles/lookup')
        .query({ plate: ownerVehicle.plateNumber })
        .set(await asCustomer(owner))
        .expect(200);
      const otherLookup = await testApp.http
        .get('/api/v1/vehicles/lookup')
        .query({ plate: ownerVehicle.plateNumber })
        .set(await asCustomer(other))
        .expect(200);

      expect(ownerRequest.body.vehicleDetails).toEqual(originalRequest.body.vehicleDetails);
      expect(ownerPolicy.body.vehicleDetails).toEqual(originalPolicy.body.vehicleDetails);
      expect(ownerLookup.body).toEqual(originalLookup.body);
      expect(otherLookup.body).toMatchObject({ make: 'Ford', model: 'Ranger', source: 'PLATFORM' });
    });

    it('does not update an existing vehicle when submitting or redirecting to fresh product selection', async () => {
      const customer = await buildCustomer(testApp.db);
      const purchase = await buildPurchasedPolicy(testApp.db, { customer });
      const before = await vehicleRows();

      const submitted = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('BAD').toUpperCase()))
        .expect(201);
      const afterSubmit = await vehicleRows();
      expect(afterSubmit).toHaveLength(before.length + 1);
      expect(afterSubmit.filter((vehicle) => before.some((original) => original.id === vehicle.id))).toEqual(before);

      const requote = await testApp.http
        .post(`/api/v1/quote-requests/${submitted.body.id}/requote`)
        .set(await asCustomer(customer))
        .expect(409);
      expect(requote.body.code).toBe('REQUOTE_REQUIRES_PRODUCT_SELECTION');
      expect(await vehicleRows()).toEqual(afterSubmit);

      const renewal = await testApp.http
        .post(`/api/v1/policies/${purchase.policy.policyNumber}/renew`)
        .set(await asCustomer(customer))
        .expect(409);
      expect(renewal.body.code).toBe('RENEWAL_REQUIRES_PRODUCT_SELECTION');
      expect(await vehicleRows()).toEqual(afterSubmit);
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

      it('refuses another customer’s valid code exactly as it refuses an unknown one', async () => {
        const customer = await buildCustomer(testApp.db);
        const other = await buildCustomer(testApp.db);
        const { insurer } = await buildInsurer(testApp.db);
        const theirs = await buildApprovedNcdCode(testApp.db, { customerId: other.id, insurerId: insurer.id });
        const unowned = await buildNcdCode(testApp.db, { insurerId: insurer.id });

        for (const code of [theirs.code, unowned.code, 'NCD-NOBODY-HAS-THIS']) {
          const response = await testApp.http
            .post('/api/v1/quote-requests')
            .set(await asCustomer(customer))
            .send(submission(unique('BAH').toUpperCase(), { ncdCode: code }))
            .expect(409);
          expect(response.body.code).toBe('INVALID_NCD_CODE');
        }
        expect(await requestsOf(customer.id)).toEqual([]);
      });

      it('refuses the customer’s own code once it is redeemed or expired', async () => {
        const customer = await buildCustomer(testApp.db);
        const { insurer } = await buildInsurer(testApp.db);
        const redeemed = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.id }, { redeemedAt: new Date() });
        const expired = await buildApprovedNcdCode(testApp.db, { customerId: customer.id, insurerId: insurer.id }, { expiresAt: inDays(-1) });

        for (const code of [redeemed.code, expired.code]) {
          const response = await testApp.http
            .post('/api/v1/quote-requests')
            .set(await asCustomer(customer))
            .send(submission(unique('BAH').toUpperCase(), { ncdCode: code }))
            .expect(409);
          expect(response.body.code).toBe('INVALID_NCD_CODE');
        }
        expect(await requestsOf(customer.id)).toEqual([]);
      });
    });

    it('refuses a selected product withdrawn after the customer saw it and before they submit', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const selected = await productVersionForSelection(insurer, unique('WITHDRAWING'));
      // This is the directory-to-submit window: the customer selected an
      // approved version, then the insurer withdrew it before submission.
      // The submit transaction must re-evaluate the durable product state
      // rather than trusting the browser's earlier directory response.
      await testApp.db
        .update(insurerProductVersions)
        .set({ status: 'WITHDRAWN', withdrawnAt: new Date(), withdrawalReason: 'Withdrawn during customer selection test.' })
        .where(eq(insurerProductVersions.id, selected.version.id));

      const response = await testApp.http
        .post('/api/v1/quote-requests')
        .set(await asCustomer(customer))
        .send(submission(unique('BAK').toUpperCase(), { selectedProductVersionIds: [selected.version.id] }));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PRODUCT_VERSION_UNAVAILABLE');
      expect(await requestsOf(customer.id)).toEqual([]);
    });

    it('refuses a selected product when its insurer is no longer accepting requests, and stores nothing', async () => {
      const customer = await buildCustomer(testApp.db);
      const plate = unique('BAJ').toUpperCase();
      await withNoActiveInsurers(async () => {
        const response = await testApp.http
          .post('/api/v1/quote-requests')
          .set(await asCustomer(customer))
          .send(submission(plate))
          .expect(409);
        expect(response.body.code).toBe('PRODUCT_VERSION_UNAVAILABLE');
      });
      expect(await requestsOf(customer.id)).toEqual([]);
      expect(await testApp.db.select().from(vehicles).where(eq(vehicles.plateNumber, plate))).toEqual([]);
    });
  });

  describe('POST /quote-requests/:id/requote', () => {
    it('requires the customer to choose current product versions before sending fresh requests', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(
        testApp.db,
        { customerId: customer.id, insurerIds: [insurer.id] },
        {
          status: 'EXPIRED',
          vehicleValueMinor: 250_000_00,
          vehicleUsage: 'Commercial',
          insuranceType: 'THIRD_PARTY',
          coverageDuration: 'Q3',
          policyStartDate: new Date('2026-11-01T00:00:00.000Z'),
          policyEndDate: new Date('2027-08-01T00:00:00.000Z'),
          coverageDays: 273,
          photosCapturedAt: new Date('2026-10-30T09:00:00.000Z'),
        },
      );
      await buildInspectionShot(testApp.db, {
        quoteRequestId: quoteRequest.id,
        uploader: { customerId: customer.id },
      });
      const response = await testApp.http
        .post(`/api/v1/quote-requests/${quoteRequest.id}/requote`)
        .set(await asCustomer(customer))
        .expect(409);
      expect(response.body.code).toBe('REQUOTE_REQUIRES_PRODUCT_SELECTION');
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.requotedFromId, quoteRequest.id))).toEqual([]);
    });

    it('does not create a duplicate request when two fresh-selection redirects arrive together', async () => {
      const customer = await buildCustomer(testApp.db);
      await buildInsurer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] }, { status: 'EXPIRED' });
      const held = await holdLocks(side.pool, (db) =>
        db.select({ id: quoteRequests.id }).from(quoteRequests).where(eq(quoteRequests.id, quoteRequest.id)).for('update'),
      );
      const requote = async () =>
        testApp.http.post(`/api/v1/quote-requests/${quoteRequest.id}/requote`).set(await asCustomer(customer));

      const responses = await queueBehind(held, LOCKING_THE_REQUEST, 2, [requote, requote]);

      expect(statuses(responses)).toEqual([409, 409]);
      expect(responses.map((response) => response.body.code)).toEqual([
        'REQUOTE_REQUIRES_PRODUCT_SELECTION',
        'REQUOTE_REQUIRES_PRODUCT_SELECTION',
      ]);
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.requotedFromId, quoteRequest.id))).toEqual([]);
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
        .set({ amountMinor: 173_456, rtsaAnniversaryFeeMinor: 50_000, confirmedAt: new Date('2026-01-01T09:59:59.999Z') })
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
        rtsaAnniversaryFee: 500,
        vehicle: '2020 Toyota Hilux',
        vehicleValue: 10_000,
        vehicleUsage: 'PRIVATE',
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
        renewal: { window: 'NOT_DUE', daysRemaining: 65, endDate: endDate.toISOString(), renewable: false, renewalRequestId: null },
        policyDates: { startDate: '2026-01-01T00:00:00.000Z', endDate: endDate.toISOString() },
        quoteRequestId: purchase.quoteRequest.id,
        insurerQuoteReference: purchase.quote.insurerReference,
        quoteDocument: await documentResponse(purchase.quotation),
        certificateDocument: null,
        paymentProof: {
          transactionId: purchase.payment.transactionId,
          status: 'Confirmed',
          method: 'Mobile money',
          amount: 1734.56,
          rtsaAnniversaryFee: 500,
          currency: 'ZMW',
          confirmedAt: '2026-01-01T09:59:59.999Z',
        },
        receivedAt: '2026-01-01T10:00:00.123Z',
        issuedAt: null,
        issuance: { dueAt: null, acceptedAt: null, overdue: false, failedAt: null, failureReason: null },
        product: null,
        renewalProduct: null,
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
        await testApp.db.update(policies).set({ status: 'ACTIVE', policyEndDate: inDays(days) }).where(eq(policies.policyNumber, policy.policyNumber));
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
      await testApp.db.update(policies).set({ status: 'ACTIVE', policyEndDate: inDays(15) }).where(eq(policies.policyNumber, policy.policyNumber));
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
    it('requires the customer to choose a current product before renewing', async () => {
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });

      const response = await testApp.http
        .post(`/api/v1/policies/${policy.policyNumber}/renew`)
        .set(await asCustomer(customer))
        .expect(409);
      expect(response.body.code).toBe('RENEWAL_REQUIRES_PRODUCT_SELECTION');
      expect(response.body.message).toContain('Review current insurance products');
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.renewalOfPolicyNumber, policy.policyNumber))).toEqual([]);
    });

    it('does not infer a renewal product when the original request is gone', async () => {
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
        .expect(409);
      expect(response.body.code).toBe('RENEWAL_REQUIRES_PRODUCT_SELECTION');
    });

    it('requires a current selection after a previous renewal request has lapsed', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db);
      const { policy, quoteRequest } = await buildPurchasedPolicy(testApp.db, { customer, insurer });
      await buildRenewalRequest(
        testApp.db,
        { customerId: customer.id, vehicleId: quoteRequest.vehicleId, policyNumber: policy.policyNumber, insurerIds: [] },
        { status: 'EXPIRED', expiresAt: inDays(-1) },
      );

      const response = await testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(customer)).expect(409);
      expect(response.body.code).toBe('RENEWAL_REQUIRES_PRODUCT_SELECTION');
    });

    it('does not create a renewal when two fresh-selection redirects arrive together', async () => {
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      const held = await holdLocks(side.pool, (db) =>
        db.select({ policyNumber: policies.policyNumber }).from(policies).where(eq(policies.policyNumber, policy.policyNumber)).for('update'),
      );
      const renew = async () => testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(customer));

      const responses = await queueBehind(held, LOCKING_THE_POLICY, 2, [renew, renew]);

      expect(statuses(responses)).toEqual([409, 409]);
      expect(responses.map((response) => response.body.code)).toEqual([
        'RENEWAL_REQUIRES_PRODUCT_SELECTION',
        'RENEWAL_REQUIRES_PRODUCT_SELECTION',
      ]);
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.renewalOfPolicyNumber, policy.policyNumber))).toEqual([]);
    });

    describe('on a database whose transactions default to repeatable read', () => {
      let strict: TestApp;

      beforeAll(async () => {
        strict = await startRepeatableReadApp(4);
      });

      afterAll(async () => {
        await strict.close();
      });

      it('does not create a renewal under repeatable read while redirecting to product selection', async () => {
        const customer = await buildCustomer(testApp.db);
        const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
        const held = await holdLocks(side.pool, (db) =>
          db.select({ policyNumber: policies.policyNumber }).from(policies).where(eq(policies.policyNumber, policy.policyNumber)).for('update'),
        );
        const renew = async () => strict.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(customer));

        const responses = await queueBehind(held, LOCKING_THE_POLICY, 2, [renew, renew]);

        expect(statuses(responses)).toEqual([409, 409]);
        expect(responses.map((response) => response.body.code)).toEqual([
          'RENEWAL_REQUIRES_PRODUCT_SELECTION',
          'RENEWAL_REQUIRES_PRODUCT_SELECTION',
        ]);
        expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.renewalOfPolicyNumber, policy.policyNumber))).toEqual([]);
      });
    });

    it('answers 404 for another customer’s policy and never broadens renewal to all insurers', async () => {
      const other = await buildCustomer(testApp.db);
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });

      await testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(other)).expect(404);
      const response = await testApp.http
        .post(`/api/v1/policies/${policy.policyNumber}/renew`)
        .set(await asCustomer(customer))
        .expect(409);
      expect(response.body.code).toBe('RENEWAL_REQUIRES_PRODUCT_SELECTION');
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
    async function issuedClaimPolicy(customer: Customer, insurer?: Awaited<ReturnType<typeof buildInsurer>>) {
      const purchase = await buildPurchasedPolicy(testApp.db, { customer, insurer });
      await testApp.db.update(policies).set({ status: 'ACTIVE', issuedAt: inDays(-45), policyStartDate: inDays(-45), policyEndDate: inDays(45) })
        .where(eq(policies.policyNumber, purchase.policy.policyNumber));
      return purchase;
    }

    it('issues a claim number, attaches the documents and stores the loss in ngwee', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer: carrier, policy, quoteRequest } = await issuedClaimPolicy(customer);
      const insurer = carrier.insurer;
      const incidentDate = lusakaDay(inDays(-20));
      await testApp.db.update(vehicles).set({ plateNumber: 'BAZ 8102', make: 'Toyota', model: 'Hilux', year: '2021' })
        .where(eq(vehicles.id, quoteRequest.vehicleId));
      const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });

      const response = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .send(
          claim(insurer.id, {
            policyNumber: policy.policyNumber,
            type: 'Theft',
            incidentDate,
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
        plate: 'BAZ 8102',
        vehicle: '2021 Toyota Hilux',
        type: 'Theft',
        incidentDate: `${incidentDate}T00:00:00.000Z`,
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
      expect(stored).toMatchObject({ claimNumber: response.body.claimNumber, estimatedLossMinor: 1, status: 'NOTIFIED', lateReason: 'I was in hospital.', lateSubmission: true, responseDueOn: lusakaDay(inDays(7)) });
      expect(await testApp.db.select().from(claimAttachments).where(eq(claimAttachments.claimNumber, stored.claimNumber))).toMatchObject([
        { documentId: photo.id },
      ]);
    });

    it('replays the same claim notification without issuing a second claim number', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer, policy } = await issuedClaimPolicy(customer);
      const key = 'claim-notification-retry';
      const payload = claim(insurer.insurer.id, { policyNumber: policy.policyNumber });

      const first = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .set('Idempotency-Key', key)
        .send(payload)
        .expect(201);
      const replay = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .set('Idempotency-Key', key)
        .send({ ...payload })
        .expect(201);

      expect(replay.body).toEqual(first.body);
      expect(await claimsOf(customer.id)).toHaveLength(1);
    });

    it('refuses an unowned policy without revealing whether it exists', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer } = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db);

      const response = await testApp.http
        .post('/api/v1/claims')
        .set(await asCustomer(customer))
        .send(claim(insurer.id, { policyNumber: policy.policyNumber }))
        .expect(404);

      expect(response.body.code).toBe('NOT_FOUND');
      expect(await claimsOf(customer.id)).toEqual([]);
    });

    it('stores neither the claim nor its attachments when the claim fails after it was written', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer, policy } = await issuedClaimPolicy(customer);
      const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });
      const notify = async () =>
        testApp.http.post('/api/v1/claims').set(await asCustomer(customer)).send(claim(insurer.insurer.id, { policyNumber: policy.policyNumber, supportingDocumentIds: [photo.id] }));

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

    it('returns a searchable policy reference and help desk for a deleted insurer', async () => {
      const customer = await buildCustomer(testApp.db);
      const insurer = await buildInsurer(testApp.db, { insurer: { status: 'DELETED', deletedAt: new Date() } });
      const { policy } = await issuedClaimPolicy(customer, insurer);

      const refused = await testApp.http.post('/api/v1/claims').set(await asCustomer(customer))
        .send(claim(insurer.insurer.id, { policyNumber: policy.policyNumber })).expect(409);
      expect(refused.body).toMatchObject({
        code: 'CLAIM_INSURER_UNAVAILABLE', details: { reference: policy.policyNumber, contact: expect.any(Object) },
      });
      expect(await claimsOf(customer.id)).toEqual([]);
    });

    it('reads intake defaults and enforces cover dates, late reasons and evidence on the server', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer, policy } = await issuedClaimPolicy(customer);
      const session = await asCustomer(customer);
      const rules = await testApp.http.get('/api/v1/claims/intake-rules').set(session).expect(200);
      expect(rules.body).toMatchObject({ reportingDays: 14, responseDays: 7, provisional: true });
      const refusal = async (overrides: Record<string, unknown>, code: string) => {
        const response = await testApp.http.post('/api/v1/claims').set(session)
          .send(claim(insurer.insurer.id, { policyNumber: policy.policyNumber, ...overrides })).expect(400);
        expect(response.body.code).toBe(code);
      };
      await refusal({ policyNumber: undefined }, 'CLAIM_POLICY_REQUIRED');
      await refusal({ insurerId: randomUUID() }, 'CLAIM_INSURER_MISMATCH');
      await refusal({ incidentDate: lusakaDay(inDays(1)) }, 'CLAIM_FUTURE_INCIDENT');
      await refusal({ incidentDate: lusakaDay(inDays(-46)) }, 'CLAIM_OUTSIDE_COVER');
      await refusal({ incidentDate: lusakaDay(inDays(-15)) }, 'CLAIM_LATE_REASON_REQUIRED');
      await refusal({ type: 'Theft' }, 'CLAIM_POLICE_REPORT_REQUIRED');
      await refusal({ type: 'Theft', policeReport: true, policeReportNumber: 'POLICE-4' }, 'CLAIM_EVIDENCE_REQUIRED');
      await testApp.db.update(policies).set({ coverage: 'Third Party' }).where(eq(policies.policyNumber, policy.policyNumber));
      await refusal({ type: 'Theft' }, 'CLAIM_TYPE_NOT_COVERED');
      expect(await claimsOf(customer.id)).toEqual([]);
    });

    it('checks the effective cancellation day after waiting for concurrent completion', async () => {
      const customer = await buildCustomer(testApp.db);
      const { insurer, policy } = await issuedClaimPolicy(customer);
      const session = await asCustomer(customer);
      const reference = unique('SR');
      const effectiveDate = lusakaDay(inDays(-5));
      await testApp.db.insert(serviceRequests).values({
        reference, policyNumber: policy.policyNumber, customerId: customer.id, insurerId: insurer.insurer.id,
        type: 'CANCELLATION', status: 'APPROVED', reason: 'Vehicle sold', requestedEffectiveDate: effectiveDate,
        decision: 'APPROVED', decidedByStaffId: insurer.staff.id, decidedAt: inDays(-6), effectiveDate, refundAmountMinor: 0,
      });
      const completedAt = inDays(-1);
      const completing = await holdLocks(side.pool, async (db) => {
        await db.update(policies).set({ status: 'CANCELLED', cancelledAt: completedAt })
          .where(eq(policies.policyNumber, policy.policyNumber));
        await db.update(serviceRequests).set({ status: 'COMPLETED', completedAt, completedByStaffId: insurer.staff.id })
          .where(eq(serviceRequests.reference, reference));
      });
      const [uncovered] = await queueBehind(completing, '%"policies"%', 1, [async () =>
        testApp.http.post('/api/v1/claims').set(session).send(claim(insurer.insurer.id, {
          policyNumber: policy.policyNumber, incidentDate: lusakaDay(inDays(-3)),
        })),
      ]);
      expect(uncovered.status).toBe(400);
      expect(uncovered.body.code).toBe('CLAIM_OUTSIDE_COVER');
      expect(await claimsOf(customer.id)).toEqual([]);
      await testApp.http.post('/api/v1/claims').set(session).send(claim(insurer.insurer.id, {
        policyNumber: policy.policyNumber, incidentDate: lusakaDay(inDays(-6)),
      })).expect(201);
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
        const insurer = await buildInsurer(testApp.db);
        const claimants = [await buildCustomer(testApp.db), await buildCustomer(testApp.db)];
        const cover = await Promise.all(claimants.map((customer) => issuedClaimPolicy(customer, insurer)));
        const photos = [
          await buildDocument(testApp.db, { customerId: claimants[0].id }, { kind: 'CLAIM_ATTACHMENT' }),
          await buildDocument(testApp.db, { customerId: claimants[1].id }, { kind: 'CLAIM_ATTACHMENT' }),
        ];
        const held = await holdLocks(side.pool, (db) =>
          db.select({ id: documentsTable.id }).from(documentsTable).where(inArray(documentsTable.id, photos.map((photo) => photo.id))).for('update'),
        );
        const notify = (index: number) => async () =>
          small.http
            .post('/api/v1/claims')
            .set(await asCustomer(claimants[index]))
            .send(claim(insurer.insurer.id, { policyNumber: cover[index].policy.policyNumber, supportingDocumentIds: [photos[index].id] }));

        const responses = await queueBehind(held, LOCKING_THE_DOCUMENTS, 2, [notify(0), notify(1)]);

        expect(statuses(responses)).toEqual([201, 201]);
        expect(responses.map((response) => response.body.supportingDocs[0].id)).toEqual(photos.map((photo) => photo.id));
      });
    });

    describe('attaching documents', () => {
      it('refuses a document uploaded by someone else, of the wrong kind, already attached or never uploaded, and stores nothing', async () => {
        const customer = await buildCustomer(testApp.db);
        const other = await buildCustomer(testApp.db);
        const { insurer: { insurer }, policy } = await issuedClaimPolicy(customer);
        const theirs = await buildDocument(testApp.db, { customerId: other.id }, { kind: 'CLAIM_ATTACHMENT' });
        const wrongKind = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'INSPECTION_PHOTO' });
        const earlier = await buildClaim(testApp.db, { insurerId: insurer.id, customerId: customer.id });
        const { document: attached } = await buildClaimAttachment(testApp.db, { claimNumber: earlier.claimNumber, uploader: { customerId: customer.id } });

        for (const documentId of [theirs.id, wrongKind.id, attached.id, randomUUID()]) {
          const response = await testApp.http
            .post('/api/v1/claims')
            .set(await asCustomer(customer))
            .send(claim(insurer.id, { policyNumber: policy.policyNumber, supportingDocumentIds: [documentId] }))
            .expect(409);
          expect(response.body.code).toBe('DOCUMENT_NOT_ATTACHABLE');
        }
        expect((await claimsOf(customer.id)).map((row) => row.claimNumber)).toEqual([earlier.claimNumber]);
      });

      it('refuses one document named twice with 400', async () => {
        const customer = await buildCustomer(testApp.db);
        const { insurer: { insurer }, policy } = await issuedClaimPolicy(customer);
        const photo = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'CLAIM_ATTACHMENT' });

        const response = await testApp.http
          .post('/api/v1/claims')
          .set(await asCustomer(customer))
          .send(claim(insurer.id, { policyNumber: policy.policyNumber, supportingDocumentIds: [photo.id, photo.id] }))
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
    it('reveals only whether a code is usable, without signing in', async () => {
      const { insurer } = await buildInsurer(testApp.db);
      const expiresAt = inDays(90);
      const usable = await buildNcdCode(testApp.db, { insurerId: insurer.id }, { percentage: 15, yearsClaimFree: 3, expiresAt });
      const used = await buildNcdCode(testApp.db, { insurerId: insurer.id }, { redeemedAt: new Date() });
      const expired = await buildNcdCode(testApp.db, { insurerId: insurer.id }, { expiresAt: inDays(-1) });

      const valid = await testApp.http.post('/api/v1/ncd/codes/validate').send({ code: ` ${usable.code.toLowerCase()} ` }).expect(200);
      expect(valid.body).toEqual({ valid: true });
      for (const code of [
        used.code,
        expired.code,
        'NCD-NOBODY-HAS-THIS',
      ]) {
        const response = await testApp.http.post('/api/v1/ncd/codes/validate').send({ code }).expect(200);
        expect(response.body).toEqual({ valid: false });
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

    it('keeps the account protected while the customer is sent to product selection for renewal', async () => {
      const customer = await buildCustomer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { customer });
      const renewed = await testApp.http.post(`/api/v1/policies/${policy.policyNumber}/renew`).set(await asCustomer(customer)).expect(409);
      const closed = await closeAccount(customer);

      expect(renewed.body.code).toBe('RENEWAL_REQUIRES_PRODUCT_SELECTION');
      expect(closed.status).toBe(409);
      expect(closed.body.code).toBe('ACTIVE_POLICY_EXISTS');
      expect(await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.renewalOfPolicyNumber, policy.policyNumber))).toEqual([]);
      expect(await isOpen(customer)).toBe(true);
    });

    it('waits for a payment creating the customer’s first policy, then refuses', async () => {
      const customer = await buildCustomer(testApp.db);
      const held = await holdLocks(side.pool, (db) => buildPurchasedPolicy(db, { customer }));

      const [response] = await queueBehind(held, LOCKING_THE_CUSTOMER, 1, [() => closeAccount(customer)]);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ACTIVE_POLICY_EXISTS');
      expect(await isOpen(customer)).toBe(true);
    });

    describe('on a database whose transactions default to repeatable read', () => {
      let strict: TestApp;

      beforeAll(async () => {
        strict = await startRepeatableReadApp(4);
      });

      afterAll(async () => {
        await strict.close();
      });

      it('still waits for a payment creating the customer’s first policy, then refuses', async () => {
        const customer = await buildCustomer(testApp.db);
        const held = await holdLocks(side.pool, (db) => buildPurchasedPolicy(db, { customer }));
        const close = async () => strict.http.delete('/api/v1/account').set(await asCustomer(customer));

        const [response] = await queueBehind(held, LOCKING_THE_CUSTOMER, 1, [close]);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('ACTIVE_POLICY_EXISTS');
        expect(await isOpen(customer)).toBe(true);
      });
    });

    it.each(['INITIATED', 'PENDING'] as const)('refuses an %s payment without a policy', async (status) => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      await buildPayment(testApp.db, { customerId: customer.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id }, { status });
      const response = await closeAccount(customer);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PAYMENT_IN_PROGRESS');
      expect(await isOpen(customer)).toBe(true);
    });

    it('waits for an originating payment, then refuses closure without withdrawing its quote', async () => {
      const { customer, quoteRequest, quote } = await buildPayableQuote(testApp.db);
      const held = await holdLocks(side.pool, (db) => buildPayment(db, {
        customerId: customer.id, quoteRequestId: quoteRequest.id, insurerQuoteId: quote.id,
      }, { status: 'INITIATED' }));
      const [response] = await queueBehind(held, LOCKING_THE_CUSTOMER, 1, [() => closeAccount(customer)]);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('PAYMENT_IN_PROGRESS');
      const [retained] = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.id, quote.id));
      expect(retained.status).toBe('ACTIVE');
      expect(await isOpen(customer)).toBe(true);
    });

    it('refuses a stale service-request submission queued behind the closure customer lock', async () => {
      const { customer, policy } = await buildPurchasedPolicy(testApp.db);
      await testApp.db.update(policies).set({ status: 'ACTIVE', policyEndDate: inDays(-2) })
        .where(eq(policies.policyNumber, policy.policyNumber));
      const session = await asCustomer(customer);
      const held = await holdLocks(side.pool, async (db) => {
        await db.select().from(customers).where(eq(customers.id, customer.id)).for('update');
        await db.update(customers).set({ deletedAt: new Date() }).where(eq(customers.id, customer.id));
      });
      const [response] = await queueBehind(held, 'select % from "customers" % for key share', 1, [
        async () => testApp.http.post('/api/v1/service-requests').set(session).set('Idempotency-Key', unique('closure-race'))
          .send({ policyNumber: policy.policyNumber, type: 'ASSISTANCE', reason: 'Please help with my policy documents.' }),
      ]);
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('FORBIDDEN');
      expect(await testApp.db.select().from(serviceRequests).where(eq(serviceRequests.customerId, customer.id))).toEqual([]);
    });

    it('refuses an open service request after cover has ended', async () => {
      const { customer, policy } = await buildPurchasedPolicy(testApp.db);
      await testApp.http.post('/api/v1/service-requests').set(await asCustomer(customer)).send({
        policyNumber: policy.policyNumber, type: 'ASSISTANCE', reason: 'Please help me with the policy documents.',
      }).expect(201);
      await testApp.db.update(policies).set({ status: 'CANCELLED' }).where(eq(policies.policyNumber, policy.policyNumber));
      const response = await closeAccount(customer);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('OPEN_SERVICE_REQUEST_EXISTS');
      expect(await isOpen(customer)).toBe(true);
    });

    it.each(['PROPOSED', 'APPROVED', 'SUBMITTED'] as const)('refuses a %s refund after cover has ended', async (status) => {
      const { customer, policy, payment } = await buildPurchasedPolicy(testApp.db);
      const staff = await buildStaffUser(testApp.db, { role: 'ADMIN' });
      await testApp.db.update(policies).set({ status: 'CANCELLED' }).where(eq(policies.policyNumber, policy.policyNumber));
      await testApp.db.insert(paymentRefunds).values({
        paymentId: payment.id, amountMinor: payment.amountMinor, reasonCode: 'CUSTOMER_REQUEST',
        reason: 'Refund after cancellation.', status, provider: payment.provider, proposedByStaffId: staff.id,
      });
      const response = await closeAccount(customer);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('REFUND_IN_PROGRESS');
      expect(await isOpen(customer)).toBe(true);
    });

    it('keeps the account open while an insurer needs claim evidence, and permits closure after it is supplied', async () => {
      const purchase = await buildPurchasedPolicy(testApp.db);
      await testApp.db.update(policies).set({ status: 'ACTIVE', policyEndDate: inDays(-30) })
        .where(eq(policies.policyNumber, purchase.policy.policyNumber));
      const record = await buildClaim(testApp.db, {
        customerId: purchase.customer.id, insurerId: purchase.insurer.insurer.id, policyNumber: purchase.policy.policyNumber,
      }, { status: 'EVIDENCE_REQUIRED' });
      const blocked = await closeAccount(purchase.customer);
      expect(blocked.body.code).toBe('CLAIM_EVIDENCE_OUTSTANDING');
      expect(await isOpen(purchase.customer)).toBe(true);
      await testApp.db.update(claimNotifications).set({ status: 'UNDER_REVIEW' }).where(eq(claimNotifications.claimNumber, record.claimNumber));
      expect((await closeAccount(purchase.customer)).status).toBe(200);
    });

    it('refuses an owed refund even before finance has proposed it', async () => {
      const { customer, policy, payment } = await buildPurchasedPolicy(testApp.db);
      await testApp.db.update(policies).set({ status: 'CANCELLED' }).where(eq(policies.policyNumber, policy.policyNumber));
      await testApp.db.insert(reconciliationItems).values({
        kind: 'REFUND_REQUIRED', paymentId: payment.id, policyNumber: policy.policyNumber,
        amountMinor: payment.amountMinor, reason: 'Cancellation refund owed.',
      });
      const response = await closeAccount(customer);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('REFUND_IN_PROGRESS');
      expect(await isOpen(customer)).toBe(true);
    });

    it('rolls closure back retryably when an insurer is changing an unpaid quote', async () => {
      const { customer, quote } = await buildPayableQuote(testApp.db);
      const held = await holdLocks(side.pool, async (db) => {
        await db.select().from(insurerQuotes).where(eq(insurerQuotes.id, quote.id)).for('update');
      });
      try {
        const response = await closeAccount(customer);
        expect(response.status).toBe(503);
        expect(response.body.code).toBe('TRY_AGAIN');
        expect(await isOpen(customer)).toBe(true);
      } finally {
        await held.release();
      }
      expect((await closeAccount(customer)).status).toBe(200);
    });

    it('still blocks a paid policy awaiting its official certificate when its stored end day is past', async () => {
      const { customer, policy } = await buildPurchasedPolicy(testApp.db);
      await testApp.db.update(policies).set({ policyEndDate: inDays(-2) }).where(eq(policies.policyNumber, policy.policyNumber));
      const response = await closeAccount(customer);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ACTIVE_POLICY_EXISTS');
      expect(await isOpen(customer)).toBe(true);
    });

    it('keeps cover through today in Lusaka, but permits closure after its end day without changing paid quotes', async () => {
      const { customer, policy, quote } = await buildPurchasedPolicy(testApp.db);
      await testApp.db.update(policies).set({ status: 'ACTIVE', policyEndDate: new Date(`${lusakaDay(new Date())}T00:00:00Z`) })
        .where(eq(policies.policyNumber, policy.policyNumber));
      expect((await closeAccount(customer)).body.code).toBe('ACTIVE_POLICY_EXISTS');
      await testApp.db.update(policies).set({ policyEndDate: inDays(-2) }).where(eq(policies.policyNumber, policy.policyNumber));
      expect((await closeAccount(customer)).status).toBe(200);
      const [retained] = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.id, quote.id));
      expect(retained.status).toBe('ACTIVE');
    });

    it('withdraws unpaid offers and expires their requests without affecting another customer', async () => {
      const owned = await buildPayableQuote(testApp.db);
      const other = await buildPayableQuote(testApp.db);
      expect((await closeAccount(owned.customer)).status).toBe(200);
      const [withdrawn] = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.id, owned.quote.id));
      const [untouched] = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.id, other.quote.id));
      expect(withdrawn).toMatchObject({
        status: 'WITHDRAWN', withdrawnAt: expect.any(Date), withdrawnReason: 'Customer closed their account.',
      });
      expect((await storedRequest(owned.quoteRequest.id)).status).toBe('EXPIRED');
      expect(untouched.status).toBe('ACTIVE');
      expect(await isOpen(other.customer)).toBe(true);
    });

    it('expires saved drafts while retaining their answers for the retention workflow', async () => {
      const customer = await buildCustomer(testApp.db);
      const session = await asCustomer(customer);
      const saved = await testApp.http.post('/api/v1/quote-request-drafts').set(session)
        .send({ commonAnswers: { vehicleUsage: 'Private' } }).expect(201);
      const response = await testApp.http.delete('/api/v1/account').set(session).expect(200);
      const [draft] = await testApp.db.select().from(quoteRequestDrafts).where(eq(quoteRequestDrafts.id, saved.body.id));
      expect(draft.expiresAt.toISOString()).toBe(response.body.closedAt);
      expect(draft.commonAnswers).toEqual({ vehicleUsage: 'Private' });
      await testApp.http.get('/api/v1/quote-request-drafts').set(session).expect(401);
    });

    it('closes an account without policies and refuses its session afterwards', async () => {
      const customer = await buildCustomer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [] });
      const session = await asCustomer(customer);

      const response = await testApp.http.delete('/api/v1/account').set(session);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ closed: true, closedAt: expect.stringMatching(ISO_MS) });
      const [row] = await testApp.db.select().from(customers).where(and(eq(customers.id, customer.id), isNull(customers.deletedAt)));
      expect(row).toBeUndefined();
      expect((await storedRequest(quoteRequest.id)).customerId).toBe(customer.id);
      await testApp.http.get('/api/v1/policies').set(session).expect(401);
    });
  });
});
