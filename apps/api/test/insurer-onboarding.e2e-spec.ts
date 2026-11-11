import { and, eq } from 'drizzle-orm';
import { auditLogs, insurers } from '../src/db/schema.js';
import { buildDocument, buildInsurer, buildStaffUser } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

/**
 * US-ADM-002: an insurer is onboarded rather than created. Its licence and
 * compliance evidence are captured and reviewed, activation is refused while
 * anything is incomplete, expired or unapproved and says which, and the
 * activation that succeeds records the dates, the approver and any conditions.
 */
describe('onboarding an insurer', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let admin: Awaited<ReturnType<typeof buildStaffUser>>;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const asAdmin = () => signIn(testApp.http, admin);

  /** An insurer awaiting approval, as onboarding will create one. */
  const pendingInsurer = async () => (await buildInsurer(testApp.db, { insurer: { status: 'PENDING' } })).insurer;

  const evidenceDocument = async () =>
    buildDocument(testApp.db, { staffId: admin.id }, { kind: 'INSURER_EVIDENCE' });

  const capture = async (insurerId: string, body: Record<string, unknown>) =>
    testApp.http.post(`/api/v1/insurers/${insurerId}/evidence`).set(await asAdmin()).send(body);

  const review = async (insurerId: string, evidenceId: string, body: Record<string, unknown>) =>
    testApp.http
      .post(`/api/v1/insurers/${insurerId}/evidence/${evidenceId}/review`)
      .set(await asAdmin())
      .send(body);

  const activate = async (insurerId: string, body: Record<string, unknown>) =>
    testApp.http.post(`/api/v1/insurers/${insurerId}/activate`).set(await asAdmin()).send(body);

  /** A licence on file, approved and current. */
  const approvedLicence = async (insurerId: string, expiresAt = '2099-12-31') => {
    const document = await evidenceDocument();
    const captured = await capture(insurerId, {
      kind: 'LICENCE',
      documentId: document.id,
      reference: 'PIA/2026/0042',
      expiresAt,
    });
    await review(insurerId, captured.body.id, { state: 'APPROVED' });
    return captured.body.id as string;
  };

  describe('capturing evidence', () => {
    it('records a document against the insurer, awaiting review', async () => {
      const insurer = await pendingInsurer();
      const document = await evidenceDocument();

      const response = await capture(insurer.id, {
        kind: 'LICENCE',
        documentId: document.id,
        reference: ' PIA/2026/0042 ',
        expiresAt: '2027-06-30',
      });

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({
        kind: 'LICENCE',
        state: 'PENDING',
        reference: 'PIA/2026/0042',
        expiresAt: '2027-06-30',
      });
      const listed = await testApp.http.get(`/api/v1/insurers/${insurer.id}/evidence`).set(await asAdmin()).expect(200);
      expect(listed.body.map((piece: { kind: string }) => piece.kind)).toEqual(['LICENCE']);
    });

    it('records who reviewed a piece of evidence and when', async () => {
      const insurer = await pendingInsurer();
      const document = await evidenceDocument();
      const captured = await capture(insurer.id, { kind: 'AGREEMENT', documentId: document.id });

      const reviewed = await review(insurer.id, captured.body.id, { state: 'APPROVED', note: 'Signed copy on file.' });

      expect(reviewed.status).toBe(200);
      expect(reviewed.body).toMatchObject({ state: 'APPROVED', reviewedBy: admin.fullName });
      expect(reviewed.body.reviewedAt).toEqual(expect.any(String));
    });
  });

  describe('activation', () => {
    it('is refused with nothing on file, naming what is missing', async () => {
      const insurer = await pendingInsurer();

      const response = await activate(insurer.id, { effectiveFrom: '2026-12-01' });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ACTIVATION_BLOCKED');
      expect(response.body.message).toContain('no licence on file');
    });

    it('is refused while the licence is unapproved, and says so', async () => {
      const insurer = await pendingInsurer();
      const document = await evidenceDocument();
      await capture(insurer.id, { kind: 'LICENCE', documentId: document.id, expiresAt: '2099-12-31' });

      const response = await activate(insurer.id, { effectiveFrom: '2026-12-01' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('an unapproved licence');
    });

    it('is refused when an approved licence has already lapsed', async () => {
      const insurer = await pendingInsurer();
      await approvedLicence(insurer.id, '2020-06-30');

      const response = await activate(insurer.id, { effectiveFrom: '2026-12-01' });

      expect(response.status).toBe(409);
      expect(response.body.message).toContain('an expired licence');
    });

    it('records the dates, the approver and the conditions once the evidence is in order', async () => {
      const insurer = await pendingInsurer();
      await approvedLicence(insurer.id);

      const response = await activate(insurer.id, {
        effectiveFrom: '2026-12-01',
        renewalDate: '2027-11-30',
        conditions: 'Quarterly solvency returns.',
      });

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('Active');
      const [row] = await side.db.select().from(insurers).where(eq(insurers.id, insurer.id));
      expect(row.status).toBe('ACTIVE');
      expect(row.approvedBy).toBe(admin.id);
      expect(row.activationConditions).toBe('Quarterly solvency returns.');
      expect(row.approvedAt).not.toBeNull();
      expect(row.effectiveFrom).not.toBeNull();
      expect(row.renewalDate).not.toBeNull();
    });

    it('is recorded in the audit log, naming the approver', async () => {
      const insurer = await pendingInsurer();
      await approvedLicence(insurer.id);

      await activate(insurer.id, { effectiveFrom: '2026-12-01' }).then((response) => expect(response.status).toBe(200));

      const [entry] = await side.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, 'insurer.activated'), eq(auditLogs.entityId, insurer.id)));
      expect(entry.actorId).toBe(admin.id);
      expect(entry.actorType).toBe('STAFF');
    });

    it('cannot be reached through the status route, so the evidence gate cannot be stepped around', async () => {
      const insurer = await pendingInsurer();

      const response = await testApp.http
        .patch(`/api/v1/insurers/${insurer.id}/status`)
        .set(await asAdmin())
        .send({ status: 'Active' });

      expect(response.status, 'activating is its own route, with its own gate').toBe(400);
      const [row] = await side.db.select().from(insurers).where(eq(insurers.id, insurer.id));
      expect(row.status).toBe('PENDING');
    });
  });

  describe('the technical model', () => {
    it('is captured without a client secret, which needs a key nobody has decided on yet', async () => {
      const insurer = await pendingInsurer();

      const response = await testApp.http
        .put(`/api/v1/insurers/${insurer.id}/integration`)
        .set(await asAdmin())
        .send({
          apiBaseUrl: 'https://api.prestige.example',
          publicSigningKey: 'a-public-key',
          clientId: 'prestige-insurshield',
          quoteCallbackUrl: 'https://api.prestige.example/quotes',
          sandboxMode: true,
        });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ clientId: 'prestige-insurshield', sandboxMode: true });
      expect(Object.keys(response.body), 'no secret is read back').not.toContain('clientSecret');
    });
  });

  describe('who may do this', () => {
    it('refuses insurer staff, who onboard nobody', async () => {
      const insurer = await pendingInsurer();
      const theirStaff = (await buildInsurer(testApp.db)).staff;

      await testApp.http
        .get(`/api/v1/insurers/${insurer.id}/evidence`)
        .set(await signIn(testApp.http, theirStaff))
        .expect(403);
    });
  });
});
