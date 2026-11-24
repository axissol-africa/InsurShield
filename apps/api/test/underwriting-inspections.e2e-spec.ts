import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { QuoteAvailabilityService } from '../src/customer/quote-availability.service.js';
import { UnderwritingInspectionsService } from '../src/customer/underwriting-inspections.service.js';
import {
  auditLogs,
  inspections,
  insurerProductVersions,
  insurerProducts,
  insurerQuotes,
  notifications,
  quoteRequestProductVersions,
} from '../src/db/schema.js';
import { buildCustomer, buildDocument, buildInsurer, buildQuoteRequest, unique, type BuiltInsurer } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

type Timing = 'BEFORE_QUOTATION' | 'BEFORE_PAYMENT';
type Method = 'PHYSICAL' | 'SELF_CAPTURE';

describe('underwriting inspections', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const portal = (staff: { email: string }) => signIn(testApp.http, staff);
  const insurerPost = async (insurer: BuiltInsurer, path: string, body: Record<string, unknown> = {}) =>
    testApp.http.post(`/api/v1/insurer/${path}`).set(await portal(insurer.staff)).send(body);

  /**
   * A request whose chosen products have these inspection rules, submitted as
   * the API submits one: products in their starting states and the
   * inspection opened by the same service.
   */
  async function requestNeedingInspection(
    insurer: BuiltInsurer,
    rules: Array<{ timing: Timing; method: Method; reinspectionAllowed?: boolean }>,
  ) {
    const customer = await buildCustomer(testApp.db);
    const { quoteRequest } = await buildQuoteRequest(
      testApp.db,
      { customerId: customer.id, insurerIds: [insurer.insurer.id] },
      { model: 'PRODUCT_SELECTION' },
    );
    const versions: (typeof insurerProductVersions.$inferSelect)[] = [];
    for (const rule of rules) {
      const code = unique('UW');
      const [product] = await testApp.db
        .insert(insurerProducts)
        .values({ insurerId: insurer.insurer.id, code, coverType: 'COMPREHENSIVE' })
        .returning();
      const [version] = await testApp.db
        .insert(insurerProductVersions)
        .values({
          productId: product.id,
          versionNumber: 1,
          status: 'APPROVED',
          name: `${code} cover`,
          coverType: 'COMPREHENSIVE',
          coverGuide: { planName: code },
          inspectionRule: 'REQUIRED',
          inspectionTiming: rule.timing,
          inspectionMethod: rule.method,
          reinspectionAllowed: rule.reinspectionAllowed ?? false,
          rateBps: 525,
          allowedDurations: ['Q4'],
          effectiveFrom: new Date('2020-01-01T00:00:00.000Z'),
          createdByStaffId: insurer.staff.id,
        })
        .returning();
      await testApp.db.insert(quoteRequestProductVersions).values({
        quoteRequestId: quoteRequest.id,
        productVersionId: version.id,
        insurerId: insurer.insurer.id,
        productCode: code,
        productVersionNumber: 1,
        productName: `${code} cover`,
        coverType: 'COMPREHENSIVE',
        coverGuide: { planName: code },
        inspectionRule: 'REQUIRED',
        inspectionTiming: rule.timing,
        inspectionMethod: rule.method,
        status: 'SUBMITTED',
        replyDueAt: new Date(Date.now() + 5 * 24 * 3_600_000),
      });
      versions.push(version);
    }
    await testApp.db.transaction((tx) =>
      testApp.app.get(UnderwritingInspectionsService).openForRequest(
        tx,
        { id: quoteRequest.id, customerId: customer.id, vehiclePlate: 'BAZ 1301', vehicleLabel: '2020 Toyota Hilux', submittedAt: new Date() },
        versions.map((version, index) => ({
          productVersionId: version.id,
          insurerId: insurer.insurer.id,
          inspectionRule: 'REQUIRED' as const,
          inspectionTiming: rules[index].timing,
          inspectionMethod: rules[index].method,
        })),
        { type: 'CUSTOMER', id: customer.id },
      ),
    );
    const [inspection] = await testApp.db.select().from(inspections).where(eq(inspections.quoteRequestId, quoteRequest.id));
    return { customer, request: quoteRequest, versions, inspection };
  }

  const productStatus = async (requestId: string, productVersionId: string) =>
    (
      await testApp.db
        .select({ status: quoteRequestProductVersions.status, declineReasonCode: quoteRequestProductVersions.declineReasonCode })
        .from(quoteRequestProductVersions)
        .where(and(eq(quoteRequestProductVersions.quoteRequestId, requestId), eq(quoteRequestProductVersions.productVersionId, productVersionId)))
    )[0];
  const inspectionsOf = (requestId: string) => testApp.db.select().from(inspections).where(eq(inspections.quoteRequestId, requestId));
  const quote = async (insurer: BuiltInsurer, requestId: string, productVersionId: string) =>
    insurerPost(insurer, `quote-requests/${requestId}/quote`, {
      productVersionId,
      premium: 500,
      documentId: (await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'QUOTATION' })).id,
    });

  it('quotes a product without waiting for its inspection, and lets the insurer book, staff and pass it', async () => {
    const insurer = await buildInsurer(testApp.db);
    const { customer, request, versions, inspection } = await requestNeedingInspection(insurer, [
      { timing: 'BEFORE_QUOTATION', method: 'PHYSICAL' },
    ]);
    // Optional: the product is quoted straight away.
    expect((await quote(insurer, request.id, versions[0].id)).status).toBe(201);

    expect((await insurerPost(insurer, `inspections/${inspection.id}/approve`)).body.code).toBe('INSPECTION_NOT_READY');
    const booked = await insurerPost(insurer, `inspections/${inspection.id}/schedule`, {
      scheduledDate: '2026-12-01T09:00:00.000Z',
      location: 'Prestige office, Cairo Road',
    });
    expect(booked.body).toMatchObject({ status: 'SCHEDULED' });
    await insurerPost(insurer, `inspections/${inspection.id}/inspector`, { inspectorName: 'Bwalya Phiri', inspectorPhone: '+260971000000' });
    expect((await insurerPost(insurer, `inspections/${inspection.id}/approve`)).body).toMatchObject({ status: 'APPROVED', result: 'PASSED' });

    expect((await productStatus(request.id, versions[0].id)).status).toBe('QUOTED');

    const told = await testApp.db
      .select({ key: notifications.templateKey })
      .from(notifications)
      .where(and(eq(notifications.customerId, customer.id), eq(notifications.channel, 'IN_APP')));
    expect(told.map((message) => message.key).sort()).toEqual(['inspection.approved', 'inspection.scheduled', 'quote.ready']);

    const mine = await testApp.http.get('/api/v1/inspections').set(await signIn(testApp.http, customer));
    expect(mine.body[0]).toMatchObject({
      purpose: 'UNDERWRITING',
      method: 'PHYSICAL',
      stage: 'BEFORE_QUOTATION',
      status: 'Approved',
      inspectorName: 'Bwalya Phiri',
      result: 'PASSED',
      products: [{ productName: `${versions[0].name}`, passed: true }],
    });
    expect((await insurerPost(insurer, `inspections/${inspection.id}/fail`, { reason: 'Too late.' })).body.code).toBe('INSPECTION_CLOSED');
  });

  it('records a fail for the insurer to act on, without declining anything by itself', async () => {
    const insurer = await buildInsurer(testApp.db);
    const { request, versions, inspection } = await requestNeedingInspection(insurer, [
      { timing: 'BEFORE_QUOTATION', method: 'SELF_CAPTURE' },
      { timing: 'BEFORE_QUOTATION', method: 'SELF_CAPTURE', reinspectionAllowed: true },
    ]);

    // A self-capture inspection is decided from its photos, without booking.
    const failed = await insurerPost(insurer, `inspections/${inspection.id}/fail`, { reason: 'Rear bumper damage not declared.' });
    expect(failed.body).toMatchObject({ status: 'FAILED', result: 'FAILED' });

    expect((await productStatus(request.id, versions[0].id)).status).toBe('SUBMITTED');
    expect((await productStatus(request.id, versions[1].id)).status).toBe('SUBMITTED');
    expect(await inspectionsOf(request.id)).toHaveLength(1);
  });

  it('books a missed appointment again for the products still waiting', async () => {
    const insurer = await buildInsurer(testApp.db);
    const { request, inspection } = await requestNeedingInspection(insurer, [{ timing: 'BEFORE_QUOTATION', method: 'PHYSICAL' }]);
    await insurerPost(insurer, `inspections/${inspection.id}/schedule`, { scheduledDate: '2026-12-02T09:00:00.000Z' });
    expect((await insurerPost(insurer, `inspections/${inspection.id}/no-show`, { reason: 'Nobody came.' })).body.status).toBe('NO_SHOW');
    const all = await inspectionsOf(request.id);
    expect(all.map((entry) => [entry.status, entry.predecessorId])).toEqual(
      expect.arrayContaining([['NO_SHOW', null], ['REQUESTED', inspection.id]]),
    );
  });

  it('never holds up payment, whatever the inspection', async () => {
    const insurer = await buildInsurer(testApp.db);
    const { customer, request, versions } = await requestNeedingInspection(insurer, [{ timing: 'BEFORE_PAYMENT', method: 'SELF_CAPTURE' }]);
    expect((await quote(insurer, request.id, versions[0].id)).status).toBe(201);
    const [sent] = await testApp.db.select().from(insurerQuotes).where(eq(insurerQuotes.quoteRequestId, request.id));
    await testApp.http
      .post(`/api/v1/quote-requests/${request.id}/selection`)
      .set(await signIn(testApp.http, customer))
      .send({ insurerQuoteId: sent.id })
      .expect(200);
    const paid = await testApp.http
      .post('/api/v1/payments')
      .set(await signIn(testApp.http, customer))
      .set('Idempotency-Key', randomUUID())
      .send({ quoteRequestId: request.id, insurerQuoteId: sent.id, amount: 500, method: 'Card' });
    expect(paid.status).toBe(201);
  });

  it("answers another insurer's inspection as absent and audits the reach", async () => {
    const owner = await buildInsurer(testApp.db);
    const prober = await buildInsurer(testApp.db);
    const { inspection } = await requestNeedingInspection(owner, [{ timing: 'BEFORE_QUOTATION', method: 'PHYSICAL' }]);
    expect((await insurerPost(prober, `inspections/${inspection.id}/approve`)).status).toBe(404);
    const listed = await testApp.http.get('/api/v1/insurer/inspections').set(await portal(prober.staff));
    expect(listed.body.map((entry: { id: string }) => entry.id)).not.toContain(inspection.id);
    const refused = await testApp.db
      .select({ actorId: auditLogs.actorId })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'access.refused'), eq(auditLogs.entityId, inspection.id)));
    expect(refused).toEqual([{ actorId: prober.staff.id }]);
  });

  it('cancels a suspended insurer\'s open inspections and books none again', async () => {
    const insurer = await buildInsurer(testApp.db);
    const { request, inspection } = await requestNeedingInspection(insurer, [{ timing: 'BEFORE_QUOTATION', method: 'PHYSICAL' }]);
    await testApp.db.transaction((tx) =>
      testApp.app.get(QuoteAvailabilityService).cancelForSuspendedInsurer(tx, {
        insurerId: insurer.insurer.id,
        insurerName: insurer.insurer.name,
        suspendedAt: new Date(),
      }),
    );
    const all = await inspectionsOf(request.id);
    expect(all).toEqual([expect.objectContaining({ id: inspection.id, status: 'CANCELLED' })]);
  });
});
