import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { auditLogs, insurerEvidence, insurerProductVersions } from '../src/db/schema.js';
import { buildDocument, buildInsurer, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

const completeGuide = () => ({
  planName: 'Comprehensive Gold',
  summary: 'Everyday comprehensive cover for a private vehicle.',
  coveredItems: ['Third-party property damage', 'Accidental damage', 'Medical expenses up to ZMW 50,000'],
  exclusions: ['Driving without a valid licence'],
  notifyWithinDays: 7,
  howToNotify: 'Call the claims line, then submit the claim form within seven days.',
  documentsRequired: ['Claim form', 'Police report where applicable'],
  claimsContact: '+260 211 555 000 · claims@example.test',
  settlementTime: '14 working days after complete documents',
  territorialLimit: 'Zambia',
  ncdAccepted: true,
  quoteValidityDays: 14,
});

const draftBody = (overrides: Record<string, unknown> = {}) => ({
  code: `CMP-${randomUUID().slice(0, 8)}`,
  name: 'Comprehensive Gold',
  coverType: 'COMPREHENSIVE',
  coverGuide: completeGuide(),
  inspectionRule: 'NOT_REQUIRED',
  effectiveFrom: '2026-11-01',
  ...overrides,
});

describe('versioned insurer products', () => {
  let testApp: TestApp;
  let admin: Awaited<ReturnType<typeof buildStaffUser>>;
  let asAdmin: SessionHeaders;

  beforeAll(async () => {
    testApp = await startApp();
    admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    asAdmin = await signIn(testApp.http, admin);
  });

  afterAll(async () => testApp.close());

  async function insurerAdmin(overrides: Parameters<typeof buildInsurer>[1] = {}) {
    const built = await buildInsurer(testApp.db, { ...overrides, staff: { ...overrides.staff, role: 'INSURER_ADMIN' } });
    return { ...built, headers: await signIn(testApp.http, built.staff) };
  }

  async function verifyForTrading(insurer: Awaited<ReturnType<typeof insurerAdmin>>, expiresAt: Date | null = null) {
    const document = await buildDocument(testApp.db, { staffId: insurer.staff.id }, { kind: 'INSURER_EVIDENCE' });
    await testApp.db.insert(insurerEvidence).values({
      insurerId: insurer.insurer.id,
      kind: 'LICENCE',
      documentId: document.id,
      reference: 'LIC-2026-001',
      state: 'APPROVED',
      expiresAt,
    });
  }

  const create = (headers: SessionHeaders, body = draftBody()) =>
    testApp.http.post('/api/v1/insurer/products').set(headers).send(body);
  const submit = (headers: SessionHeaders, productId: string, versionId: string) =>
    testApp.http.post(`/api/v1/insurer/products/${productId}/versions/${versionId}/submit`).set(headers);
  const approve = (productId: string, versionId: string, body: Record<string, unknown> = {}) =>
    testApp.http.post(`/api/v1/admin/products/${productId}/versions/${versionId}/approve`).set(asAdmin).send(body);
  const reject = (productId: string, versionId: string, comment: string) =>
    testApp.http.post(`/api/v1/admin/products/${productId}/versions/${versionId}/reject`).set(asAdmin).send({ comment });

  it('requires a verified active insurer before it creates or submits a product draft', async () => {
    const insurer = await insurerAdmin();
    const blockedCreate = await create(insurer.headers).expect(409);
    expect(blockedCreate.body).toMatchObject({ code: 'INSURER_PRODUCT_EVIDENCE_BLOCKED' });

    await verifyForTrading(insurer);
    const created = await create(insurer.headers).expect(201);

    expect(created.body).toMatchObject({
      product: { code: expect.stringMatching(/^CMP-/) },
      status: 'DRAFT',
      versionNumber: 1,
      coverType: 'COMPREHENSIVE',
      inspection: { rule: 'NOT_REQUIRED', timing: null, method: null },
    });

    const submitted = await submit(insurer.headers, created.body.product.id, created.body.id).expect(200);
    expect(submitted.body).toMatchObject({ status: 'SUBMITTED', submittedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/) });

    const stored = await testApp.db
      .select()
      .from(insurerProductVersions)
      .where(eq(insurerProductVersions.id, created.body.id));
    expect(stored[0]).toMatchObject({ status: 'SUBMITTED', submittedByStaffId: insurer.staff.id });
  });

  it('publishes only an approved current version, and withdrawal removes it from the customer directory', async () => {
    const insurer = await insurerAdmin();
    await verifyForTrading(insurer);
    const created = await create(insurer.headers, draftBody({ code: `PUB-${randomUUID().slice(0, 8)}`, effectiveFrom: '2026-01-01' })).expect(201);
    await submit(insurer.headers, created.body.product.id, created.body.id).expect(200);

    const queued = await testApp.http.get('/api/v1/admin/products').set(asAdmin).expect(200);
    expect(queued.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ insurer: expect.objectContaining({ id: insurer.insurer.id }), status: 'SUBMITTED' }),
    ]));

    const approved = await approve(created.body.product.id, created.body.id, { comment: 'Terms checked.' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'APPROVED', reviewComment: 'Terms checked.' });
    const approvalAudit = await testApp.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, created.body.id), eq(auditLogs.action, 'product_version.approved')));
    expect(approvalAudit).toEqual([expect.objectContaining({ actorId: admin.id, note: 'Terms checked.' })]);

    const directory = await testApp.http.get('/api/v1/products/directory?coverType=COMPREHENSIVE').expect(200);
    const publicProduct = directory.body.find((item: { product: { id: string } }) => item.product.id === created.body.product.id);
    expect(publicProduct).toEqual({
      insurer: { id: insurer.insurer.id, name: insurer.insurer.name, tradingName: null, logoUrl: null },
      product: { id: created.body.product.id, code: created.body.product.code, coverType: 'COMPREHENSIVE' },
      version: expect.objectContaining({ id: created.body.id, number: 1, coverGuide: completeGuide() }),
    });
    expect(publicProduct).not.toHaveProperty('reviewedByStaffId');

    const future = await create(insurer.headers, draftBody({
      code: `FUTURE-${randomUUID().slice(0, 8)}`,
      effectiveFrom: '2099-01-01',
    })).expect(201);
    await submit(insurer.headers, future.body.product.id, future.body.id).expect(200);
    await approve(future.body.product.id, future.body.id).expect(200);
    const withoutFuture = await testApp.http.get('/api/v1/products/directory').expect(200);
    expect(withoutFuture.body.some((item: { product: { id: string } }) => item.product.id === future.body.product.id)).toBe(false);

    await testApp.http
      .post(`/api/v1/admin/products/${created.body.product.id}/versions/${created.body.id}/withdraw`)
      .set(asAdmin)
      .send({ reason: 'Superseded by revised terms.' })
      .expect(200);
    const afterWithdrawal = await testApp.http.get('/api/v1/products/directory').expect(200);
    expect(afterWithdrawal.body.some((item: { product: { id: string } }) => item.product.id === created.body.product.id)).toBe(false);
  });

  it('hides an approved product when its insurer is no longer compliant, and blocks new drafts with an expired licence', async () => {
    const insurer = await insurerAdmin();
    await verifyForTrading(insurer, new Date('2099-01-01T00:00:00.000Z'));
    const created = await create(insurer.headers, draftBody({ code: `COMPLY-${randomUUID().slice(0, 8)}`, effectiveFrom: '2026-01-01' })).expect(201);
    await submit(insurer.headers, created.body.product.id, created.body.id).expect(200);
    await approve(created.body.product.id, created.body.id).expect(200);

    const visible = await testApp.http.get('/api/v1/products/directory').expect(200);
    expect(visible.body.some((item: { product: { id: string } }) => item.product.id === created.body.product.id)).toBe(true);

    await testApp.db
      .update(insurerEvidence)
      .set({ expiresAt: new Date('2000-01-01T00:00:00.000Z') })
      .where(eq(insurerEvidence.insurerId, insurer.insurer.id));
    const hidden = await testApp.http.get('/api/v1/products/directory').expect(200);
    expect(hidden.body.some((item: { product: { id: string } }) => item.product.id === created.body.product.id)).toBe(false);

    const expiredLicence = await insurerAdmin({ insurer: { licenceExpiry: new Date('2000-01-01T00:00:00.000Z') } });
    await verifyForTrading(expiredLicence);
    const blocked = await create(expiredLicence.headers, draftBody({ code: `LAPSE-${randomUUID().slice(0, 8)}` })).expect(409);
    expect(blocked.body).toMatchObject({ code: 'INSURER_NOT_TRADING' });
  });

  it('keeps reviewed terms immutable and copies them into the next controlled draft', async () => {
    const insurer = await insurerAdmin();
    await verifyForTrading(insurer);
    const created = await create(insurer.headers, draftBody({ code: `REV-${randomUUID().slice(0, 8)}` })).expect(201);
    await submit(insurer.headers, created.body.product.id, created.body.id).expect(200);
    await approve(created.body.product.id, created.body.id).expect(200);

    const immutable = await testApp.http
      .patch(`/api/v1/insurer/products/${created.body.product.id}/versions/${created.body.id}`)
      .set(insurer.headers)
      .send({ name: 'Changed after approval' })
      .expect(409);
    expect(immutable.body).toMatchObject({ code: 'PRODUCT_VERSION_IMMUTABLE' });

    const revised = await testApp.http
      .post(`/api/v1/insurer/products/${created.body.product.id}/versions/${created.body.id}/revise`)
      .set(insurer.headers)
      .expect(201);
    expect(revised.body).toMatchObject({ status: 'DRAFT', versionNumber: 2, name: 'Comprehensive Gold' });

    await testApp.http
      .patch(`/api/v1/insurer/products/${created.body.product.id}/versions/${revised.body.id}`)
      .set(insurer.headers)
      .send({ name: 'Comprehensive Platinum' })
      .expect(200);
    const originals = await testApp.db
      .select({ id: insurerProductVersions.id, name: insurerProductVersions.name, status: insurerProductVersions.status })
      .from(insurerProductVersions)
      .where(eq(insurerProductVersions.productId, created.body.product.id));
    expect(originals).toEqual(expect.arrayContaining([
      { id: created.body.id, name: 'Comprehensive Gold', status: 'APPROVED' },
      { id: revised.body.id, name: 'Comprehensive Platinum', status: 'DRAFT' },
    ]));
  });

  it('records a rejection, preserves its review note, and allocates distinct drafts for concurrent revisions', async () => {
    const insurer = await insurerAdmin();
    await verifyForTrading(insurer);
    const created = await create(insurer.headers, draftBody({ code: `RETURN-${randomUUID().slice(0, 8)}` })).expect(201);
    await submit(insurer.headers, created.body.product.id, created.body.id).expect(200);
    const returned = await reject(created.body.product.id, created.body.id, 'Clarify the exclusions before publication.').expect(200);
    expect(returned.body).toMatchObject({ status: 'REJECTED', reviewComment: 'Clarify the exclusions before publication.' });

    const [first, second] = await Promise.all([
      testApp.http.post(`/api/v1/insurer/products/${created.body.product.id}/versions/${created.body.id}/revise`).set(insurer.headers).expect(201),
      testApp.http.post(`/api/v1/insurer/products/${created.body.product.id}/versions/${created.body.id}/revise`).set(insurer.headers).expect(201),
    ]);
    expect([first.body.versionNumber, second.body.versionNumber].sort((left, right) => left - right)).toEqual([2, 3]);

    const history = await testApp.http.get(`/api/v1/insurer/products/${created.body.product.id}`).set(insurer.headers).expect(200);
    expect(history.body.versions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.id, status: 'REJECTED', reviewComment: 'Clarify the exclusions before publication.' }),
      expect.objectContaining({ versionNumber: 2, status: 'DRAFT' }),
      expect.objectContaining({ versionNumber: 3, status: 'DRAFT' }),
    ]));
  });

  it('does not let another insurer read or update the product, and audits the attempted access', async () => {
    const owner = await insurerAdmin();
    const other = await insurerAdmin();
    await verifyForTrading(owner);
    const created = await create(owner.headers, draftBody({ code: `OWN-${randomUUID().slice(0, 8)}` })).expect(201);

    await testApp.http.get(`/api/v1/insurer/products/${created.body.product.id}`).set(other.headers).expect(404);
    await testApp.http
      .patch(`/api/v1/insurer/products/${created.body.product.id}/versions/${created.body.id}`)
      .set(other.headers)
      .send({ name: 'Not theirs' })
      .expect(404);

    const refusals = await testApp.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.entityId, created.body.product.id), eq(auditLogs.action, 'product.access_refused')));
    expect(refusals).toHaveLength(2);
    expect(refusals.every((row) => row.actorId === other.staff.id)).toBe(true);
  });

  it('rejects incomplete terms and invalid inspection or effective-date combinations before submission', async () => {
    const insurer = await insurerAdmin();
    const invalid = await create(insurer.headers, draftBody({
      coverGuide: { planName: 'Only a name' },
      inspectionRule: 'REQUIRED',
      effectiveFrom: '2026-12-31',
      effectiveUntil: '2026-01-01',
    })).expect(400);
    expect(invalid.body).toMatchObject({ code: 'PRODUCT_DRAFT_INVALID' });
    expect(invalid.body.details).toEqual(expect.objectContaining({
      inspection: expect.any(String),
      effectiveUntil: expect.any(String),
    }));

    await verifyForTrading(insurer);
    const incomplete = await create(insurer.headers, draftBody({
      code: `INCOMPLETE-${randomUUID().slice(0, 8)}`,
      coverGuide: { planName: 'A product still being written' },
    })).expect(201);
    const incompleteSubmit = await submit(insurer.headers, incomplete.body.product.id, incomplete.body.id).expect(400);
    expect(incompleteSubmit.body).toMatchObject({ code: 'PRODUCT_VERSION_INCOMPLETE' });

    const impossibleDate = await create(insurer.headers, draftBody({
      code: `DATE-${randomUUID().slice(0, 8)}`,
      effectiveFrom: '2026-02-30',
    })).expect(400);
    expect(impossibleDate.body).toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('returns the documented conflict for a duplicate product code', async () => {
    const insurer = await insurerAdmin();
    await verifyForTrading(insurer);
    const code = `DUP-${randomUUID().slice(0, 8)}`;
    await create(insurer.headers, draftBody({ code })).expect(201);
    const duplicate = await create(insurer.headers, draftBody({ code })).expect(409);
    expect(duplicate.body).toMatchObject({ code: 'PRODUCT_CODE_EXISTS' });
  });
});
