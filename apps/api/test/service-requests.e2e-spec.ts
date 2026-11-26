import { and, eq } from 'drizzle-orm';
import { auditLogs, insurers, jobs, notifications, paymentRefunds, policies, quoteRequests, reconciliationItems, serviceRequestUpdates, serviceRequests } from '../src/db/schema.js';
import { lusakaDay } from '../src/common/domain/lusaka.js';
import { ServiceRequestsService } from '../src/service-requests/service-requests.service.js';
import { buildCustomer, buildDocument, buildInsurer, buildPurchasedPolicy, buildQuoteRequest, buildStaffUser, type BuiltInsurer } from './builders.js';
import { holdLocks, openTestDatabase, queueBehind, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

const DAY_MS = 86_400_000;

describe('service requests', () => {
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

  type Party = { email: string };
  const as = async (party: Party) => {
    const session = await signIn(testApp.http, party);
    return {
      get: (path: string) => testApp.http.get(`/api/v1/${path}`).set(session),
      post: (path: string, body: Record<string, unknown> = {}) => testApp.http.post(`/api/v1/${path}`).set(session).send(body),
    };
  };

  /** A policy in force for a year from 30 days ago, paid 1,005 kwacha. */
  async function activePolicy(insurer?: BuiltInsurer) {
    const bought = await buildPurchasedPolicy(testApp.db, insurer ? { insurer } : {});
    const start = new Date(Date.now() - 30 * DAY_MS);
    await testApp.db
      .update(policies)
      .set({ status: 'ACTIVE', issuedAt: start, policyStartDate: start, policyEndDate: new Date(start.getTime() + 365 * DAY_MS) })
      .where(eq(policies.policyNumber, bought.policy.policyNumber));
    return bought;
  }
  const policyStatus = async (policyNumber: string) =>
    (await testApp.db.select({ status: policies.status }).from(policies).where(eq(policies.policyNumber, policyNumber)))[0].status;
  const toldCustomer = async (customerId: string) =>
    (
      await testApp.db
        .select({ key: notifications.templateKey })
        .from(notifications)
        .where(and(eq(notifications.customerId, customerId), eq(notifications.channel, 'IN_APP')))
    ).map((row) => row.key);
  const today = () => lusakaDay(new Date());

  describe('asking', () => {
    it('sends a request about a policy the customer holds, tells them, and emails the people who work it', async () => {
      const { customer, policy, insurer } = await activePolicy();
      const support = await buildStaffUser(testApp.db, { role: 'SUPPORT', insurerId: insurer.insurer.id });
      const finance = await buildStaffUser(testApp.db, { role: 'FINANCE', insurerId: insurer.insurer.id });
      const evidence = await buildDocument(testApp.db, { customerId: customer.id }, { kind: 'SERVICE_REQUEST_DOCUMENT' });

      const client = await as(customer);
      const body = {
        policyNumber: policy.policyNumber,
        type: 'DETAILS_CHANGE',
        reason: 'My phone number on the policy is wrong; it should be 0977 000 111.',
        documentIds: [evidence.id],
      };
      const sent = await client.post('service-requests', body).set('Idempotency-Key', 'same-service-request');
      const replay = await client.post('service-requests', body).set('Idempotency-Key', 'same-service-request');

      expect(sent.status).toBe(201);
      expect(replay.status).toBe(201);
      expect(replay.body.reference).toBe(sent.body.reference);
      expect(await testApp.db.select().from(serviceRequests).where(eq(serviceRequests.policyNumber, policy.policyNumber))).toHaveLength(1);
      expect(sent.body).toMatchObject({
        reference: expect.stringMatching(/^SR-/),
        policyNumber: policy.policyNumber,
        insurer: insurer.insurer.name,
        type: 'DETAILS_CHANGE',
        status: 'SUBMITTED',
        decision: null,
        nextAction: null,
      });
      expect(sent.body.updates).toEqual([
        expect.objectContaining({ author: 'CUSTOMER', statusFrom: null, statusTo: 'SUBMITTED', documents: [expect.objectContaining({ id: evidence.id })] }),
      ]);
      expect(await toldCustomer(customer.id)).toContain('service_request.submitted');
      const emails = await testApp.db.select({ payload: jobs.payload }).from(jobs).where(eq(jobs.kind, 'quote-workflow.staff-email'));
      const to = emails.map((job) => (job.payload as { to: string }).to);
      expect(to).toEqual(expect.arrayContaining([insurer.staff.email, support.email]));
      expect(to).not.toContain(finance.email);
    });

    it("answers another customer's policy as absent", async () => {
      const { policy } = await activePolicy();
      const stranger = await buildCustomer(testApp.db);
      const tried = await (await as(stranger)).post('service-requests', { policyNumber: policy.policyNumber, type: 'ASSISTANCE', reason: 'Help me with this policy please.' });
      expect(tried.status).toBe(404);
    });

    it('refuses a new request when its insurer is removed during submission', async () => {
      const { customer, policy, insurer } = await activePolicy();
      await testApp.db.update(policies).set({ policyEndDate: new Date(Date.now() - 20 * DAY_MS) })
        .where(eq(policies.policyNumber, policy.policyNumber));
      const client = await as(customer);
      const removal = await holdLocks(side.pool, async (db) => {
        await db.update(insurers).set({ status: 'DELETED', deletedAt: new Date() }).where(eq(insurers.id, insurer.insurer.id));
      });
      const [reply] = await queueBehind(removal, 'select % from "insurers" where % for share', 1, [async () =>
        client.post('service-requests', { policyNumber: policy.policyNumber, type: 'ASSISTANCE', reason: 'Please help with my existing policy.' }),
      ]);
      expect(reply.status).toBe(409);
      expect(reply.body).toMatchObject({ code: 'SERVICE_REQUEST_INSURER_UNAVAILABLE', details: { reference: policy.policyNumber } });
      expect(await testApp.db.select().from(serviceRequests).where(eq(serviceRequests.policyNumber, policy.policyNumber))).toEqual([]);
    });

    it('refuses a policy that is not in force, and a cancellation before the cover is issued', async () => {
      const issuing = await buildPurchasedPolicy(testApp.db);
      const customer = await as(issuing.customer);
      const cancel = await customer.post('service-requests', {
        policyNumber: issuing.policy.policyNumber,
        type: 'CANCELLATION',
        reason: 'I sold the car before the certificate came.',
        requestedEffectiveDate: today(),
      });
      expect(cancel.body.code).toBe('POLICY_NOT_ACTIVE');
      expect(
        (await customer.post('service-requests', { policyNumber: issuing.policy.policyNumber, type: 'ASSISTANCE', reason: 'When will my certificate arrive?' })).status,
      ).toBe(201);

      await testApp.db.update(policies).set({ status: 'CANCELLED', cancelledAt: new Date() }).where(eq(policies.policyNumber, issuing.policy.policyNumber));
      const ended = await customer.post('service-requests', { policyNumber: issuing.policy.policyNumber, type: 'ASSISTANCE', reason: 'Can I have my old policy back?' });
      expect(ended.body.code).toBe('POLICY_NOT_SERVICEABLE');
    });

    it('wants a reason, and a cancellation date inside the cover', async () => {
      const { customer, policy } = await activePolicy();
      const client = await as(customer);
      const short = await client.post('service-requests', { policyNumber: policy.policyNumber, type: 'ASSISTANCE', reason: 'Help' });
      const noDate = await client.post('service-requests', { policyNumber: policy.policyNumber, type: 'CANCELLATION', reason: 'I sold the vehicle last week.' });
      const past = await client.post('service-requests', {
        policyNumber: policy.policyNumber,
        type: 'CANCELLATION',
        reason: 'I sold the vehicle last week.',
        requestedEffectiveDate: lusakaDay(new Date(Date.now() - 2 * DAY_MS)),
      });
      const late = await client.post('service-requests', {
        policyNumber: policy.policyNumber,
        type: 'CANCELLATION',
        reason: 'I will sell the vehicle next year.',
        requestedEffectiveDate: lusakaDay(new Date(Date.now() + 400 * DAY_MS)),
      });
      const impossible = await client.post('service-requests', {
        policyNumber: policy.policyNumber,
        type: 'CANCELLATION',
        reason: 'I will sell the vehicle next year.',
        requestedEffectiveDate: '2099-02-30',
      });
      expect([short.status, noDate.status, past.status, late.status, impossible.status]).toEqual([400, 400, 400, 400, 400]);
      expect(impossible.body.message).toContain('valid date');
      expect(await testApp.db.select().from(serviceRequests).where(eq(serviceRequests.policyNumber, policy.policyNumber))).toEqual([]);
    });

    it('takes one cancellation of a policy at a time', async () => {
      const { customer, policy } = await activePolicy();
      const client = await as(customer);
      const body = { policyNumber: policy.policyNumber, type: 'CANCELLATION', reason: 'I sold the vehicle last week.', requestedEffectiveDate: today() };
      expect((await client.post('service-requests', body)).status).toBe(201);
      expect((await client.post('service-requests', body)).body.code).toBe('CANCELLATION_ALREADY_OPEN');
    });
  });

  describe('working a request', () => {
    async function submitted(type = 'DETAILS_CHANGE', extra: Record<string, unknown> = {}) {
      const bought = await activePolicy();
      const customer = await as(bought.customer);
      const sent = await customer.post('service-requests', {
        policyNumber: bought.policy.policyNumber,
        type,
        reason: 'Please change the colour on my policy to blue.',
        ...extra,
      });
      expect(sent.status).toBe(201);
      return { ...bought, customer, customerRow: bought.customer, reference: sent.body.reference as string, insurerClient: await as(bought.insurer.staff) };
    }

    it('reviews, asks, hears back, keeps an internal note to itself, and completes without touching the policy', async () => {
      const { customer, insurerClient, reference, policy, customerRow } = await submitted();

      expect((await insurerClient.post(`insurer/service-requests/${reference}/review`)).body.status).toBe('IN_REVIEW');
      const asked = await insurerClient.post(`insurer/service-requests/${reference}/information-requests`, { message: 'Send a photo of the vehicle showing its colour.' });
      expect(asked.body.status).toBe('INFORMATION_REQUIRED');
      expect((await customer.get(`service-requests/${reference}`)).body.nextAction).toBe('REPLY');
      expect(await toldCustomer(customerRow.id)).toContain('service_request.information_required');

      const photo = await buildDocument(testApp.db, { customerId: customerRow.id }, { kind: 'SERVICE_REQUEST_DOCUMENT' });
      const answered = await customer.post(`service-requests/${reference}/reply`, { message: 'Photo attached.', documentIds: [photo.id] });
      expect(answered.body.status).toBe('IN_REVIEW');

      const note = await insurerClient.post(`insurer/service-requests/${reference}/updates`, { message: 'Underwriter to confirm with the dealer.', visibleToCustomer: false });
      expect(note.body.status).toBe('IN_REVIEW');
      expect(note.body.updates.at(-1)).toMatchObject({ visibleToCustomer: false, authorName: expect.any(String) });

      const done = await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'The colour is now blue on your policy schedule.' });
      expect(done.body).toMatchObject({ status: 'COMPLETED', decision: { outcome: 'APPROVED' }, completedAt: expect.any(String) });
      expect(await policyStatus(policy.policyNumber)).toBe('ACTIVE');

      const mine = (await customer.get(`service-requests/${reference}`)).body;
      expect(mine.updates.map((update: { message: string }) => update.message)).not.toContain('Underwriter to confirm with the dealer.');
      expect(mine.updates.every((update: Record<string, unknown>) => !('authorName' in update) && !('visibleToCustomer' in update))).toBe(true);
      expect(mine.updates.at(-1)).toMatchObject({ author: 'INSURER', statusFrom: 'IN_REVIEW', statusTo: 'COMPLETED' });
      expect(await toldCustomer(customerRow.id)).toContain('service_request.completed');

      const history = await testApp.db.select().from(auditLogs).where(and(eq(auditLogs.entityType, 'SERVICE_REQUEST'), eq(auditLogs.entityId, reference)));
      expect(history.length).toBeGreaterThan(0);
    });

    it('refuses every action on a final request', async () => {
      const { customer, insurerClient, reference } = await submitted();
      const declined = await insurerClient.post(`insurer/service-requests/${reference}/decline`, { reason: 'We cannot change the colour without an inspection.' });
      expect(declined.body).toMatchObject({ status: 'DECLINED', decision: { outcome: 'DECLINED', note: 'We cannot change the colour without an inspection.' } });

      const answers = [
        await customer.post(`service-requests/${reference}/withdraw`),
        await customer.post(`service-requests/${reference}/reply`, { message: 'But please?' }),
        await insurerClient.post(`insurer/service-requests/${reference}/updates`, { message: 'Too late.', visibleToCustomer: true }),
        await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Done anyway.' }),
      ];
      expect(answers.map((answer) => answer.body.code)).toEqual(['SERVICE_REQUEST_CLOSED', 'SERVICE_REQUEST_CLOSED', 'SERVICE_REQUEST_CLOSED', 'SERVICE_REQUEST_CLOSED']);
    });

    it('refuses a move from the wrong step', async () => {
      const { customer, insurerClient, reference } = await submitted();
      expect((await customer.post(`service-requests/${reference}/reply`, { message: 'Nobody asked me yet.' })).body.code).toBe('SERVICE_REQUEST_WRONG_STEP');
      await insurerClient.post(`insurer/service-requests/${reference}/review`);
      expect((await insurerClient.post(`insurer/service-requests/${reference}/review`)).body.code).toBe('SERVICE_REQUEST_WRONG_STEP');
    });

    it('lets the customer withdraw an approved request before it is done', async () => {
      const { customer, insurerClient, reference } = await submitted();
      await insurerClient.post(`insurer/service-requests/${reference}/approve`, { note: 'We will update the schedule this week.' });
      expect((await customer.post(`service-requests/${reference}/withdraw`, { reason: 'I sorted it out at the branch.' })).body.status).toBe('WITHDRAWN');
      expect((await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Updated.' })).body.code).toBe('SERVICE_REQUEST_CLOSED');
    });

    it("answers another insurer's request as absent and audits the reach; a reader may read but not act", async () => {
      const { reference, insurer } = await submitted();
      const other = await buildInsurer(testApp.db);
      const otherClient = await as(other.staff);
      expect((await otherClient.get(`insurer/service-requests/${reference}`)).status).toBe(404);
      expect((await otherClient.post(`insurer/service-requests/${reference}/review`)).status).toBe(404);
      const refused = await testApp.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'access.refused'), eq(auditLogs.entityType, 'SERVICE_REQUEST'), eq(auditLogs.entityId, reference)));
      expect(refused).toHaveLength(2);
      expect((await otherClient.get('insurer/service-requests')).body.map((row: { reference: string }) => row.reference)).not.toContain(reference);

      const reader = await as(await buildStaffUser(testApp.db, { role: 'COMPLIANCE_READ_ONLY', insurerId: insurer.insurer.id }));
      expect((await reader.get(`insurer/service-requests/${reference}`)).status).toBe(200);
      expect((await reader.post(`insurer/service-requests/${reference}/review`)).status).toBe(403);
    });

    it("answers another customer's request as absent", async () => {
      const { reference } = await submitted();
      const stranger = await as(await buildCustomer(testApp.db));
      expect((await stranger.get(`service-requests/${reference}`)).status).toBe(404);
      expect((await stranger.post(`service-requests/${reference}/withdraw`)).status).toBe(404);
    });

    it('lets the customer download what the insurer sent them, never an internal attachment', async () => {
      const { customerRow, insurerClient, reference, insurer } = await submitted('DOCUMENT_REPLACEMENT');
      const certificate = await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'SERVICE_REQUEST_DOCUMENT' });
      const internal = await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'SERVICE_REQUEST_DOCUMENT' });
      await insurerClient.post(`insurer/service-requests/${reference}/updates`, { message: 'Checked against our copy.', visibleToCustomer: false, documentIds: [internal.id] });
      await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Your replacement certificate is attached.', documentIds: [certificate.id] });

      const customer = await as(customerRow);
      expect((await customer.get(`documents/${certificate.id}`)).status).toBe(200);
      expect((await customer.get(`documents/${internal.id}`)).status).toBe(404);
    });
  });

  describe('cancelling', () => {
    async function cancellation(requestedEffectiveDate = today()) {
      const bought = await activePolicy();
      const customer = await as(bought.customer);
      const sent = await customer.post('service-requests', {
        policyNumber: bought.policy.policyNumber,
        type: 'CANCELLATION',
        reason: 'I sold the vehicle and no longer need cover.',
        requestedEffectiveDate,
      });
      return { ...bought, reference: sent.body.reference as string, insurerClient: await as(bought.insurer.staff) };
    }
    const itemsOf = (policyNumber: string) => testApp.db.select().from(reconciliationItems).where(eq(reconciliationItems.policyNumber, policyNumber));

    it('needs the refund and the end date, and no more than is left of the payment', async () => {
      const { reference, insurerClient, payment, insurer } = await cancellation();
      expect((await insurerClient.post(`insurer/service-requests/${reference}/approve`, { note: 'Approved.' })).status).toBe(400);
      expect((await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Cancelled.' })).body.code).toBe('APPROVE_FIRST');
      const older = await insurerClient.post(`insurer/service-requests/${reference}/approve`, {
        note: 'Approved.', refundAmount: 10, effectiveDate: lusakaDay(new Date(Date.now() - DAY_MS)),
      });
      expect([older.status, older.body.code]).toEqual([400, 'VALIDATION_FAILED']);
      const finance = await buildStaffUser(testApp.db, { role: 'FINANCE', insurerId: insurer.insurer.id });
      const service = testApp.app.get(ServiceRequestsService);
      await expect(service.approve({
        kind: 'staff', id: finance.id, email: finance.email, role: finance.role, insurerId: finance.insurerId,
      }, reference, { note: 'Approved.', refundAmount: 10, effectiveDate: today() })).rejects.toMatchObject({ status: 403 });
      const tooMuch = await insurerClient.post(`insurer/service-requests/${reference}/approve`, {
        note: 'Approved.',
        refundAmount: payment.amountMinor / 100 + 1,
        effectiveDate: today(),
      });
      expect(tooMuch.body.code).toBe('REFUND_TOO_LARGE');
    });

    it('cancels the policy only when completed, and opens one refund item for the amount the insurer stated', async () => {
      const { reference, insurerClient, policy, payment, insurer, customer } = await cancellation();
      const approved = await insurerClient.post(`insurer/service-requests/${reference}/approve`, {
        note: 'Cancelled from today, pro rata.',
        refundAmount: 50.25,
        effectiveDate: today(),
      });
      expect(approved.body).toMatchObject({ status: 'APPROVED', decision: { outcome: 'APPROVED', refundAmount: 50.25, effectiveDate: today() } });
      expect(await policyStatus(policy.policyNumber)).toBe('ACTIVE');
      expect(await itemsOf(policy.policyNumber)).toEqual([]);

      const done = await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Your cover has ended.' });

      expect(done.body.status).toBe('COMPLETED');
      expect(await policyStatus(policy.policyNumber)).toBe('CANCELLED');
      const items = await itemsOf(policy.policyNumber);
      expect(items).toEqual([
        expect.objectContaining({ kind: 'REFUND_REQUIRED', status: 'OPEN', paymentId: payment.id, insurerId: insurer.insurer.id, amountMinor: 5025, reason: expect.stringContaining('refunds ZMW 50.25.') }),
      ]);
      expect(done.body.reconciliationItemId).toBe(items[0].id);
      expect(await toldCustomer(customer.id)).toEqual(expect.arrayContaining(['service_request.approved', 'service_request.completed']));
    });

    it('opens nothing when no refund is due', async () => {
      const { reference, insurerClient, policy } = await cancellation();
      await insurerClient.post(`insurer/service-requests/${reference}/approve`, { note: 'Nothing is refundable this late.', refundAmount: 0, effectiveDate: today() });
      await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Your cover has ended.' });
      expect(await policyStatus(policy.policyNumber)).toBe('CANCELLED');
      expect(await itemsOf(policy.policyNumber)).toEqual([]);
    });

    it('leaves the policy in force if a later refund has reduced the balance below the approved amount', async () => {
      const { reference, insurerClient, payment, policy } = await cancellation();
      const approved = await insurerClient.post(`insurer/service-requests/${reference}/approve`, {
        note: 'Refund approved.', refundAmount: 100, effectiveDate: today(),
      });
      expect(approved.body.status).toBe('APPROVED');
      const admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
      await testApp.db.insert(paymentRefunds).values({
        paymentId: payment.id, amountMinor: payment.amountMinor - 5000, status: 'COMPLETED',
        reasonCode: 'OTHER', reason: 'Separate refund completed after cancellation approval.',
        provider: 'STAND_IN', proposedByStaffId: admin.id, completedAt: new Date(),
      });
      const done = await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Cover has ended.' });
      expect([done.status, done.body.code]).toEqual([409, 'REFUND_TOO_LARGE']);
      expect(await policyStatus(policy.policyNumber)).toBe('ACTIVE');
      expect(await itemsOf(policy.policyNumber)).toEqual([]);
    });

    it('waits for the end date before it cancels', async () => {
      const later = lusakaDay(new Date(Date.now() + 10 * DAY_MS));
      const { reference, insurerClient, policy } = await cancellation(later);
      await insurerClient.post(`insurer/service-requests/${reference}/approve`, { note: 'Ends on the day you asked.', refundAmount: 10, effectiveDate: later });
      expect((await insurerClient.post(`insurer/service-requests/${reference}/complete`, { note: 'Cancelled.' })).body.code).toBe('CANCELLATION_NOT_DUE');
      expect(await policyStatus(policy.policyNumber)).toBe('ACTIVE');
    });

    it('refuses a refund and end date on anything but a cancellation', async () => {
      const bought = await activePolicy();
      const sent = await (await as(bought.customer)).post('service-requests', { policyNumber: bought.policy.policyNumber, type: 'ASSISTANCE', reason: 'Please explain my excess.' });
      const answer = await (await as(bought.insurer.staff)).post(`insurer/service-requests/${sent.body.reference}/approve`, { note: 'Sure.', refundAmount: 10 });
      expect(answer.status).toBe(400);
    });
  });

  it('keeps what was said, never rewritten', async () => {
    const bought = await activePolicy();
    const sent = await (await as(bought.customer)).post('service-requests', { policyNumber: bought.policy.policyNumber, type: 'ASSISTANCE', reason: 'Please explain my excess.' });
    await expect(
      side.db.update(serviceRequestUpdates).set({ message: 'Something else.' }).where(eq(serviceRequestUpdates.reference, sent.body.reference)),
    ).rejects.toThrow();
  });

  describe('InsurShield and the help desk', () => {
    it('lets an administrator read any request, and nobody else', async () => {
      const bought = await activePolicy();
      const sent = await (await as(bought.customer)).post('service-requests', { policyNumber: bought.policy.policyNumber, type: 'ASSISTANCE', reason: 'Please explain my excess.' });
      const admin = await as(await buildStaffUser(testApp.db, { role: 'ADMIN' }));
      expect((await admin.get(`admin/service-requests/${sent.body.reference}`)).body).toMatchObject({ reference: sent.body.reference, customer: { fullName: expect.any(String) } });
      expect((await admin.get('admin/service-requests')).body.map((row: { reference: string }) => row.reference)).toContain(sent.body.reference);
      expect((await (await as(bought.insurer.staff)).get('admin/service-requests')).status).toBe(403);
    });

    it('gives the customer the help desk and the references to quote', async () => {
      const bought = await activePolicy();
      const customer = await as(bought.customer);
      const sent = await customer.post('service-requests', { policyNumber: bought.policy.policyNumber, type: 'ASSISTANCE', reason: 'Please explain my excess.' });
      const owned = { customerId: bought.customer.id, insurerIds: [bought.insurer.insurer.id] };
      const live = await buildQuoteRequest(testApp.db, owned, { expiresAt: new Date(Date.now() + DAY_MS) });
      const expired = await buildQuoteRequest(testApp.db, owned, { expiresAt: new Date(Date.now() - DAY_MS) });
      await testApp.db.update(quoteRequests).set({ status: 'QUOTED', expiresAt: new Date(Date.now() + DAY_MS) })
        .where(eq(quoteRequests.id, bought.quoteRequest.id));
      const contact = await customer.get('support/contact');
      expect(contact.status).toBe(200);
      expect(Object.keys(contact.body.helpDesk).sort()).toEqual(['email', 'hours', 'phone']);
      const references = contact.body.references.map((entry: { reference: string }) => entry.reference);
      expect(references).toEqual(expect.arrayContaining([sent.body.reference, bought.policy.policyNumber, live.quoteRequest.id]));
      expect(references).not.toContain(expired.quoteRequest.id);
      expect(references).not.toContain(bought.quoteRequest.id);
    });

    it('finds a record by its reference for an administrator, and audits who looked and why', async () => {
      const bought = await activePolicy();
      const staff = await buildStaffUser(testApp.db, { role: 'ADMIN' });
      const admin = await as(staff);
      expect((await admin.get(`admin/records/${bought.policy.policyNumber}`)).status).toBe(400);
      const found = await admin.get(`admin/records/${bought.policy.policyNumber}?reason=${encodeURIComponent('Ticket 4411: customer asks about cover')}`);
      expect(found.body).toEqual([
        expect.objectContaining({ type: 'POLICY', reference: bought.policy.policyNumber, status: 'ACTIVE', customer: expect.objectContaining({ id: bought.customer.id }), insurer: bought.insurer.insurer.name }),
      ]);
      const looked = await testApp.db.select().from(auditLogs).where(and(eq(auditLogs.action, 'support.record_lookup'), eq(auditLogs.entityId, bought.policy.policyNumber)));
      expect(looked).toEqual([expect.objectContaining({ actorId: staff.id, note: 'Ticket 4411: customer asks about cover' })]);
      expect((await (await as(bought.customer)).get(`admin/records/${bought.policy.policyNumber}?reason=curious`)).status).toBe(403);
    });
  });
});
