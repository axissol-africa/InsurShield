import { randomInt, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { MAX_KWACHA } from '../src/common/domain/money-limits.js';
import { testDatabase } from '../src/config/env.js';
import { createDatabase, DATABASE } from '../src/db/database.module.js';
import { InsurerPortalRepository } from '../src/insurer-portal/insurer-portal.repository.js';
import { NCD_CODE_PICK } from '../src/insurer-portal/insurer-portal.service.js';
import * as schema from '../src/db/schema.js';
import {
  claimNotifications,
  insurerQuotes,
  ncdApplications,
  ncdCodes,
  payments,
  policies,
  quoteRequestRecipients,
  quoteRequests,
  vehicles,
} from '../src/db/schema.js';
import {
  buildClaim,
  buildCustomer,
  buildDocument,
  buildInsurer,
  buildInsurerQuote,
  buildPurchasedPolicy,
  buildQuoteRequest,
  buildStaffUser,
  buildVehicle,
  type BuiltInsurer,
} from './builders.js';
import { buildClaimAttachment, buildInspectionShot } from './builders/documents.js';
import { buildNcdApplication } from './builders/insurer-portal.js';
import {
  holdLocks,
  openTestDatabase,
  productionPool,
  queueBehind,
  RecordingLogger,
  startApp,
  until,
  type TestApp,
} from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';
import { FAKE_STORAGE_ORIGIN } from './storage-fake.js';

const DAY_MS = 86_400_000;
const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const DOCUMENT_KEYS = ['id', 'name', 'size', 'type', 'url'];
const REQUEST_KEYS = [
  'coverageDurationId',
  'customer',
  'deliveryStatus',
  'expiresAt',
  'id',
  'inspectionShots',
  'insuranceType',
  'photosCapturedAt',
  'policyDates',
  'reply',
  'status',
  'submittedAt',
  'vehicle',
  'vehicleDetails',
  'vehicleUsage',
  'vehicleValue',
];
const REPLY_KEYS = ['document', 'extendedAt', 'insurerReference', 'notes', 'premium', 'sentAt', 'validUntil', 'validityDays'];
const POLICY_KEYS = [
  'certificateDocument',
  'coverage',
  'customerEmail',
  'customerName',
  'customerPhone',
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
  'status',
  'vehicle',
  'vehicleDetails',
];
const CLAIM_KEYS = [
  'claimNumber',
  'description',
  'email',
  'estimatedLoss',
  'fullName',
  'incidentDate',
  'insurerClaimReference',
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
const NCD_KEYS = [
  'applicationNumber',
  'approvedCode',
  'decidedAt',
  'fullName',
  'id',
  'phone',
  'policyNumber',
  'status',
  'submittedAt',
  'yearsClaimFree',
];

const LOCKING_THE_RECIPIENT = 'select % from "quote_request_recipients" % for update%';
const LOCKING_THE_POLICY = 'select % from "policies" % for update%';
const LOCKING_THE_APPLICATION = 'select % from "ncd_applications" % for update%';
const LOCKING_THE_DOCUMENT = 'select % from "documents" % for update%';
const EXTENDING_THE_QUOTE = 'update "insurer_quotes" %';
const ACKNOWLEDGING_THE_CLAIM = 'update "claim_notifications" %';
const INSERTING_THE_QUOTE = 'insert into "insurer_quotes" %';
const LINKING_THE_CODE = 'update "ncd_applications" %';

const sorted = (value: object) => Object.keys(value).sort();

describe('insurer portal', () => {
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

  const asStaff = async (staff: { keycloakId: string; email: string }) =>
    bearer(await staffToken(staff, ['insurer_user']));

  const get = async (insurer: BuiltInsurer, path: string) =>
    testApp.http.get(`/api/v1/insurer/${path}`).set(await asStaff(insurer.staff));

  const post = async (insurer: BuiltInsurer, path: string, body: Record<string, unknown> = {}) =>
    testApp.http.post(`/api/v1/insurer/${path}`).set(await asStaff(insurer.staff)).send(body);

  const upload = (insurer: BuiltInsurer, kind: 'QUOTATION' | 'CERTIFICATE') =>
    buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind });

  /** A request sent to `insurer`, open for quotes. */
  async function openRequest(insurer: BuiltInsurer, overrides: Parameters<typeof buildQuoteRequest>[2] = {}) {
    const customer = await buildCustomer(testApp.db);
    const { quoteRequest } = await buildQuoteRequest(
      testApp.db,
      { customerId: customer.id, insurerIds: [insurer.insurer.id] },
      overrides,
    );
    return quoteRequest;
  }

  const quotesFor = (quoteRequestId: string) =>
    testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.quoteRequestId, quoteRequestId));
  const policyRow = async (policyNumber: string) =>
    (await testApp.db.select().from(policies).where(eq(policies.policyNumber, policyNumber)))[0];
  const claimRow = async (claimNumber: string) =>
    (await testApp.db.select().from(claimNotifications).where(eq(claimNotifications.claimNumber, claimNumber)))[0];
  const applicationRow = async (id: string) =>
    (await testApp.db.select().from(ncdApplications).where(eq(ncdApplications.id, id)))[0];
  const codesOf = (insurerId: string) =>
    testApp.db.select().from(ncdCodes).where(eq(ncdCodes.insurerId, insurerId));

  const lockedBy = (statement: string, values: unknown[]) =>
    holdLocks(side.pool, (_db, client) => client.query(statement, values));

  /** Starts both calls while `lock` is held, waits until both queue on `statement`, then lets them go. */
  async function race<T>(
    lock: { sql: string; params: unknown[] },
    statement: string,
    calls: [() => Promise<T>, () => Promise<T>],
  ): Promise<T[]> {
    return queueBehind(await lockedBy(lock.sql, lock.params), statement, 2, calls);
  }

  describe('what each endpoint returns', () => {
    it('lists the requests sent to the insurer, newest first, with only its own reply', async () => {
      const insurer = await buildInsurer(testApp.db);
      const rival = await buildInsurer(testApp.db);
      const customer = await buildCustomer(testApp.db, {
        fullName: 'Mwila Tembo',
        email: `${randomUUID()}@example.invalid`,
      });
      const vehicle = await buildVehicle(testApp.db, {
        plateNumber: 'BAZ 4821',
        make: 'Toyota',
        model: 'Hilux',
        year: '2021',
        chassisNumber: 'JTFB22H10A1234567',
      });
      const { quoteRequest: quoted } = await buildQuoteRequest(
        testApp.db,
        { customerId: customer.id, insurerIds: [insurer.insurer.id, rival.insurer.id], vehicleId: vehicle.id },
        {
          status: 'QUOTED',
          submittedAt: new Date('2026-10-20T08:00:00.120Z'),
          expiresAt: new Date('2099-10-27T08:00:00.456Z'),
          vehicleValueMinor: 123_456,
          vehicleUsage: 'PRIVATE',
          insuranceType: 'THIRD_PARTY',
          coverageDuration: 'Q2',
          policyStartDate: new Date('2026-11-01T00:00:00.000Z'),
          policyEndDate: new Date('2027-04-30T00:00:00.000Z'),
          coverageDays: 181,
          photosCapturedAt: new Date('2026-10-20T07:55:10.789Z'),
        },
      );
      const { shot } = await buildInspectionShot(testApp.db, {
        quoteRequestId: quoted.id,
        uploader: { customerId: customer.id },
      });
      const { document } = await buildInsurerQuote(
        testApp.db,
        { quoteRequestId: quoted.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
        {
          premiumMinor: 123_456,
          notes: 'Excess K2,500.',
          insurerReference: 'Q-2026-0042',
          validityDays: 14,
          sentAt: new Date('2026-10-20T09:15:30.123Z'),
          validUntil: new Date('2099-11-03T09:15:30.123Z'),
        },
      );
      await buildInsurerQuote(
        testApp.db,
        { quoteRequestId: quoted.id, insurerId: rival.insurer.id, staffId: rival.staff.id },
        { premiumMinor: 99_900 },
      );
      const { quoteRequest: waiting } = await buildQuoteRequest(
        testApp.db,
        { customerId: customer.id, insurerIds: [insurer.insurer.id] },
        { submittedAt: new Date('2026-10-21T08:00:00.000Z') },
      );

      const response = await get(insurer, 'quote-requests');

      expect(response.status).toBe(200);
      expect(response.body.map((row: { id: string }) => row.id)).toEqual([waiting.id, quoted.id]);
      const [newest, older] = response.body;
      for (const row of response.body) expect(sorted(row)).toEqual(REQUEST_KEYS);
      expect(newest.reply).toBeNull();
      expect(newest.policyDates).toBeNull();
      expect(newest.photosCapturedAt).toBeNull();
      expect(newest.inspectionShots).toEqual([]);
      expect(older).toEqual({
        id: quoted.id,
        status: 'Quoted',
        deliveryStatus: 'PENDING',
        submittedAt: '2026-10-20T08:00:00.120Z',
        expiresAt: '2099-10-27T08:00:00.456Z',
        vehicle: '2021 Toyota Hilux',
        vehicleDetails: {
          plateNumber: 'BAZ 4821',
          make: 'Toyota',
          model: 'Hilux',
          year: '2021',
          chassisNumber: 'JTFB22H10A1234567',
        },
        vehicleValue: 1234.56,
        vehicleUsage: 'PRIVATE',
        insuranceType: 'ThirdParty',
        coverageDurationId: '2q',
        policyDates: {
          startDate: '2026-11-01T00:00:00.000Z',
          endDate: '2027-04-30T00:00:00.000Z',
          daysTotal: 181,
        },
        customer: { fullName: 'Mwila Tembo', email: customer.email, phone: customer.phone },
        inspectionShots: [shot.shotKey],
        photosCapturedAt: '2026-10-20T07:55:10.789Z',
        reply: {
          premium: 1234.56,
          notes: 'Excess K2,500.',
          insurerReference: 'Q-2026-0042',
          validityDays: 14,
          sentAt: '2026-10-20T09:15:30.123Z',
          validUntil: '2099-11-03T09:15:30.123Z',
          extendedAt: null,
          document: {
            id: document.id,
            name: document.fileName,
            type: document.mimeType,
            size: document.sizeBytes,
            url: expect.stringContaining(`${FAKE_STORAGE_ORIGIN}/`),
          },
        },
      });
      expect(sorted(older.reply)).toEqual(REPLY_KEYS);
      expect(sorted(older.reply.document)).toEqual(DOCUMENT_KEYS);
    });

    it('sends a final quote, with the insurer validity when none is given, and marks the request quoted', async () => {
      const insurer = await buildInsurer(testApp.db, { insurer: { quoteValidityDays: 10 } });
      const request = await openRequest(insurer);
      const quotation = await upload(insurer, 'QUOTATION');

      const before = Date.now();
      const response = await post(insurer, `quote-requests/${request.id}/quote`, {
        premium: 1234.56,
        documentId: quotation.id,
        notes: 'Includes windscreen cover.',
        insurerReference: 'Q-77',
      });

      expect(response.status).toBe(201);
      expect(sorted(response.body)).toEqual(REPLY_KEYS);
      expect(response.body).toMatchObject({
        premium: 1234.56,
        notes: 'Includes windscreen cover.',
        insurerReference: 'Q-77',
        validityDays: 10,
        extendedAt: null,
        document: { id: quotation.id, name: quotation.fileName, type: quotation.mimeType, size: quotation.sizeBytes },
      });
      expect(response.body.sentAt).toMatch(ISO_MS);
      expect(Date.parse(response.body.sentAt)).toBeGreaterThanOrEqual(before - 1);
      expect(Date.parse(response.body.validUntil) - Date.parse(response.body.sentAt)).toBe(10 * DAY_MS);
      expect(sorted(response.body.document)).toEqual(DOCUMENT_KEYS);

      const [stored] = await quotesFor(request.id);
      expect(stored).toMatchObject({ premiumMinor: 123_456, documentId: quotation.id, insurerId: insurer.insurer.id });
      const [requestRow] = await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.id, request.id));
      expect(requestRow.status).toBe('QUOTED');
      const [recipient] = await testApp.db
        .select()
        .from(quoteRequestRecipients)
        .where(eq(quoteRequestRecipients.quoteRequestId, request.id));
      expect(recipient.status).toBe('ACKNOWLEDGED');
      expect(recipient.acknowledgedAt?.toISOString()).toBe(response.body.sentAt);
    });

    it('extends an open quote by whole days', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);
      const validUntil = new Date(Date.now() + 2 * DAY_MS);
      validUntil.setUTCMilliseconds(345);
      await buildInsurerQuote(
        testApp.db,
        { quoteRequestId: request.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
        { premiumMinor: 123_456, validityDays: 14, validUntil },
      );

      const response = await post(insurer, `quote-requests/${request.id}/extend`, { extraDays: 5 });

      expect(response.status).toBe(200);
      expect(sorted(response.body)).toEqual(['extendedAt', 'premium', 'validUntil', 'validityDays']);
      expect(response.body).toMatchObject({
        premium: 1234.56,
        validityDays: 19,
        validUntil: new Date(validUntil.getTime() + 5 * DAY_MS).toISOString(),
      });
      expect(response.body.extendedAt).toMatch(ISO_MS);
    });

    it('lists paid policies with their payment proof and documents', async () => {
      const insurer = await buildInsurer(testApp.db);
      const customer = await buildCustomer(testApp.db, { fullName: 'Natasha Banda' });
      const bought = await buildPurchasedPolicy(testApp.db, { customer, insurer });
      const confirmedAt = new Date('2026-10-22T10:00:00.250Z');
      await testApp.db
        .update(policies)
        .set({
          premiumMinor: 123_456,
          plan: 'Gold',
          policyStartDate: new Date('2026-11-01T00:00:00.000Z'),
          policyEndDate: new Date('2027-10-31T00:00:00.000Z'),
          receivedAt: new Date('2026-10-22T10:00:01.500Z'),
        })
        .where(eq(policies.policyNumber, bought.policy.policyNumber));
      await testApp.db
        .update(payments)
        .set({ amountMinor: 123_456, confirmedAt })
        .where(eq(payments.id, bought.payment.id));
      const [vehicle] = await testApp.db.select().from(vehicles).where(eq(vehicles.id, bought.quoteRequest.vehicleId));

      const response = await get(insurer, 'policies');

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      const [policy] = response.body;
      expect(sorted(policy)).toEqual(POLICY_KEYS);
      expect(policy).toEqual({
        policyNumber: bought.policy.policyNumber,
        insurerPolicyNumber: null,
        status: 'Awaiting insurer certificate',
        coverage: 'Comprehensive',
        plan: 'Gold',
        premium: 1234.56,
        customerName: 'Natasha Banda',
        customerEmail: customer.email,
        customerPhone: customer.phone,
        vehicle: `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
        vehicleDetails: { plateNumber: vehicle.plateNumber },
        policyDates: { startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-10-31T00:00:00.000Z' },
        quoteRequestId: bought.quoteRequest.id,
        insurerQuoteReference: bought.quote.insurerReference,
        quoteDocument: expect.objectContaining({ id: bought.quotation.id }),
        certificateDocument: null,
        paymentProof: {
          transactionId: bought.payment.transactionId,
          status: 'CONFIRMED',
          method: 'MOBILE_MONEY',
          amount: 1234.56,
          currency: 'ZMW',
          confirmedAt: '2026-10-22T10:00:00.250Z',
        },
        receivedAt: '2026-10-22T10:00:01.500Z',
        issuedAt: null,
      });
      expect(sorted(policy.quoteDocument)).toEqual(DOCUMENT_KEYS);
    });

    it('activates a policy when its certificate arrives', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { insurer });
      const certificate = await upload(insurer, 'CERTIFICATE');

      const response = await post(insurer, `policies/${policy.policyNumber}/certificate`, {
        certificateDocumentId: certificate.id,
        insurerPolicyNumber: 'MTR-0099',
      });

      expect(response.status).toBe(200);
      expect(sorted(response.body)).toEqual([
        'certificateDocument',
        'insurerPolicyNumber',
        'issuedAt',
        'policyNumber',
        'status',
      ]);
      expect(response.body).toMatchObject({
        policyNumber: policy.policyNumber,
        insurerPolicyNumber: 'MTR-0099',
        status: 'Active',
        certificateDocument: { id: certificate.id, name: certificate.fileName },
      });
      expect(response.body.issuedAt).toMatch(ISO_MS);
      expect(await policyRow(policy.policyNumber)).toMatchObject({
        status: 'ACTIVE',
        certificateDocumentId: certificate.id,
        insurerPolicyNumber: 'MTR-0099',
      });
    });

    it('lists claims with their estimated loss and attachments', async () => {
      const insurer = await buildInsurer(testApp.db);
      const customer = await buildCustomer(testApp.db);
      const withoutLoss = await buildClaim(
        testApp.db,
        { insurerId: insurer.insurer.id, customerId: customer.id },
        {
          submittedAt: new Date('2026-10-21T08:00:00.000Z'),
          incidentDate: new Date('2026-10-19T17:45:00.321Z'),
          estimatedLossMinor: null,
        },
      );
      const withLoss = await buildClaim(
        testApp.db,
        { insurerId: insurer.insurer.id, customerId: customer.id },
        {
          submittedAt: new Date('2026-10-22T08:00:00.000Z'),
          estimatedLossMinor: 1,
          email: 'chanda@example.invalid',
          policeReport: true,
          policeReportNumber: 'LSK-1',
          lateReason: 'In hospital.',
        },
      );
      const { document } = await buildClaimAttachment(testApp.db, {
        claimNumber: withLoss.claimNumber,
        uploader: { customerId: customer.id },
      });

      const response = await get(insurer, 'claims');

      expect(response.status).toBe(200);
      expect(response.body.map((row: { claimNumber: string }) => row.claimNumber)).toEqual([
        withLoss.claimNumber,
        withoutLoss.claimNumber,
      ]);
      for (const row of response.body) expect(sorted(row)).toEqual(CLAIM_KEYS);
      const [newest, older] = response.body;
      expect(newest).toMatchObject({
        status: 'Notified',
        estimatedLoss: 0.01,
        email: 'chanda@example.invalid',
        policeReport: true,
        policeReportNumber: 'LSK-1',
        lateReason: 'In hospital.',
        submittedAt: '2026-10-22T08:00:00.000Z',
        receivedAt: null,
        insurerClaimReference: null,
      });
      expect(newest.supportingDocs).toEqual([expect.objectContaining({ id: document.id })]);
      expect(sorted(newest.supportingDocs[0])).toEqual(DOCUMENT_KEYS);
      expect(older).toEqual({
        claimNumber: withoutLoss.claimNumber,
        status: 'Notified',
        fullName: withoutLoss.fullName,
        phone: withoutLoss.phone,
        email: null,
        plate: withoutLoss.plate,
        vehicle: withoutLoss.vehicleLabel,
        type: withoutLoss.type,
        incidentDate: '2026-10-19T17:45:00.321Z',
        location: withoutLoss.location,
        description: withoutLoss.description,
        estimatedLoss: null,
        policeReport: false,
        policeReportNumber: null,
        lateReason: null,
        policyNumber: null,
        insurerClaimReference: null,
        submittedAt: '2026-10-21T08:00:00.000Z',
        receivedAt: null,
        supportingDocs: [],
      });
    });

    it('acknowledges a claim with the insurer reference', async () => {
      const insurer = await buildInsurer(testApp.db);
      const claim = await buildClaim(testApp.db, { insurerId: insurer.insurer.id });

      const response = await post(insurer, `claims/${claim.claimNumber}/received`, { insurerClaimReference: 'IC-5' });

      expect(response.status).toBe(200);
      expect(sorted(response.body)).toEqual(['claimNumber', 'insurerClaimReference', 'receivedAt', 'status']);
      expect(response.body).toMatchObject({
        claimNumber: claim.claimNumber,
        status: 'RECEIVED_BY_INSURER',
        insurerClaimReference: 'IC-5',
      });
      expect(response.body.receivedAt).toMatch(ISO_MS);
    });

    it('lists NCD applications, newest first, with the code of an approved one', async () => {
      const insurer = await buildInsurer(testApp.db);
      const [code] = await testApp.db
        .insert(ncdCodes)
        .values({ code: `NCD-${randomUUID().slice(0, 8)}`, insurerId: insurer.insurer.id, percentage: 30, yearsClaimFree: 3 })
        .returning();
      const approved = await buildNcdApplication(
        testApp.db,
        { insurerId: insurer.insurer.id },
        {
          status: 'APPROVED',
          approvedCodeId: code.code,
          submittedAt: new Date('2026-10-20T08:00:00.010Z'),
          decidedAt: new Date('2026-10-21T08:00:00.020Z'),
        },
      );
      const fresh = await buildNcdApplication(
        testApp.db,
        { insurerId: insurer.insurer.id },
        { submittedAt: new Date('2026-10-22T08:00:00.030Z') },
      );

      const response = await get(insurer, 'ncd/applications');

      expect(response.status).toBe(200);
      for (const row of response.body) expect(sorted(row)).toEqual(NCD_KEYS);
      expect(response.body).toEqual([
        {
          id: fresh.id,
          applicationNumber: fresh.applicationNumber,
          policyNumber: fresh.policyNumber,
          fullName: fresh.fullName,
          phone: fresh.phone,
          yearsClaimFree: 3,
          status: 'Submitted',
          approvedCode: null,
          submittedAt: '2026-10-22T08:00:00.030Z',
          decidedAt: null,
        },
        {
          id: approved.id,
          applicationNumber: approved.applicationNumber,
          policyNumber: approved.policyNumber,
          fullName: approved.fullName,
          phone: approved.phone,
          yearsClaimFree: 3,
          status: 'Approved',
          approvedCode: code.code,
          submittedAt: '2026-10-20T08:00:00.010Z',
          decidedAt: '2026-10-21T08:00:00.020Z',
        },
      ]);
    });

    it('approves an application with a code at the automatic percentage', async () => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id }, { yearsClaimFree: 4 });

      const response = await post(insurer, `ncd/applications/${application.id}/decision`, { status: 'APPROVED' });

      expect(response.status).toBe(200);
      expect(sorted(response.body)).toEqual(['approvedCode', 'decidedAt', 'id', 'percentage', 'status']);
      expect(response.body).toMatchObject({ id: application.id, status: 'Approved', percentage: 40 });
      expect(response.body.approvedCode).toMatch(/^NCD-[0-9A-Z]{5}$/);
      expect(response.body.decidedAt).toMatch(ISO_MS);
      const [code] = await codesOf(insurer.insurer.id);
      expect(code).toMatchObject({ code: response.body.approvedCode, percentage: 40, yearsClaimFree: 4, redeemedAt: null });
      expect((await applicationRow(application.id)).approvedCodeId).toBe(response.body.approvedCode);
    });

    it('approves with the percentage the insurer chose', async () => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id });

      const response = await post(insurer, `ncd/applications/${application.id}/decision`, {
        status: 'APPROVED',
        percentage: 15,
      });

      expect(response.status).toBe(200);
      expect(response.body.percentage).toBe(15);
      expect((await codesOf(insurer.insurer.id))[0].percentage).toBe(15);
    });

    it.each([
      ['REJECTED', 'Rejected', true],
      ['UNDER_REVIEW', 'Under Review', false],
    ])('records a %s decision without a code', async (status, wire, decided) => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id });

      const response = await post(insurer, `ncd/applications/${application.id}/decision`, { status });

      expect(response.status).toBe(200);
      expect(sorted(response.body)).toEqual(['approvedCode', 'decidedAt', 'id', 'status']);
      expect(response.body).toMatchObject({ id: application.id, status: wire, approvedCode: null });
      if (decided) expect(response.body.decidedAt).toMatch(ISO_MS);
      else expect(response.body.decidedAt).toBeNull();
      expect(await codesOf(insurer.insurer.id)).toEqual([]);
    });
  });

  describe('tenancy', () => {
    /** Insurer `owner`'s records of every kind, and another insurer's user who must not reach them. */
    async function twoInsurers() {
      const owner = await buildInsurer(testApp.db);
      const other = await buildInsurer(testApp.db);
      const request = await openRequest(owner);
      const quoted = await openRequest(owner);
      const { quote } = await buildInsurerQuote(testApp.db, {
        quoteRequestId: quoted.id,
        insurerId: owner.insurer.id,
        staffId: owner.staff.id,
      });
      const { policy } = await buildPurchasedPolicy(testApp.db, { insurer: owner });
      const claim = await buildClaim(testApp.db, { insurerId: owner.insurer.id });
      const application = await buildNcdApplication(testApp.db, { insurerId: owner.insurer.id });
      return { owner, other, request, quoted, quote, policy, claim, application };
    }

    it('lists none of another insurer\'s requests, policies, claims or NCD applications', async () => {
      const { other } = await twoInsurers();

      for (const path of ['quote-requests', 'policies', 'claims', 'ncd/applications']) {
        const response = await get(other, path);
        expect(response.status).toBe(200);
        expect(response.body).toEqual([]);
      }
    });

    it('answers 404 for another insurer\'s records and changes nothing', async () => {
      const { other, request, quoted, quote, policy, claim, application } = await twoInsurers();
      const quotation = await upload(other, 'QUOTATION');
      const certificate = await upload(other, 'CERTIFICATE');

      const calls: [string, Record<string, unknown>][] = [
        [`quote-requests/${request.id}/quote`, { premium: 100, documentId: quotation.id }],
        [`quote-requests/${quoted.id}/extend`, { extraDays: 3 }],
        [`policies/${policy.policyNumber}/certificate`, { certificateDocumentId: certificate.id }],
        [`claims/${claim.claimNumber}/received`, {}],
        [`ncd/applications/${application.id}/decision`, { status: 'APPROVED' }],
      ];
      for (const [path, body] of calls) {
        const response = await post(other, path, body);
        expect({ path, status: response.status, code: response.body.code }).toEqual({
          path,
          status: 404,
          code: 'NOT_FOUND',
        });
      }

      expect(await quotesFor(request.id)).toEqual([]);
      const [quoteAfter] = await quotesFor(quoted.id);
      expect(quoteAfter.validUntil.toISOString()).toBe(quote.validUntil.toISOString());
      expect(quoteAfter.extendedAt).toBeNull();
      expect(await policyRow(policy.policyNumber)).toMatchObject({ status: 'AWAITING_INSURER_CERTIFICATE', certificateDocumentId: null });
      expect(await claimRow(claim.claimNumber)).toMatchObject({ status: 'NOTIFIED', receivedAt: null });
      expect(await applicationRow(application.id)).toMatchObject({ status: 'SUBMITTED', approvedCodeId: null });
      expect(await codesOf(other.insurer.id)).toEqual([]);
    });

    it('reads shots and claim attachments of the insurer\'s own requests and claims only', async () => {
      const owner = await buildInsurer(testApp.db);
      const other = await buildInsurer(testApp.db);
      const customer = await buildCustomer(testApp.db);
      const uploader = { customerId: customer.id };
      const ownRequest = await openRequest(owner);
      const foreignRequest = await openRequest(other);
      const { shot } = await buildInspectionShot(testApp.db, { quoteRequestId: ownRequest.id, uploader });
      await buildInspectionShot(testApp.db, { quoteRequestId: foreignRequest.id, uploader });
      const ownClaim = await buildClaim(testApp.db, { insurerId: owner.insurer.id });
      const foreignClaim = await buildClaim(testApp.db, { insurerId: other.insurer.id });
      const { document } = await buildClaimAttachment(testApp.db, { claimNumber: ownClaim.claimNumber, uploader });
      await buildClaimAttachment(testApp.db, { claimNumber: foreignClaim.claimNumber, uploader });
      const repository = testApp.app.get(InsurerPortalRepository);

      expect(await repository.shotKeys(owner.insurer.id, [ownRequest.id, foreignRequest.id])).toEqual([
        { quoteRequestId: ownRequest.id, shotKey: shot.shotKey },
      ]);
      expect(await repository.attachmentIds(owner.insurer.id, [ownClaim.claimNumber, foreignClaim.claimNumber])).toEqual([
        { claimNumber: ownClaim.claimNumber, documentId: document.id },
      ]);
    });

    it('marks no request quoted for an insurer it was not sent to, and changes nothing', async () => {
      const owner = await buildInsurer(testApp.db);
      const other = await buildInsurer(testApp.db);
      const foreignRequest = await openRequest(other);
      const stored = async () => ({
        request: await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.id, foreignRequest.id)),
        recipients: await testApp.db
          .select()
          .from(quoteRequestRecipients)
          .where(eq(quoteRequestRecipients.quoteRequestId, foreignRequest.id)),
      });
      const before = await stored();
      const repository = testApp.app.get(InsurerPortalRepository);

      const marked = await testApp.db.transaction((tx) =>
        repository.markQuoted(tx, foreignRequest.id, owner.insurer.id, new Date()),
      );

      expect(marked).toBe(false);
      expect(await stored()).toEqual(before);
    });

    it('refuses customers and admins with 403 and anonymous callers with 401 on a read and a write', async () => {
      const { request } = await twoInsurers();
      const customer = await buildCustomer(testApp.db);
      const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
      const superAdmin = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
      const callers: [string, Record<string, string>, number][] = [
        ['customer', bearer(await customerToken(customer)), 403],
        ['admin', bearer(await staffToken(admin, ['admin'])), 403],
        ['super admin', bearer(await staffToken(superAdmin, ['super_admin'])), 403],
        ['anonymous', {}, 401],
      ];

      for (const [who, headers, status] of callers) {
        const read = await testApp.http.get('/api/v1/insurer/quote-requests').set(headers);
        const write = await testApp.http
          .post(`/api/v1/insurer/quote-requests/${request.id}/quote`)
          .set(headers)
          .send({ premium: 100, documentId: randomUUID() });
        expect({ who, read: read.status, write: write.status }).toEqual({ who, read: status, write: status });
      }
      expect(await quotesFor(request.id)).toEqual([]);
    });

    it('refuses an insurer user whose account has no insurer on every route', async () => {
      const { request, quoted, policy, claim, application } = await twoInsurers();
      const staff = await buildStaffUser(testApp.db, { role: 'INSURER_USER', insurerId: null });
      const headers = await asStaff(staff);

      const gets = ['profile', 'quote-requests', 'policies', 'claims', 'ncd/applications'];
      const posts: [string, Record<string, unknown>][] = [
        [`quote-requests/${request.id}/quote`, { premium: 100, documentId: randomUUID() }],
        [`quote-requests/${quoted.id}/extend`, { extraDays: 3 }],
        [`policies/${policy.policyNumber}/certificate`, { certificateDocumentId: randomUUID() }],
        [`claims/${claim.claimNumber}/received`, {}],
        [`ncd/applications/${application.id}/decision`, { status: 'APPROVED' }],
      ];
      for (const path of gets) {
        const response = await testApp.http.get(`/api/v1/insurer/${path}`).set(headers);
        expect({ path, status: response.status, code: response.body.code }).toEqual({ path, status: 403, code: 'FORBIDDEN' });
      }
      for (const [path, body] of posts) {
        const response = await testApp.http.post(`/api/v1/insurer/${path}`).set(headers).send(body);
        expect({ path, status: response.status, code: response.body.code }).toEqual({ path, status: 403, code: 'FORBIDDEN' });
      }
      expect(await quotesFor(request.id)).toEqual([]);
    });
  });

  describe('final quotes', () => {
    it('refuses a second final quote with 409 ALREADY_QUOTED', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);
      const first = await post(insurer, `quote-requests/${request.id}/quote`, {
        premium: 500,
        documentId: (await upload(insurer, 'QUOTATION')).id,
      });
      expect(first.status).toBe(201);

      const second = await post(insurer, `quote-requests/${request.id}/quote`, {
        premium: 450,
        documentId: (await upload(insurer, 'QUOTATION')).id,
      });

      expect(second.status).toBe(409);
      expect(second.body.code).toBe('ALREADY_QUOTED');
      const quotes = await quotesFor(request.id);
      expect(quotes.map((quote) => quote.premiumMinor)).toEqual([50_000]);
    });

    it('lets one of two concurrent final quotes win and refuses the other with 409 ALREADY_QUOTED', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);
      const documents = [await upload(insurer, 'QUOTATION'), await upload(insurer, 'QUOTATION')];

      const responses = await race(
        {
          sql: 'SELECT id FROM quote_request_recipients WHERE "quoteRequestId" = $1 AND "insurerId" = $2 FOR UPDATE',
          params: [request.id, insurer.insurer.id],
        },
        LOCKING_THE_RECIPIENT,
        [
          () => post(insurer, `quote-requests/${request.id}/quote`, { premium: 500, documentId: documents[0].id }),
          () => post(insurer, `quote-requests/${request.id}/quote`, { premium: 450, documentId: documents[1].id }),
        ],
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_QUOTED');
      expect(await quotesFor(request.id)).toHaveLength(1);
    });

    it('refuses with 409 REQUEST_EXPIRED and keeps no quote when the request expires while the quote is written', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);
      const document = await upload(insurer, 'QUOTATION');

      const held = await lockedBy('SELECT id FROM quote_requests WHERE id = $1 FOR UPDATE', [request.id]);
      const pending = post(insurer, `quote-requests/${request.id}/quote`, { premium: 500, documentId: document.id });
      try {
        await until(async () => (await held.waiters(INSERTING_THE_QUOTE)) === 1, 'the quote insert to wait on the request');
        await held.run(`UPDATE quote_requests SET status = 'EXPIRED' WHERE id = $1`, [request.id]);
      } finally {
        await held.release();
      }
      const response = await pending;

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('REQUEST_EXPIRED');
      expect(await quotesFor(request.id)).toEqual([]);
      const [delivery] = await testApp.db
        .select()
        .from(quoteRequestRecipients)
        .where(eq(quoteRequestRecipients.quoteRequestId, request.id));
      expect(delivery.acknowledgedAt).toBeNull();
    });

    it('answers 409 CONFLICT when another insurer already used the same reference on the request', async () => {
      const first = await buildInsurer(testApp.db);
      const second = await buildInsurer(testApp.db);
      const customer = await buildCustomer(testApp.db);
      const { quoteRequest } = await buildQuoteRequest(testApp.db, {
        customerId: customer.id,
        insurerIds: [first.insurer.id, second.insurer.id],
      });
      const body = async (insurer: BuiltInsurer) => ({
        premium: 500,
        documentId: (await upload(insurer, 'QUOTATION')).id,
        insurerReference: 'Q-1',
      });
      expect((await post(first, `quote-requests/${quoteRequest.id}/quote`, await body(first))).status).toBe(201);

      const response = await post(second, `quote-requests/${quoteRequest.id}/quote`, await body(second));

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
      expect((await quotesFor(quoteRequest.id)).map((quote) => quote.insurerId)).toEqual([first.insurer.id]);
    });

    it.each([
      ['past its expiry time', { expiresAt: new Date(Date.now() - 60_000) }],
      ['marked expired', { status: 'EXPIRED' as const }],
    ])('refuses a quote for a request %s with 409 REQUEST_EXPIRED', async (_case, overrides) => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer, overrides);

      const response = await post(insurer, `quote-requests/${request.id}/quote`, {
        premium: 500,
        documentId: (await upload(insurer, 'QUOTATION')).id,
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('REQUEST_EXPIRED');
      expect(await quotesFor(request.id)).toEqual([]);
      const [requestRow] = await testApp.db.select().from(quoteRequests).where(eq(quoteRequests.id, request.id));
      expect(requestRow.status).toBe(request.status);
    });

    it('stores a premium of exactly the largest amount', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);

      const response = await post(insurer, `quote-requests/${request.id}/quote`, {
        premium: MAX_KWACHA,
        documentId: (await upload(insurer, 'QUOTATION')).id,
      });

      expect(response.status).toBe(201);
      expect(response.body.premium).toBe(MAX_KWACHA);
      expect((await quotesFor(request.id))[0].premiumMinor).toBe(99_999_999_999_999);
    });

    it.each([
      ['above the largest amount', MAX_KWACHA + 0.01],
      ['with three decimals', 100.001],
      ['of zero', 0],
    ])('refuses a premium %s with 400 and stores nothing', async (_case, premium) => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);

      const response = await post(insurer, `quote-requests/${request.id}/quote`, {
        premium,
        documentId: (await upload(insurer, 'QUOTATION')).id,
      });

      expect(response.status).toBe(400);
      expect(await quotesFor(request.id)).toEqual([]);
    });
  });

  describe('quotation and certificate attachments', () => {
    type Attach = 'quotation' | 'certificate';

    /** Something to attach to, and the call that attaches `documentId` to it. */
    async function target(attach: Attach, insurer: BuiltInsurer) {
      if (attach === 'quotation') {
        const request = await openRequest(insurer);
        return {
          send: (documentId: string) =>
            post(insurer, `quote-requests/${request.id}/quote`, { premium: 750, documentId }),
          attached: async () => (await quotesFor(request.id)).map((quote) => quote.documentId),
        };
      }
      const { policy } = await buildPurchasedPolicy(testApp.db, { insurer });
      return {
        send: (documentId: string) =>
          post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: documentId }),
        attached: async () => {
          const row = await policyRow(policy.policyNumber);
          return row.certificateDocumentId ? [row.certificateDocumentId] : [];
        },
      };
    }
    const kindFor = (attach: Attach) => (attach === 'quotation' ? 'QUOTATION' : 'CERTIFICATE');
    const otherKind = (attach: Attach) => (attach === 'quotation' ? 'CERTIFICATE' : 'QUOTATION');

    describe.each(['quotation', 'certificate'] as const)('the %s', (attach) => {
      it('attaches a fresh upload of the insurer user', async () => {
        const insurer = await buildInsurer(testApp.db);
        const { send, attached } = await target(attach, insurer);
        const document = await upload(insurer, kindFor(attach));

        const response = await send(document.id);

        expect(response.status).toBeLessThan(300);
        expect(await attached()).toEqual([document.id]);
      });

      it.each([
        ['uploaded by a customer', 'customer'],
        ['uploaded by a colleague at the same insurer', 'colleague'],
        ['uploaded by another insurer', 'rival'],
        ['of the wrong kind', 'kind'],
        ['already attached elsewhere', 'attached'],
        ['that does not exist', 'missing'],
      ])('refuses a document %s with 409 DOCUMENT_NOT_ATTACHABLE', async (_case, source) => {
        const insurer = await buildInsurer(testApp.db);
        const { send, attached } = await target(attach, insurer);
        const kind = kindFor(attach);
        let documentId: string;
        if (source === 'customer') {
          const customer = await buildCustomer(testApp.db);
          documentId = (await buildDocument(testApp.db, { customerId: customer.id }, { kind })).id;
        } else if (source === 'colleague') {
          const colleague = await buildStaffUser(testApp.db, { role: 'INSURER_USER', insurerId: insurer.insurer.id });
          documentId = (await buildDocument(testApp.db, { staffId: colleague.id }, { kind })).id;
        } else if (source === 'rival') {
          documentId = (await upload(await buildInsurer(testApp.db), kind)).id;
        } else if (source === 'kind') {
          documentId = (await upload(insurer, otherKind(attach))).id;
        } else if (source === 'attached') {
          documentId = (await upload(insurer, kind)).id;
          const elsewhere = await target(attach, insurer);
          expect((await elsewhere.send(documentId)).status).toBeLessThan(300);
        } else {
          documentId = randomUUID();
        }

        const response = await send(documentId);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe('DOCUMENT_NOT_ATTACHABLE');
        expect(await attached()).toEqual([]);
      });
    });

    it('attaches one certificate to only one of two policies sent concurrently', async () => {
      const insurer = await buildInsurer(testApp.db);
      const first = await buildPurchasedPolicy(testApp.db, { insurer });
      const second = await buildPurchasedPolicy(testApp.db, { insurer });
      const certificate = await upload(insurer, 'CERTIFICATE');

      const responses = await race(
        { sql: 'SELECT id FROM documents WHERE id = $1 FOR UPDATE', params: [certificate.id] },
        LOCKING_THE_DOCUMENT,
        [first, second].map(
          ({ policy }) =>
            () =>
              post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: certificate.id }),
        ) as [() => ReturnType<typeof post>, () => ReturnType<typeof post>],
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('DOCUMENT_NOT_ATTACHABLE');
      const rows = [await policyRow(first.policy.policyNumber), await policyRow(second.policy.policyNumber)];
      expect(rows.filter((row) => row.certificateDocumentId === certificate.id)).toHaveLength(1);
      expect(rows.filter((row) => row.status === 'ACTIVE')).toHaveLength(1);
    });
  });

  describe('certificates', () => {
    it('refuses a certificate for an active policy with 409 ALREADY_ISSUED and keeps the first', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { insurer });
      const first = await upload(insurer, 'CERTIFICATE');
      expect(
        (await post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: first.id })).status,
      ).toBe(200);

      const response = await post(insurer, `policies/${policy.policyNumber}/certificate`, {
        certificateDocumentId: (await upload(insurer, 'CERTIFICATE')).id,
        insurerPolicyNumber: 'SECOND',
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ALREADY_ISSUED');
      expect(await policyRow(policy.policyNumber)).toMatchObject({
        certificateDocumentId: first.id,
        insurerPolicyNumber: null,
      });
    });

    it('activates a policy once when two certificates arrive concurrently', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { insurer });
      const certificates = [await upload(insurer, 'CERTIFICATE'), await upload(insurer, 'CERTIFICATE')];

      const responses = await race(
        { sql: 'SELECT "policyNumber" FROM policies WHERE "policyNumber" = $1 FOR UPDATE', params: [policy.policyNumber] },
        LOCKING_THE_POLICY,
        [
          () => post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: certificates[0].id }),
          () => post(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId: certificates[1].id }),
        ],
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
      const winner = responses.find((response) => response.status === 200);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_ISSUED');
      expect((await policyRow(policy.policyNumber)).certificateDocumentId).toBe(winner?.body.certificateDocument.id);
    });
  });

  describe('quote extensions', () => {
    it('refuses to extend an expired quote with 409 QUOTE_EXPIRED and leaves it unchanged', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);
      const { quote } = await buildInsurerQuote(
        testApp.db,
        { quoteRequestId: request.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
        { validUntil: new Date(Date.now() - 60_000) },
      );

      const response = await post(insurer, `quote-requests/${request.id}/extend`, { extraDays: 3 });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('QUOTE_EXPIRED');
      const [after] = await quotesFor(request.id);
      expect(after.validUntil.toISOString()).toBe(quote.validUntil.toISOString());
      expect(after.extendedAt).toBeNull();
    });

    it('answers 404 for a request this insurer has not quoted', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);

      const response = await post(insurer, `quote-requests/${request.id}/extend`, { extraDays: 3 });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('NOT_FOUND');
    });

    it('applies both of two concurrent extensions', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);
      const { quote } = await buildInsurerQuote(
        testApp.db,
        { quoteRequestId: request.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
        { validityDays: 14, validUntil: new Date(Date.now() + 3 * DAY_MS) },
      );

      const responses = await race(
        { sql: 'SELECT id FROM insurer_quotes WHERE id = $1 FOR UPDATE', params: [quote.id] },
        EXTENDING_THE_QUOTE,
        [
          () => post(insurer, `quote-requests/${request.id}/extend`, { extraDays: 3 }),
          () => post(insurer, `quote-requests/${request.id}/extend`, { extraDays: 4 }),
        ],
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      const [after] = await quotesFor(request.id);
      expect(after.validityDays).toBe(21);
      expect(after.validUntil.getTime()).toBe(quote.validUntil.getTime() + 7 * DAY_MS);
    });
  });

  describe('claim acknowledgements', () => {
    it('answers a repeated acknowledgement with the state the first one recorded', async () => {
      const insurer = await buildInsurer(testApp.db);
      const claim = await buildClaim(testApp.db, { insurerId: insurer.insurer.id });
      const first = await post(insurer, `claims/${claim.claimNumber}/received`, { insurerClaimReference: 'IC-1' });

      const again = await post(insurer, `claims/${claim.claimNumber}/received`, { insurerClaimReference: 'IC-2' });

      expect(again.status).toBe(200);
      expect(again.body).toEqual(first.body);
      expect(await claimRow(claim.claimNumber)).toMatchObject({ insurerClaimReference: 'IC-1' });
    });

    it('keeps the reference already on the claim when none is sent', async () => {
      const insurer = await buildInsurer(testApp.db);
      const claim = await buildClaim(testApp.db, { insurerId: insurer.insurer.id }, { insurerClaimReference: 'IC-0' });

      const response = await post(insurer, `claims/${claim.claimNumber}/received`);

      expect(response.status).toBe(200);
      expect(response.body.insurerClaimReference).toBe('IC-0');
    });

    it('keeps the reference already on the claim when null is sent', async () => {
      const insurer = await buildInsurer(testApp.db);
      const claim = await buildClaim(testApp.db, { insurerId: insurer.insurer.id }, { insurerClaimReference: 'IC-0' });

      const response = await post(insurer, `claims/${claim.claimNumber}/received`, { insurerClaimReference: null });

      expect(response.status).toBe(200);
      expect(response.body.insurerClaimReference).toBe('IC-0');
      expect(await claimRow(claim.claimNumber)).toMatchObject({ status: 'RECEIVED_BY_INSURER', insurerClaimReference: 'IC-0' });
    });

    it('records one acknowledgement when two arrive concurrently', async () => {
      const insurer = await buildInsurer(testApp.db);
      const claim = await buildClaim(testApp.db, { insurerId: insurer.insurer.id });

      const responses = await race(
        { sql: 'SELECT "claimNumber" FROM claim_notifications WHERE "claimNumber" = $1 FOR UPDATE', params: [claim.claimNumber] },
        ACKNOWLEDGING_THE_CLAIM,
        [
          () => post(insurer, `claims/${claim.claimNumber}/received`, { insurerClaimReference: 'IC-A' }),
          () => post(insurer, `claims/${claim.claimNumber}/received`, { insurerClaimReference: 'IC-B' }),
        ],
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(responses[1].body).toEqual(responses[0].body);
      const row = await claimRow(claim.claimNumber);
      expect(row.receivedAt?.toISOString()).toBe(responses[0].body.receivedAt);
      expect(row.insurerClaimReference).toBe(responses[0].body.insurerClaimReference);
    });
  });

  describe('NCD decisions', () => {
    it('refuses to decide an approved application again with 409 ALREADY_DECIDED', async () => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id });
      const approved = await post(insurer, `ncd/applications/${application.id}/decision`, { status: 'APPROVED' });
      expect(approved.status).toBe(200);

      for (const status of ['APPROVED', 'REJECTED']) {
        const response = await post(insurer, `ncd/applications/${application.id}/decision`, { status });
        expect(response.status).toBe(409);
        expect(response.body.code).toBe('ALREADY_DECIDED');
      }
      expect(await codesOf(insurer.insurer.id)).toHaveLength(1);
      expect(await applicationRow(application.id)).toMatchObject({
        status: 'APPROVED',
        approvedCodeId: approved.body.approvedCode,
      });
    });

    it('issues one code when two approvals arrive concurrently and refuses the other with 409 ALREADY_DECIDED', async () => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id });
      const decide = () => post(insurer, `ncd/applications/${application.id}/decision`, { status: 'APPROVED' });

      const responses = await race(
        { sql: 'SELECT id FROM ncd_applications WHERE id = $1 FOR UPDATE', params: [application.id] },
        LOCKING_THE_APPLICATION,
        [decide, decide],
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
      const winner = responses.find((response) => response.status === 200);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_DECIDED');
      const codes = await codesOf(insurer.insurer.id);
      expect(codes.map((code) => code.code)).toEqual([winner?.body.approvedCode]);
      expect((await applicationRow(application.id)).approvedCodeId).toBe(winner?.body.approvedCode);
    });

    it('leaves no code behind when the approval fails after the code was inserted', async () => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id });

      // A share lock on the table lets the application be locked and the code inserted, but stops the link update.
      const held = await lockedBy('LOCK TABLE ncd_applications IN SHARE MODE', []);
      const pending = post(insurer, `ncd/applications/${application.id}/decision`, { status: 'APPROVED' });
      try {
        await until(async () => (await held.waiters(LINKING_THE_CODE)) === 1, 'the link update to wait on the table');
        // The link update gives up at the lock timeout while the table is still locked.
        await pending;
      } finally {
        await held.release();
      }
      const response = await pending;

      expect(response.status).toBe(503);
      expect(response.body.code).toBe('TRY_AGAIN');
      expect(await codesOf(insurer.insurer.id)).toEqual([]);
      expect(await applicationRow(application.id)).toMatchObject({ status: 'SUBMITTED', approvedCodeId: null, decidedAt: null });
    });

    it('lets a rejected application be approved later', async () => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id }, { status: 'REJECTED' });

      const response = await post(insurer, `ncd/applications/${application.id}/decision`, { status: 'APPROVED' });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('Approved');
    });

    it('refuses an unknown decision with 400', async () => {
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id });

      const response = await post(insurer, `ncd/applications/${application.id}/decision`, { status: 'Approved' });

      expect(response.status).toBe(400);
      expect((await applicationRow(application.id)).status).toBe('SUBMITTED');
    });
  });

  describe('when a drawn NCD code is already taken', () => {
    const TAKEN = 'NCD-AAAAA';
    let coded: TestApp;
    let logger: RecordingLogger;
    let forced = 5;

    beforeAll(async () => {
      logger = new RecordingLogger();
      const pick = (n: number) => (forced-- > 0 ? 10 : randomInt(n));
      coded = await startApp({ logger, override: (builder) => builder.overrideProvider(NCD_CODE_PICK).useValue(pick) });
    });

    afterAll(async () => {
      await coded.close();
    });

    it('approves with a new code, leaves the taken one as it was and logs the application number', async () => {
      const holder = await buildInsurer(testApp.db);
      const [taken] = await testApp.db
        .insert(ncdCodes)
        .values({ code: TAKEN, insurerId: holder.insurer.id, percentage: 20, yearsClaimFree: 2 })
        .returning();
      const insurer = await buildInsurer(testApp.db);
      const application = await buildNcdApplication(testApp.db, { insurerId: insurer.insurer.id });

      const response = await coded.http
        .post(`/api/v1/insurer/ncd/applications/${application.id}/decision`)
        .set(await asStaff(insurer.staff))
        .send({ status: 'APPROVED' });

      expect(response.status).toBe(200);
      expect(response.body.approvedCode).toMatch(/^NCD-[0-9A-Z]{5}$/);
      expect(response.body.approvedCode).not.toBe(TAKEN);
      expect((await applicationRow(application.id)).approvedCodeId).toBe(response.body.approvedCode);
      expect((await codesOf(insurer.insurer.id)).map((code) => code.code)).toEqual([response.body.approvedCode]);
      expect(await codesOf(holder.insurer.id)).toEqual([taken]);
      expect(logger.text).toContain(`NCD ${application.applicationNumber} approved at 30%`);
      expect(logger.text).not.toContain(application.id);
    });
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

    const postSmall = async (insurer: BuiltInsurer, path: string, body: Record<string, unknown>) =>
      small.http.post(`/api/v1/insurer/${path}`).set(await asStaff(insurer.staff)).send(body);

    it('lets one of two concurrent final quotes win and refuses the other with 409 ALREADY_QUOTED', async () => {
      const insurer = await buildInsurer(testApp.db);
      const request = await openRequest(insurer);
      const documents = [await upload(insurer, 'QUOTATION'), await upload(insurer, 'QUOTATION')];

      const responses = await race(
        {
          sql: 'SELECT id FROM quote_request_recipients WHERE "quoteRequestId" = $1 AND "insurerId" = $2 FOR UPDATE',
          params: [request.id, insurer.insurer.id],
        },
        LOCKING_THE_RECIPIENT,
        [
          () => postSmall(insurer, `quote-requests/${request.id}/quote`, { premium: 500, documentId: documents[0].id }),
          () => postSmall(insurer, `quote-requests/${request.id}/quote`, { premium: 450, documentId: documents[1].id }),
        ],
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([201, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_QUOTED');
      expect(responses.find((response) => response.status === 201)?.body.document.url).toContain(FAKE_STORAGE_ORIGIN);
    });

    it('activates a policy once when two certificates arrive concurrently', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { policy } = await buildPurchasedPolicy(testApp.db, { insurer });
      const certificates = [await upload(insurer, 'CERTIFICATE'), await upload(insurer, 'CERTIFICATE')];
      const certify = (certificateDocumentId: string) =>
        postSmall(insurer, `policies/${policy.policyNumber}/certificate`, { certificateDocumentId });

      const responses = await race(
        { sql: 'SELECT "policyNumber" FROM policies WHERE "policyNumber" = $1 FOR UPDATE', params: [policy.policyNumber] },
        LOCKING_THE_POLICY,
        [() => certify(certificates[0].id), () => certify(certificates[1].id)],
      );

      expect(responses.map((response) => response.status).sort((a, b) => a - b)).toEqual([200, 409]);
      expect(responses.find((response) => response.status === 409)?.body.code).toBe('ALREADY_ISSUED');
      expect(responses.find((response) => response.status === 200)?.body.certificateDocument.url).toContain(FAKE_STORAGE_ORIGIN);
    });
  });
});
