import { and, eq } from 'drizzle-orm';
import { inspectionPhotos, inspectionReports, inspectionShots, inspections, notifications } from '../src/db/schema.js';
import { buildClaim, buildCustomer, buildDocument, buildInsurer, buildInspection, buildPurchasedPolicy, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

describe('later inspections', () => {
  let app: TestApp;
  beforeAll(async () => { app = await startApp(); });
  afterAll(async () => { await app?.close(); });

  async function fixture() {
    const buyer = await buildPurchasedPolicy(app.db);
    const dayBefore = new Date('2026-06-01T09:00:00Z');
    const incidentDate = new Date('2026-06-02T09:00:00Z');
    const claim = await buildClaim(app.db, {
      customerId: buyer.customer.id, insurerId: buyer.insurer.insurer.id, policyNumber: buyer.policy.policyNumber,
    }, { status: 'UNDER_REVIEW', incidentDate });
    const claimsOfficer = await buildStaffUser(app.db, { role: 'CLAIMS_OFFICER', insurerId: buyer.insurer.insurer.id });
    const quoteOfficer = await buildStaffUser(app.db, { role: 'QUOTE_OFFICER', insurerId: buyer.insurer.insurer.id });
    const owner = await signIn(app.http, buyer.customer);
    const staff = await signIn(app.http, claimsOfficer);
    return { ...buyer, claim, claimsOfficer, quoteOfficer, owner, staff, dayBefore, incidentDate };
  }

  it('opens one inspection per claim across retries and takes its vehicle and owner from the owned policy', async () => {
    const f = await fixture();
    const path = `/api/v1/insurer/claims/${f.claim.claimNumber}/inspection`;
    const foreign = await buildInsurer(app.db);
    await app.http.post(path).set(await signIn(app.http, foreign.staff)).send({ method: 'PHYSICAL' }).expect(404);
    await app.http.post(path).set(await signIn(app.http, f.quoteOfficer)).send({ method: 'PHYSICAL' }).expect(403);
    const open = () => app.http.post(path).set(f.staff).send({ method: 'PHYSICAL' });
    const replies = await Promise.all([open(), open()]);
    expect(replies.map((reply) => reply.status)).toEqual([201, 201]);
    expect(replies[0].body).toEqual(replies[1].body);
    const rows = await app.db.select().from(inspections).where(eq(inspections.claimNumber, f.claim.claimNumber));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ purpose: 'CLAIM_ASSESSMENT', policyNumber: f.policy.policyNumber, customerId: f.customer.id, insurerId: f.insurer.insurer.id });
    const detail = await app.http.get(`/api/v1/claims/${f.claim.claimNumber}/timeline`).set(f.owner).expect(200);
    expect(detail.body.inspection).toEqual({ id: rows[0].id, method: 'PHYSICAL', status: 'Requested' });
    const decision = await app.http.post(`/api/v1/insurer/claims/${f.claim.claimNumber}/updates`).set(f.staff)
      .send({ action: 'APPROVE', message: 'Assessment accepted.', expectedRevision: detail.body.revision }).expect(409);
    expect(decision.body.code).toBe('CLAIM_INSPECTION_OPEN');
    const notices = await app.db.select().from(notifications).where(and(eq(notifications.customerId, f.customer.id),
      eq(notifications.templateKey, 'inspection.required')));
    expect(notices.map((entry) => entry.channel).sort((a, b) => a.localeCompare(b))).toEqual(['EMAIL', 'IN_APP']);
    const other = await buildCustomer(app.db);
    const foreignList = await app.http.get('/api/v1/inspections').set(await signIn(app.http, other)).expect(200);
    expect(foreignList.body.some((row: { id: string }) => row.id === rows[0].id)).toBe(false);
  });

  it('requires clean JPEG or PNG evidence in each permitted self-capture slot before publishing', async () => {
    const f = await fixture();
    const open = await app.http.post(`/api/v1/insurer/claims/${f.claim.claimNumber}/inspection`).set(f.staff)
      .send({ method: 'SELF_CAPTURE' }).expect(201);
    const root = `/api/v1/insurer/inspections/${open.body.id}`;
    const report = await buildDocument(app.db, { staffId: f.claimsOfficer.id }, { kind: 'CLAIM_ATTACHMENT', mimeType: 'application/pdf' });
    await app.http.post(root + '/approve').set(f.staff).expect(409);
    const missing = await app.http.post(root + '/report').set(f.staff).send({ documentId: report.id }).expect(409);
    expect(missing.body.code).toBe('INSPECTION_EVIDENCE_INCOMPLETE');
    const photoPath = `/api/v1/inspections/${open.body.id}/evidence`;
    await app.http.post(photoPath).set(f.owner).send({ photos: [{ slot: 'front', documentId: report.id },
      { slot: 'front', documentId: report.id }] }).expect(400);
    const pdf = await buildDocument(app.db, { customerId: f.customer.id }, { kind: 'CLAIM_ATTACHMENT', mimeType: 'application/pdf' });
    await app.http.post(photoPath).set(f.owner).send({ photos: [{ slot: 'front', documentId: pdf.id }] }).expect(409);
    const photos = [];
    for (const slot of ['front', 'rear', 'left', 'right', 'dashboard', 'engine_bay']) {
      const doc = await buildDocument(app.db, { customerId: f.customer.id }, { kind: 'CLAIM_ATTACHMENT', mimeType: 'image/jpeg' });
      photos.push({ slot, documentId: doc.id });
    }
    await app.http.post(photoPath).set(f.owner).send({ photos }).expect(200);
    await app.http.post(root + '/report').set(f.staff).send({ documentId: report.id }).expect(201);
    await app.http.post(root + '/approve').set(f.staff).expect(200);
    const timeline = await app.http.get(`/api/v1/claims/${f.claim.claimNumber}/timeline`).set(f.owner).expect(200);
    await app.http.post(`/api/v1/insurer/claims/${f.claim.claimNumber}/updates`).set(f.staff)
      .send({ action: 'APPROVE', message: 'Assessment accepted.', expectedRevision: timeline.body.revision }).expect(200);
  });

  it('keeps pre-loss and post-loss records separate and retains published evidence across a later attempt', async () => {
    const f = await fixture();
    const quoteRequestId = f.policy.quoteRequestId;
    if (!quoteRequestId) throw new Error('Expected the policy to have a quote');
    const before = await buildDocument(app.db, { customerId: f.customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg', uploadedAt: f.dayBefore });
    const sameDay = await buildDocument(app.db, { customerId: f.customer.id }, { kind: 'INSPECTION_PHOTO', mimeType: 'image/jpeg', uploadedAt: f.incidentDate });
    await app.db.insert(inspectionShots).values([
      { quoteRequestId, shotKey: 'front', documentId: before.id, capturedAt: f.dayBefore },
      { quoteRequestId, shotKey: 'rear', documentId: sameDay.id, capturedAt: f.incidentDate },
    ]);
    const paid = await buildInspection(app.db, { customerId: f.customer.id, insurerId: f.insurer.insurer.id }, {
      purpose: 'AFTER_PAYMENT', method: 'PHYSICAL', stage: 'AFTER_PAYMENT', policyNumber: f.policy.policyNumber,
      status: 'APPROVED', result: 'PASSED', decidedAt: f.dayBefore,
    });
    const priorReportDoc = await buildDocument(app.db, { staffId: f.insurer.staff.id },
      { kind: 'INSPECTION_REPORT', uploadedAt: f.dayBefore });
    await app.db.insert(inspectionReports).values({ inspectionId: paid.id, documentId: priorReportDoc.id });
    const created = await app.http.post(`/api/v1/insurer/claims/${f.claim.claimNumber}/inspection`).set(f.staff)
      .send({ method: 'PHYSICAL' }).expect(201);
    const id = created.body.id as string;
    const evidencePath = `/api/v1/insurer/inspections/${id}/evidence`;
    const customerEvidence = `/api/v1/inspections/${id}/evidence`;
    const photo = await buildDocument(app.db, { customerId: f.customer.id }, { kind: 'CLAIM_ATTACHMENT', mimeType: 'image/jpeg' });
    const report = await buildDocument(app.db, { staffId: f.claimsOfficer.id }, { kind: 'CLAIM_ATTACHMENT' });
    const other = await buildCustomer(app.db);
    await app.http.post(customerEvidence).set(await signIn(app.http, other)).send({ photos: [{ slot: 'front', documentId: photo.id }] }).expect(404);
    await app.http.get(evidencePath).set(await signIn(app.http, f.quoteOfficer)).expect(404);
    await app.http.post(customerEvidence).set(f.owner).send({ photos: [{ slot: 'front', documentId: photo.id }] }).expect(200);
    await app.http.post(customerEvidence).set(f.owner).send({ photos: [{ slot: 'front', documentId: photo.id }] }).expect(200);

    const schedule = `/api/v1/insurer/inspections/${id}/schedule`;
    await app.http.post(schedule).set(f.staff).send({ scheduledDate: '2027-02-28T09:00:00Z', location: 'Lusaka' }).expect(200);
    const reportPath = `/api/v1/insurer/inspections/${id}/report`;
    await app.http.post(reportPath).set(f.staff).send({ documentId: report.id }).expect(201);
    await app.http.post(reportPath).set(f.staff).send({ documentId: report.id }).expect(201);
    await app.http.post(customerEvidence).set(f.owner).send({ photos: [{ slot: 'rear', documentId: sameDay.id }] }).expect(409);
    const grouped = await app.http.get(evidencePath).set(f.staff).expect(200);
    expect(grouped.body).toMatchObject({ preLoss: [{ slot: 'front', document: { id: before.id } },
      { slot: 'report', document: { id: priorReportDoc.id }, reference: paid.id }],
      postLoss: [{ slot: 'front', document: { id: photo.id } }], report: { id: report.id } });
    await app.http.post(`/api/v1/insurer/inspections/${id}/fail`).set(f.staff).send({ reason: 'The door needs a closer inspection.' }).expect(200);
    const follow = `/api/v1/insurer/inspections/${id}/reinspect`;
    const next = await app.http.post(follow).set(f.staff).expect(201);
    await app.http.post(follow).set(f.staff).expect(201).expect(next.body);
    expect(next.body.id).not.toEqual(id);
    const replacement = await buildDocument(app.db, { customerId: f.customer.id }, { kind: 'CLAIM_ATTACHMENT', mimeType: 'image/jpeg' });
    await app.http.post(`/api/v1/inspections/${next.body.id}/evidence`).set(f.owner).send({ photos: [{ slot: 'front', documentId: replacement.id }] }).expect(200);
    const [priorPhoto] = await app.db.select().from(inspectionPhotos).where(eq(inspectionPhotos.inspectionId, id));
    const [priorReport] = await app.db.select().from(inspectionReports).where(eq(inspectionReports.inspectionId, id));
    expect([priorPhoto.documentId, priorReport.documentId]).toEqual([photo.id, report.id]);
    await app.http.get(`/api/v1/documents/${report.id}`).set(f.owner).expect(200);
    await app.http.get(`/api/v1/documents/${photo.id}`).set(await signIn(app.http, f.quoteOfficer)).expect(404);
  });
});
