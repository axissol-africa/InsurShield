import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { QuoteWorkflowService } from '../src/customer/quote-workflow.service.js';
import { QuoteAvailabilityService } from '../src/customer/quote-availability.service.js';
import {
  auditLogs,
  insurerProductVersions,
  insurerProducts,
  jobs,
  notifications,
  quoteInformationRequests,
  quoteRequestProductVersions,
  quoteRequests,
  insurerQuotes,
  platformRuleVersions,
  stateHistory,
} from '../src/db/schema.js';
import {
  buildCustomer,
  buildDocument,
  buildInsurer,
  buildInsurerQuote,
  buildPayment,
  buildQuoteRequest,
  buildStaffUser,
  unique,
  type BuiltInsurer,
} from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

describe('the quote workflow of a chosen product', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const portal = async (staff: { email: string }) => signIn(testApp.http, staff);

  const insurerPost = async (insurer: BuiltInsurer, path: string, body: Record<string, unknown> = {}) =>
    testApp.http.post(`/api/v1/insurer/${path}`).set(await portal(insurer.staff)).send(body);

  const insurerGet = async (insurer: BuiltInsurer, path: string) =>
    testApp.http.get(`/api/v1/insurer/${path}`).set(await portal(insurer.staff));

  async function version(insurer: BuiltInsurer, inspection: 'NONE' | 'BEFORE_QUOTATION' = 'NONE') {
    const code = unique('B13');
    const [product] = await testApp.db
      .insert(insurerProducts)
      .values({ insurerId: insurer.insurer.id, code, coverType: 'COMPREHENSIVE' })
      .returning();
    const [created] = await testApp.db
      .insert(insurerProductVersions)
      .values({
        productId: product.id,
        versionNumber: 1,
        status: 'APPROVED',
        name: `${code} comprehensive`,
        coverType: 'COMPREHENSIVE',
        coverGuide: { planName: `${code} comprehensive` },
        inspectionRule: inspection === 'NONE' ? 'NOT_REQUIRED' : 'REQUIRED',
        inspectionTiming: inspection === 'NONE' ? null : 'BEFORE_QUOTATION',
        inspectionMethod: inspection === 'NONE' ? null : 'PHYSICAL',
        rateBps: 525,
        allowedDurations: ['Q4'],
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdByStaffId: insurer.staff.id,
      })
      .returning();
    return created;
  }

  /** A product-selection request with one chosen version, in the state the submit route leaves it. */
  async function chosen(
    insurer: BuiltInsurer,
    options: { inspection?: 'NONE' | 'BEFORE_QUOTATION'; replyDueAt?: Date } = {},
  ) {
    const customer = await buildCustomer(testApp.db);
    const productVersion = await version(insurer, options.inspection);
    const { quoteRequest } = await buildQuoteRequest(
      testApp.db,
      { customerId: customer.id, insurerIds: [insurer.insurer.id] },
      { model: 'PRODUCT_SELECTION' },
    );
    const inspectionFirst = options.inspection === 'BEFORE_QUOTATION';
    const [row] = await testApp.db
      .insert(quoteRequestProductVersions)
      .values({
        quoteRequestId: quoteRequest.id,
        productVersionId: productVersion.id,
        insurerId: insurer.insurer.id,
        productCode: productVersion.name,
        productVersionNumber: 1,
        productName: productVersion.name,
        coverType: 'COMPREHENSIVE',
        coverGuide: { planName: productVersion.name },
        inspectionRule: inspectionFirst ? 'REQUIRED' : 'NOT_REQUIRED',
        inspectionTiming: inspectionFirst ? 'BEFORE_QUOTATION' : null,
        inspectionMethod: inspectionFirst ? 'PHYSICAL' : null,
        status: inspectionFirst ? 'INSPECTION_REQUIRED' : 'SUBMITTED',
        pausedAt: inspectionFirst ? new Date() : null,
        replyDueAt: options.replyDueAt ?? new Date(Date.now() + 7 * DAY_MS),
      })
      .returning();
    return { customer, request: quoteRequest, productVersion, row };
  }

  const versionRow = async (id: string) =>
    (await testApp.db.select().from(quoteRequestProductVersions).where(eq(quoteRequestProductVersions.id, id)))[0];

  const customerView = async (customer: { email: string }, requestId: string) =>
    testApp.http.get(`/api/v1/quote-requests/${requestId}`).set(await signIn(testApp.http, customer));

  const sentTo = (customerId: string, key: string) =>
    testApp.db
      .select({ channel: notifications.channel, body: notifications.body })
      .from(notifications)
      .where(and(eq(notifications.customerId, customerId), eq(notifications.templateKey, key)))
      .orderBy(asc(notifications.channel));

  const quote = async (insurer: BuiltInsurer, requestId: string, productVersionId: string) =>
    insurerPost(insurer, `quote-requests/${requestId}/quote`, {
      productVersionId,
      premium: 500,
      documentId: (await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'QUOTATION' })).id,
    });

  describe('declining', () => {
    it('lists the approved reasons with their customer and internal wording', async () => {
      const insurer = await buildInsurer(testApp.db);
      const response = await insurerGet(insurer, 'decline-reasons');
      expect(response.status).toBe(200);
      expect(response.body.map((reason: { code: string }) => reason.code)).toEqual([
        'OUTSIDE_APPETITE',
        'VEHICLE_NOT_ELIGIBLE',
        'INFORMATION_NOT_PROVIDED',
        'INSPECTION_FAILED',
        'OTHER',
      ]);
    });

    it('declines with an approved reason; the customer sees only the customer wording, never the internal note', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { customer, request, productVersion, row } = await chosen(insurer);

      const unknown = await insurerPost(insurer, `quote-requests/${request.id}/products/${productVersion.id}/decline`, {
        reasonCode: 'TOO_LATE_ON_A_FRIDAY',
      });
      expect(unknown.status).toBe(400);
      expect((await versionRow(row.id)).status).toBe('SUBMITTED');

      const declined = await insurerPost(insurer, `quote-requests/${request.id}/products/${productVersion.id}/decline`, {
        reasonCode: 'VEHICLE_NOT_ELIGIBLE',
        customerNote: 'We only cover vehicles under 15 years old.',
        internalNote: 'Chassis mismatch on the white book; possible rebuild.',
      });
      expect(declined.status).toBe(200);
      expect(declined.body).toMatchObject({ status: 'DECLINED', decline: { reasonCode: 'VEHICLE_NOT_ELIGIBLE' } });
      expect(await versionRow(row.id)).toMatchObject({ status: 'DECLINED', declineReasonCode: 'VEHICLE_NOT_ELIGIBLE' });

      const view = await customerView(customer, request.id);
      expect(view.status).toBe(200);
      expect(view.body.selectedProducts[0]).toMatchObject({
        status: 'DECLINED',
        statusLabel: 'Declined',
        decline: {
          reason: "Your vehicle does not meet this product's eligibility rules.",
          note: 'We only cover vehicles under 15 years old.',
        },
      });
      const customerText = JSON.stringify(view.body);
      expect(customerText).not.toContain('Chassis mismatch');
      expect(customerText).not.toContain('eligibility rules (age');

      const told = await sentTo(customer.id, 'quote.version_declined');
      expect(told.map((message) => message.channel).sort()).toEqual(['EMAIL', 'IN_APP']);
      for (const message of told) {
        expect(message.body).toContain("Your vehicle does not meet this product's eligibility rules.");
        expect(message.body).not.toContain('Chassis mismatch');
      }

      const notes = await insurerGet(insurer, `quote-requests/${request.id}/products/${productVersion.id}/notes`);
      expect(notes.body).toEqual([
        expect.objectContaining({ body: 'Chassis mismatch on the white book; possible rebuild.', author: insurer.staff.fullName }),
      ]);

      const again = await insurerPost(insurer, `quote-requests/${request.id}/products/${productVersion.id}/decline`, {
        reasonCode: 'OTHER',
      });
      expect(again.body.code).toBe('ALREADY_DECLINED');
      expect((await quote(insurer, request.id, productVersion.id)).body.code).toBe('ALREADY_DECLINED');

      const history = await testApp.db
        .select({ fromStatus: stateHistory.fromStatus, toStatus: stateHistory.toStatus, actorType: stateHistory.actorType })
        .from(stateHistory)
        .where(and(eq(stateHistory.entityType, 'QUOTE_REQUEST_PRODUCT'), eq(stateHistory.entityId, row.id)));
      expect(history).toEqual([{ fromStatus: 'SUBMITTED', toStatus: 'DECLINED', actorType: 'INSURER' }]);
    });

    it("answers another insurer's product as absent and audits the reach", async () => {
      const owner = await buildInsurer(testApp.db);
      const prober = await buildInsurer(testApp.db);
      const { request, productVersion, row } = await chosen(owner);

      const response = await insurerPost(prober, `quote-requests/${request.id}/products/${productVersion.id}/decline`, {
        reasonCode: 'OTHER',
      });
      expect(response.status).toBe(404);
      expect((await versionRow(row.id)).status).toBe('SUBMITTED');
      const refused = await testApp.db
        .select({ actorId: auditLogs.actorId })
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.refused'), eq(auditLogs.entityId, request.id)));
      expect(refused).toEqual([{ actorId: prober.staff.id }]);
    });
  });

  describe('asking the customer for information', () => {
    it("stops the reply clock until the customer answers, then moves the due date on by the wait", async () => {
      const insurer = await buildInsurer(testApp.db);
      const dueAt = new Date(Date.now() + 3 * DAY_MS);
      const { customer, request, productVersion, row } = await chosen(insurer, { replyDueAt: dueAt });
      const path = `quote-requests/${request.id}/products/${productVersion.id}/information-requests`;

      const asked = await insurerPost(insurer, path, { message: 'Please send a photo of the odometer.', dueInDays: 3 });
      expect(asked.status).toBe(201);
      expect(asked.body).toMatchObject({ status: 'VERIFICATION_REQUIRED', informationRequest: { answer: null } });
      const paused = await versionRow(row.id);
      expect(paused.status).toBe('VERIFICATION_REQUIRED');
      expect(paused.pausedAt).not.toBeNull();

      const twice = await insurerPost(insurer, path, { message: 'And the licence too, please.', dueInDays: 3 });
      expect(twice.body.code).toBe('INFORMATION_ALREADY_REQUESTED');

      const told = await sentTo(customer.id, 'quote.information_requested');
      expect(told).toHaveLength(2);

      const shown = await customerView(customer, request.id);
      expect(shown.body.selectedProducts[0]).toMatchObject({
        status: 'VERIFICATION_REQUIRED',
        statusLabel: 'The insurer needs more information',
        informationRequests: [{ message: 'Please send a photo of the odometer.', open: true, answer: null }],
      });

      // Pretend the customer took two days, so the due date must move on by two days.
      const twoDaysAgo = new Date(Date.now() - 2 * DAY_MS);
      await testApp.db
        .update(quoteRequestProductVersions)
        .set({ pausedAt: twoDaysAgo })
        .where(eq(quoteRequestProductVersions.id, row.id));

      const stranger = await buildCustomer(testApp.db);
      const answerPath = `/api/v1/quote-requests/${request.id}/products/${productVersion.id}/information`;
      const foreign = await testApp.http
        .post(answerPath)
        .set(await signIn(testApp.http, stranger))
        .send({ answer: 'Not my request.' });
      expect(foreign.status).toBe(404);

      const answered = await testApp.http
        .post(answerPath)
        .set(await signIn(testApp.http, customer))
        .send({ answer: 'The odometer reads 84,200 km.' });
      expect(answered.status).toBe(200);
      expect(answered.body.selectedProducts[0]).toMatchObject({
        status: 'INSURER_PROCESSING',
        informationRequests: [{ answer: 'The odometer reads 84,200 km.', open: false }],
      });

      const resumed = await versionRow(row.id);
      expect(resumed.pausedAt).toBeNull();
      const moved = resumed.replyDueAt!.getTime() - dueAt.getTime();
      expect(moved).toBeGreaterThanOrEqual(2 * DAY_MS);
      expect(moved).toBeLessThan(2 * DAY_MS + 60_000);

      const again = await testApp.http
        .post(answerPath)
        .set(await signIn(testApp.http, customer))
        .send({ answer: 'Another answer.' });
      expect(again.body.code).toBe('NO_OPEN_QUESTION');

      const portalView = await insurerGet(insurer, 'quote-requests');
      const product = portalView.body.find((entry: { id: string }) => entry.id === request.id).selectedProducts[0];
      expect(product.workflow).toMatchObject({
        status: 'INSURER_PROCESSING',
        clockPausedAt: null,
        informationRequests: [{ answer: 'The odometer reads 84,200 km.' }],
      });
    });

    it('closes the open question unanswered when the insurer quotes anyway', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { request, productVersion, row } = await chosen(insurer);
      await insurerPost(insurer, `quote-requests/${request.id}/products/${productVersion.id}/information-requests`, {
        message: 'Is the vehicle used for business?',
        dueInDays: 2,
      });

      const quoted = await quote(insurer, request.id, productVersion.id);
      expect(quoted.status).toBe(201);
      expect(await versionRow(row.id)).toMatchObject({ status: 'QUOTED', pausedAt: null });
      const [question] = await testApp.db
        .select()
        .from(quoteInformationRequests)
        .where(eq(quoteInformationRequests.quoteRequestId, request.id));
      expect(question.closedAt).not.toBeNull();
      expect(question.answeredAt).toBeNull();
    });
  });

  describe('quoting', () => {
    it('refuses to quote a product whose rule needs an inspection before quotation', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { request, productVersion, row } = await chosen(insurer, { inspection: 'BEFORE_QUOTATION' });

      const response = await quote(insurer, request.id, productVersion.id);
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INSPECTION_REQUIRED');
      expect((await versionRow(row.id)).status).toBe('INSPECTION_REQUIRED');
    });

    it('refuses a quote once the reply deadline has passed, before the sweep has run', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { request, productVersion } = await chosen(insurer, { replyDueAt: new Date(Date.now() - HOUR_MS) });

      const response = await quote(insurer, request.id, productVersion.id);
      expect(response.body.code).toBe('REPLY_DEADLINE_PASSED');
    });

    it('records the move to QUOTED in the state history', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { request, productVersion, row } = await chosen(insurer);

      expect((await quote(insurer, request.id, productVersion.id)).status).toBe(201);
      const history = await testApp.db
        .select({ toStatus: stateHistory.toStatus })
        .from(stateHistory)
        .where(and(eq(stateHistory.entityType, 'QUOTE_REQUEST_PRODUCT'), eq(stateHistory.entityId, row.id)));
      expect(history).toEqual([{ toStatus: 'QUOTED' }]);
    });
  });

  describe('internal notes', () => {
    it('lets readers read and workers write, and never shows a note to the customer', async () => {
      const insurer = await buildInsurer(testApp.db);
      const compliance = await buildStaffUser(testApp.db, { role: 'COMPLIANCE_READ_ONLY', insurerId: insurer.insurer.id });
      const { customer, request, productVersion } = await chosen(insurer);
      const path = `quote-requests/${request.id}/products/${productVersion.id}/notes`;

      const written = await insurerPost(insurer, path, { body: 'Broker says the customer is shopping around.' });
      expect(written.status).toBe(201);
      expect(written.body).toMatchObject({ body: 'Broker says the customer is shopping around.', author: insurer.staff.fullName });

      const complianceHeaders = await portal(compliance);
      const read = await testApp.http.get(`/api/v1/insurer/${path}`).set(complianceHeaders);
      expect(read.status).toBe(200);
      expect(read.body).toHaveLength(1);
      const refused = await testApp.http.post(`/api/v1/insurer/${path}`).set(complianceHeaders).send({ body: 'No.' });
      expect(refused.status).toBe(403);

      const rival = await buildInsurer(testApp.db);
      expect((await insurerGet(rival, path)).status).toBe(404);

      const view = await customerView(customer, request.id);
      expect(JSON.stringify(view.body)).not.toContain('shopping around');
      const audit = await testApp.db
        .select({ note: auditLogs.note, after: auditLogs.after })
        .from(auditLogs)
        .where(eq(auditLogs.action, 'quote_note.added'));
      expect(JSON.stringify(audit)).not.toContain('shopping around');
    });
  });

  describe('the hourly sweep', () => {
    it('times out an unanswered product, leaves a paused one alone, and tells the customer', async () => {
      const insurer = await buildInsurer(testApp.db);
      const late = await chosen(insurer, { replyDueAt: new Date(Date.now() - HOUR_MS) });
      const waiting = await chosen(insurer, { replyDueAt: new Date(Date.now() - HOUR_MS) });
      await testApp.db
        .update(quoteRequestProductVersions)
        .set({ status: 'VERIFICATION_REQUIRED', pausedAt: new Date(Date.now() - 2 * HOUR_MS) })
        .where(eq(quoteRequestProductVersions.id, waiting.row.id));

      const workflow = testApp.app.get(QuoteWorkflowService);
      await workflow.timeOutDue(new Date());

      expect((await versionRow(late.row.id)).status).toBe('TIMED_OUT');
      expect((await versionRow(waiting.row.id)).status).toBe('VERIFICATION_REQUIRED');
      expect(await sentTo(late.customer.id, 'quote.version_timed_out')).toHaveLength(2);
      expect((await quote(insurer, late.request.id, late.productVersion.id)).body.code).toBe('REPLY_DEADLINE_PASSED');

      const view = await customerView(late.customer, late.request.id);
      expect(view.body.selectedProducts[0]).toMatchObject({
        status: 'TIMED_OUT',
        statusLabel: 'The insurer did not respond in time',
      });
    });

    it('expires an unpaid quote at its validity date and keeps a paid one', async () => {
      const insurer = await buildInsurer(testApp.db);
      const lapsed = new Date(Date.now() - HOUR_MS);
      const unpaid = await chosen(insurer);
      const paid = await chosen(insurer);
      for (const target of [unpaid, paid]) {
        const { quote: built } = await buildInsurerQuote(
          testApp.db,
          { quoteRequestId: target.request.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
          { productVersionId: target.productVersion.id, validUntil: lapsed },
        );
        await testApp.db
          .update(quoteRequestProductVersions)
          .set({ status: 'QUOTED' })
          .where(eq(quoteRequestProductVersions.id, target.row.id));
        await testApp.db.update(quoteRequests).set({ status: 'QUOTED' }).where(eq(quoteRequests.id, target.request.id));
        if (target === paid) {
          await buildPayment(
            testApp.db,
            { customerId: target.customer.id, quoteRequestId: target.request.id, insurerQuoteId: built.id },
            { status: 'CONFIRMED' },
          );
        }
      }

      const workflow = testApp.app.get(QuoteWorkflowService);
      await workflow.expireDue(new Date());

      expect((await versionRow(unpaid.row.id)).status).toBe('EXPIRED');
      expect((await versionRow(paid.row.id)).status).toBe('QUOTED');
      expect(await sentTo(unpaid.customer.id, 'quote.expired')).toHaveLength(2);
      expect(await sentTo(paid.customer.id, 'quote.expired')).toHaveLength(0);
    });
  });

  describe('decision 24', () => {
    it('cancels open and unpaid quoted products, keeps a paid one, and closes an open question', async () => {
      const insurer = await buildInsurer(testApp.db);
      const asking = await chosen(insurer);
      const unpaid = await chosen(insurer);
      const paid = await chosen(insurer);
      await insurerPost(insurer, `quote-requests/${asking.request.id}/products/${asking.productVersion.id}/information-requests`, {
        message: 'Which town is the vehicle kept in?',
        dueInDays: 2,
      });
      for (const target of [unpaid, paid]) {
        const { quote: built } = await buildInsurerQuote(
          testApp.db,
          { quoteRequestId: target.request.id, insurerId: insurer.insurer.id, staffId: insurer.staff.id },
          { productVersionId: target.productVersion.id },
        );
        await testApp.db
          .update(quoteRequestProductVersions)
          .set({ status: 'QUOTED' })
          .where(eq(quoteRequestProductVersions.id, target.row.id));
        if (target === paid) {
          await buildPayment(
            testApp.db,
            { customerId: target.customer.id, quoteRequestId: target.request.id, insurerQuoteId: built.id },
            { status: 'CONFIRMED' },
          );
        }
      }

      const suspendedAt = new Date();
      await testApp.db.transaction((tx) =>
        testApp.app.get(QuoteAvailabilityService).cancelForSuspendedInsurer(tx, {
          insurerId: insurer.insurer.id,
          insurerName: insurer.insurer.name,
          suspendedAt,
        }),
      );

      expect(await versionRow(asking.row.id)).toMatchObject({ status: 'CANCELLED', pausedAt: null, cancelledReason: 'INSURER_SUSPENDED' });
      expect(await versionRow(unpaid.row.id)).toMatchObject({ status: 'CANCELLED', cancelledReason: 'INSURER_SUSPENDED' });
      expect(await versionRow(paid.row.id)).toMatchObject({ status: 'QUOTED', cancelledReason: 'INSURER_SUSPENDED' });
      const [question] = await testApp.db
        .select()
        .from(quoteInformationRequests)
        .where(eq(quoteInformationRequests.quoteRequestId, asking.request.id));
      expect(question.closedAt).toEqual(suspendedAt);

      const answer = await testApp.http
        .post(`/api/v1/quote-requests/${asking.request.id}/products/${asking.productVersion.id}/information`)
        .set(await signIn(testApp.http, asking.customer))
        .send({ answer: 'Lusaka.' });
      expect(answer.body.code).toBe('NO_OPEN_QUESTION');
    });
  });

  describe('the queue', () => {
    const staffPost = async (staff: { email: string }, path: string, body: Record<string, unknown> = {}) =>
      testApp.http.post(`/api/v1/insurer/${path}`).set(await portal(staff)).send(body);
    const queueFor = async (staff: { email: string }, query = '') =>
      testApp.http.get(`/api/v1/insurer/queue${query}`).set(await portal(staff));

    it('lets an officer claim a product, which starts the work and makes them its owner', async () => {
      const insurer = await buildInsurer(testApp.db, { staff: { role: 'QUOTE_OFFICER' } });
      const colleague = await buildStaffUser(testApp.db, { role: 'QUOTE_OFFICER', insurerId: insurer.insurer.id });
      const { request, productVersion, row } = await chosen(insurer);
      const base = `quote-requests/${request.id}/products/${productVersion.id}`;

      const claimed = await staffPost(insurer.staff, `${base}/claim`);
      expect(claimed.status).toBe(200);
      expect(await versionRow(row.id)).toMatchObject({ status: 'INSURER_PROCESSING', assignedStaffId: insurer.staff.id });

      const taken = await staffPost(colleague, `${base}/claim`);
      expect(taken.body.code).toBe('ALREADY_ASSIGNED');

      // An officer cannot hand work to someone else or change its priority.
      expect((await staffPost(insurer.staff, `${base}/assign`, { staffId: colleague.id })).status).toBe(403);
      expect((await staffPost(insurer.staff, `${base}/priority`, { priority: 'HIGH' })).status).toBe(403);

      const mine = await queueFor(insurer.staff, '?owner=me');
      expect(mine.body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId)).toEqual([request.id]);
      expect(mine.body[0]).toMatchObject({
        status: 'INSURER_PROCESSING',
        owner: { id: insurer.staff.id },
        priority: 'NORMAL',
        sla: 'ON_TRACK',
      });
      expect((await queueFor(colleague, '?owner=me')).body).toEqual([]);
    });

    it("lets the administrator assign within the team, never to another insurer's staff", async () => {
      const insurer = await buildInsurer(testApp.db, { staff: { role: 'INSURER_ADMIN' } });
      const officer = await buildStaffUser(testApp.db, { role: 'QUOTE_OFFICER', insurerId: insurer.insurer.id });
      const claims = await buildStaffUser(testApp.db, { role: 'CLAIMS_OFFICER', insurerId: insurer.insurer.id });
      const rival = await buildInsurer(testApp.db);
      const { request, productVersion, row } = await chosen(insurer);
      const base = `quote-requests/${request.id}/products/${productVersion.id}`;

      expect((await staffPost(insurer.staff, `${base}/assign`, { staffId: rival.staff.id })).status).toBe(400);
      expect((await staffPost(insurer.staff, `${base}/assign`, { staffId: claims.id })).status).toBe(400);
      expect((await staffPost(insurer.staff, `${base}/assign`, { staffId: officer.id })).status).toBe(200);
      expect((await staffPost(insurer.staff, `${base}/priority`, { priority: 'HIGH' })).status).toBe(200);
      // Assigning does not start the work; the owner does.
      expect(await versionRow(row.id)).toMatchObject({ status: 'SUBMITTED', assignedStaffId: officer.id, priority: 'HIGH' });

      const high = await queueFor(insurer.staff, '?priority=HIGH');
      expect(high.body).toEqual([expect.objectContaining({ quoteRequestId: request.id, owner: { id: officer.id, name: officer.fullName } })]);
      expect((await queueFor(rival.staff)).body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId)).not.toContain(request.id);

      expect((await staffPost(insurer.staff, `${base}/assign`, { staffId: null })).status).toBe(200);
      expect((await versionRow(row.id)).assignedStaffId).toBeNull();
      const unassigned = await queueFor(insurer.staff, '?owner=unassigned');
      expect(unassigned.body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId)).toContain(request.id);
    });

    it('makes whoever first declines an unowned product its owner', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { request, productVersion, row } = await chosen(insurer);
      await insurerPost(insurer, `quote-requests/${request.id}/products/${productVersion.id}/decline`, { reasonCode: 'OTHER' });
      expect((await versionRow(row.id)).assignedStaffId).toBe(insurer.staff.id);
    });

    it('filters by deadline and searches by plate, and answers closed products as not in the queue', async () => {
      const insurer = await buildInsurer(testApp.db);
      const soon = await chosen(insurer, { replyDueAt: new Date(Date.now() + 2 * HOUR_MS) });
      const later = await chosen(insurer);
      const late = await chosen(insurer, { replyDueAt: new Date(Date.now() - HOUR_MS) });
      await insurerPost(insurer, `quote-requests/${later.request.id}/products/${later.productVersion.id}/decline`, { reasonCode: 'OTHER' });

      const all = await queueFor(insurer.staff);
      const ids = all.body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId);
      expect(ids).toEqual([late.request.id, soon.request.id]);
      expect((await queueFor(insurer.staff, '?sla=DUE_SOON')).body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId)).toEqual([soon.request.id]);
      expect((await queueFor(insurer.staff, '?sla=BREACHED')).body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId)).toEqual([late.request.id]);
      expect((await queueFor(insurer.staff, '?status=DECLINED')).body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId)).toEqual([later.request.id]);
      expect((await queueFor(insurer.staff, '?status=NOPE')).status).toBe(400);

      const plate = all.body.find((entry: { quoteRequestId: string }) => entry.quoteRequestId === soon.request.id).plateNumber;
      expect((await queueFor(insurer.staff, `?search=${encodeURIComponent(plate)}`)).body.map((entry: { quoteRequestId: string }) => entry.quoteRequestId)).toEqual([soon.request.id]);
      // A search is matched literally, so a LIKE wildcard finds nothing.
      expect((await queueFor(insurer.staff, '?search=%25')).body).toEqual([]);
    });

    it('warns the owner once when a reply is nearly due, or the administrators when nobody owns it', async () => {
      const insurer = await buildInsurer(testApp.db, { staff: { role: 'INSURER_ADMIN' } });
      const officer = await buildStaffUser(testApp.db, { role: 'QUOTE_OFFICER', insurerId: insurer.insurer.id });
      const owned = await chosen(insurer, { replyDueAt: new Date(Date.now() + 3 * HOUR_MS) });
      const unowned = await chosen(insurer, { replyDueAt: new Date(Date.now() + 5 * HOUR_MS) });
      const relaxed = await chosen(insurer, { replyDueAt: new Date(Date.now() + 5 * DAY_MS) });
      await testApp.db
        .update(quoteRequestProductVersions)
        .set({ assignedStaffId: officer.id, assignedAt: new Date() })
        .where(eq(quoteRequestProductVersions.id, owned.row.id));

      const workflow = testApp.app.get(QuoteWorkflowService);
      await workflow.warnDue(new Date());
      await workflow.warnDue(new Date());

      const sent = async (versionId: string) =>
        (await testApp.db.select({ key: jobs.key, payload: jobs.payload }).from(jobs).where(eq(jobs.kind, 'quote-workflow.staff-email')))
          .filter((job) => job.key.includes(versionId))
          .map((job) => (job.payload as { to: string }).to);
      expect(await sent(owned.row.id)).toEqual([officer.email]);
      expect(await sent(unowned.row.id)).toEqual([insurer.staff.email]);
      expect(await sent(relaxed.row.id)).toEqual([]);
      expect((await versionRow(owned.row.id)).slaWarnedAt).not.toBeNull();
      expect((await versionRow(relaxed.row.id)).slaWarnedAt).toBeNull();
    });
  });

  describe('quote content, withdrawal, replacement and the customer choice', () => {
    const product = (request: { id: string }, productVersion: { id: string }) =>
      `quote-requests/${request.id}/products/${productVersion.id}`;
    const quoteWith = async (insurer: BuiltInsurer, requestId: string, productVersionId: string, extra: Record<string, unknown> = {}) =>
      insurerPost(insurer, `quote-requests/${requestId}/quote`, {
        productVersionId,
        premium: 500,
        documentId: (await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'QUOTATION' })).id,
        ...extra,
      });
    const asCustomer = (customer: { email: string }) => signIn(testApp.http, customer);
    const pay = async (customer: { email: string }, requestId: string, insurerQuoteId: string) =>
      testApp.http
        .post('/api/v1/payments')
        .set(await asCustomer(customer))
        .set('Idempotency-Key', randomUUID())
        .send({ quoteRequestId: requestId, insurerQuoteId, amount: 500, method: 'Card' });

    it('checks the breakdown adds up and that add-ons are in the catalogue, then shows the content to the customer', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { customer, request, productVersion } = await chosen(insurer);

      const wrongSum = await quoteWith(insurer, request.id, productVersion.id, {
        components: [{ code: 'BASE', label: 'Base premium', amount: 400 }],
      });
      expect(wrongSum.status).toBe(400);
      expect(wrongSum.body.details).toHaveProperty('components');

      const unknownAddOn = await quoteWith(insurer, request.id, productVersion.id, {
        addOns: [{ code: 'JETPACK', price: 10, included: false }],
      });
      expect(unknownAddOn.status).toBe(400);
      expect(unknownAddOn.body.details).toHaveProperty('addOns');

      const sent = await quoteWith(insurer, request.id, productVersion.id, {
        components: [
          { code: 'BASE', label: 'Base premium', amount: 450 },
          { code: 'LEVY', label: 'Insurance levy', amount: 50 },
        ],
        excess: 2500,
        conditions: [
          { code: 'TRACKER', text: 'Fit a tracker within 14 days.', purchaseCritical: true },
          { code: 'GARAGE', text: 'Park in a locked garage at night.', purchaseCritical: false },
        ],
      });
      expect(sent.status).toBe(201);
      expect(sent.body).toMatchObject({ excess: 2500, components: [{ code: 'BASE', amount: 450 }, { code: 'LEVY', amount: 50 }] });

      const view = await customerView(customer, request.id);
      expect(view.body.productQuotes[0]).toMatchObject({
        premium: 500,
        excess: 2500,
        conditions: [
          { code: 'TRACKER', purchaseCritical: true },
          { code: 'GARAGE', purchaseCritical: false },
        ],
      });
      expect(view.body).toMatchObject({ progress: 'QUOTES_READY', progressLabel: 'Quotes are ready', selection: null });
    });

    it('needs the purchase-critical conditions accepted, by choosing the quote, before it can be paid', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { customer, request, productVersion } = await chosen(insurer);
      const sent = await quoteWith(insurer, request.id, productVersion.id, {
        conditions: [{ code: 'TRACKER', text: 'Fit a tracker within 14 days.', purchaseCritical: true }],
      });
      const [quote] = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.quoteRequestId, request.id));
      expect(sent.status).toBe(201);

      const unpaid = await pay(customer, request.id, quote.id);
      expect(unpaid.body).toMatchObject({ code: 'CONDITIONS_NOT_ACCEPTED', details: { missing: ['TRACKER'] } });

      const select = async (body: Record<string, unknown>) =>
        testApp.http.post(`/api/v1/quote-requests/${request.id}/selection`).set(await asCustomer(customer)).send(body);
      expect((await select({ insurerQuoteId: quote.id })).body.code).toBe('CONDITIONS_NOT_ACCEPTED');
      expect((await select({ insurerQuoteId: quote.id, acceptedConditionCodes: ['TRACKER', 'MADE_UP'] })).status).toBe(400);
      const chosenQuote = await select({ insurerQuoteId: quote.id, acceptedConditionCodes: ['TRACKER'] });
      expect(chosenQuote.status).toBe(200);
      expect(chosenQuote.body).toMatchObject({
        progress: 'QUOTE_SELECTED',
        selection: { insurerQuoteId: quote.id, acceptedConditionCodes: ['TRACKER'] },
      });

      // A chosen quote cannot be pulled from under the customer.
      const withdraw = await insurerPost(insurer, `${product(request, productVersion)}/quote/withdraw`, { reason: 'Mistake.' });
      expect(withdraw.body.code).toBe('QUOTE_SELECTED');

      expect((await pay(customer, request.id, quote.id)).status).toBe(201);
    });

    it('withdraws a quote back to work, after which the product can be quoted again', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { customer, request, productVersion, row } = await chosen(insurer);
      await quoteWith(insurer, request.id, productVersion.id);
      const [first] = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.quoteRequestId, request.id));

      const withdrawn = await insurerPost(insurer, `${product(request, productVersion)}/quote/withdraw`, { reason: 'Rated on the wrong use.' });
      expect(withdrawn.status).toBe(200);
      expect(await versionRow(row.id)).toMatchObject({ status: 'INSURER_PROCESSING' });
      expect((await customerView(customer, request.id)).body.productQuotes).toEqual([]);
      expect(await sentTo(customer.id, 'quote.withdrawn')).toHaveLength(2);
      expect((await pay(customer, request.id, first.id)).body.code).toBe('QUOTE_UNAVAILABLE');

      const again = await quoteWith(insurer, request.id, productVersion.id, { premium: 520 });
      expect(again.status).toBe(201);
      const statuses = await testApp.db
        .select({ status: insurerQuotes.status, premiumMinor: insurerQuotes.premiumMinor, withdrawnReason: insurerQuotes.withdrawnReason })
        .from(insurerQuotes)
        .where(eq(insurerQuotes.quoteRequestId, request.id))
        .orderBy(asc(insurerQuotes.sentAt));
      expect(statuses).toEqual([
        { status: 'WITHDRAWN', premiumMinor: 50_000, withdrawnReason: 'Rated on the wrong use.' },
        { status: 'ACTIVE', premiumMinor: 52_000, withdrawnReason: null },
      ]);
    });

    it('replaces a quote, keeping the old one as superseded history', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { customer, request, productVersion, row } = await chosen(insurer);
      await quoteWith(insurer, request.id, productVersion.id);

      const replaced = await insurerPost(insurer, `${product(request, productVersion)}/quote/replace`, {
        premium: 480,
        excess: 1000,
        documentId: (await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'QUOTATION' })).id,
      });
      expect(replaced.status).toBe(201);
      expect(replaced.body).toMatchObject({ premium: 480, excess: 1000 });
      expect((await versionRow(row.id)).status).toBe('QUOTED');

      const quotes = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.quoteRequestId, request.id));
      const current = quotes.find((quote) => quote.status === 'ACTIVE')!;
      const old = quotes.find((quote) => quote.status === 'SUPERSEDED')!;
      expect(old.supersededById).toBe(current.id);
      const view = await customerView(customer, request.id);
      expect(view.body.productQuotes.map((quote: { id: string; premium: number }) => [quote.id, quote.premium])).toEqual([[current.id, 480]]);
      expect(await sentTo(customer.id, 'quote.replaced')).toHaveLength(2);

      const noQuote = await insurerPost(insurer, `quote-requests/${request.id}/products/${randomUUID()}/quote/withdraw`, { reason: 'No.' });
      expect(noQuote.status).toBe(404);
    });

    it('offers only add-ons in the catalogue in force', async () => {
      const insurer = await buildInsurer(testApp.db);
      const { request, productVersion } = await chosen(insurer);
      const admin = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
      await testApp.db.insert(platformRuleVersions).values({
        key: 'ADD_ON_CATALOGUE',
        versionNumber: 9_000 + Math.floor(Math.random() * 1_000),
        state: 'CONFIRMED',
        value: { addOns: [{ code: 'ROADSIDE', label: 'Roadside assistance' }] },
        effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
        createdByStaffId: admin.id,
        confirmedByStaffId: admin.id,
        confirmedAt: new Date(),
      });
      const sent = await quoteWith(insurer, request.id, productVersion.id, {
        addOns: [{ code: 'ROADSIDE', price: 0, included: true }],
      });
      expect(sent.status).toBe(201);
      expect(sent.body.addOns).toEqual([{ code: 'ROADSIDE', label: 'Roadside assistance', price: 0, included: true, terms: null }]);
    });
  });
});
