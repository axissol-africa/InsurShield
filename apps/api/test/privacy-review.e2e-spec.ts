import { and, eq, sql } from 'drizzle-orm';
import {
  auditLogs,
  customers,
  documents,
  insurerReviews,
  policies,
  privacyRequestEvents,
  privacyRequests,
  reviewRevisions,
} from '../src/db/schema.js';
import { defaultRuleValue } from '../src/settings/domain/rules.js';
import { RetentionRepository } from '../src/retention/retention.repository.js';
import {
  buildCustomer,
  buildDocument,
  buildPurchasedPolicy,
  buildStaffUser,
} from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

describe('controlled privacy and retention review', () => {
  let app: TestApp;
  let admin: SessionHeaders;
  let adminId: string;
  const base = '/api/v1/admin/privacy-requests';
  const context = {
    decisionReference: 'Approved retention exception REF-1',
    rationale: 'Preserve evidence pending accountable review',
    evidenceReference: 'Restricted evidence register REF-2',
  };
  beforeAll(async () => {
    app = await startApp();
    const staff = await buildStaffUser(app.db);
    adminId = staff.id;
    admin = await signIn(app.http, staff);
  });
  afterAll(async () => {
    await app?.close();
  });
  async function verified(customerId: string) {
    const created = await app.http
      .post(base)
      .set(admin)
      .send({ kind: 'RETENTION_REVIEW', customerId })
      .expect(201);
    await app.http
      .post(`${base}/${created.body.id}/transitions`)
      .set(admin)
      .send({ version: 1, action: 'ASSIGNED', ownerStaffId: adminId })
      .expect(201);
    await app.http
      .post(`${base}/${created.body.id}/transitions`)
      .set(admin)
      .send({
        version: 2,
        action: 'VERIFIED',
        rationale: context.rationale,
        evidenceReference: context.evidenceReference,
      })
      .expect(201);
    return created.body.id as string;
  }
  it('derives customer scope, limits returned data, and audits denied access to private records', async () => {
    const customer = await buildCustomer(app.db);
    const owner = await signIn(app.http, customer);
    const other = await signIn(app.http, await buildCustomer(app.db));
    const created = await app.http
      .post('/api/v1/privacy-requests')
      .set(owner)
      .send({ kind: 'ACCESS' })
      .expect(201);
    expect(Object.keys(created.body).sort()).toEqual([
      'completedAt',
      'createdAt',
      'id',
      'kind',
      'status',
    ]);
    await app.http
      .post('/api/v1/privacy-requests')
      .set(owner)
      .send({ kind: 'ACCESS', customerId: customer.id })
      .expect(400);
    const list = await app.http
      .get('/api/v1/privacy-requests')
      .set(other)
      .expect(200);
    expect(
      list.body.items.map((item: { id: string }) => item.id),
    ).not.toContain(created.body.id);
    await app.http.get(`${base}/${created.body.id}`).set(owner).expect(403);
    const refusals = await app.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.actorId, customer.id));
    const refusal = refusals.find((row) => row.action === 'access.refused');
    expect(refusal).toMatchObject({
      entityType: 'PERMISSION',
      entityId: 'admin:privacy:review',
      note: 'GET',
      before: null,
      after: null,
    });
    await app.http.get(`${base}?customerId=%25`).set(admin).expect(400);
  });
  it('requires verification, decision evidence and accountable owner; versions serialize stale writes', async () => {
    const customer = await buildCustomer(app.db);
    const created = await app.http
      .post(base)
      .set(admin)
      .send({ customerId: customer.id, kind: 'ERASURE' })
      .expect(201);
    const id = created.body.id;
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({ version: 1, action: 'COMPLETED', ...context })
      .expect(409);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({ version: 1, action: 'VERIFIED', ...context })
      .expect(409);
    const writes = await Promise.all(
      [1, 2].map(() =>
        app.http
          .post(`${base}/${id}/transitions`)
          .set(admin)
          .send({ version: 1, action: 'ASSIGNED', ownerStaffId: adminId }),
      ),
    );
    expect(writes.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    await app.http
      .post(`${base}/${id}/hold`)
      .set(admin)
      .send({ version: 2, held: true, ...context })
      .expect(409);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({
        version: 2,
        action: 'VERIFIED',
        rationale: ' ',
        evidenceReference: 'ref',
      })
      .expect(400);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({ version: 2, action: 'VERIFIED', ...context })
      .expect(201);
    const outsider = await buildCustomer(app.db);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({
        version: 3,
        action: 'DECIDED',
        ...context,
        affectedRecords: [{ type: 'CUSTOMER', id: outsider.id }],
      })
      .expect(404);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({
        version: 3,
        action: 'DECIDED',
        ...context,
        affectedRecords: [{ type: 'CUSTOMER', id: customer.id }],
      })
      .expect(201);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({ version: 4, action: 'COMPLETED', ...context })
      .expect(201);
    const [unchanged] = await app.db
      .select()
      .from(customers)
      .where(eq(customers.id, customer.id));
    expect(unchanged.anonymisedAt).toBeNull();
    expect(unchanged.deletedAt).toBeNull();
    const register = await app.http.get(base).set(admin)
      .query({ customerId: customer.id, status: 'COMPLETED' }).expect(200);
    expect(register.body.items).toMatchObject([{ id }]);
    const [listRead] = await app.db.select().from(auditLogs).where(and(
      eq(auditLogs.actorId, adminId), eq(auditLogs.action, 'privacy.list_viewed'),
    ));
    expect(listRead).toMatchObject({
      actorType: 'STAFF', entityType: 'PRIVACY_REQUEST', entityId: 'privacy-register',
      correlationId: expect.any(String),
      after: { page: 1, status: 'COMPLETED', subjectFilter: true, resultCount: 1 },
    });
    expect(JSON.stringify(listRead)).not.toContain(customer.id);
    const detail = await app.http.get(`${base}/${id}`).set(admin).expect(200);
    expect(detail.body.events).toHaveLength(5);
    await expect(
      app.db
        .update(privacyRequestEvents)
        .set({ rationale: 'overwrite' })
        .where(eq(privacyRequestEvents.requestId, id)),
    ).rejects.toThrow();
    await expect(
      app.db
        .delete(privacyRequestEvents)
        .where(eq(privacyRequestEvents.requestId, id)),
    ).rejects.toThrow();
    const audit = await app.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, id));
    expect(audit.find((row) => row.action === 'privacy.case_viewed')).toMatchObject({
      actorType: 'STAFF', actorId: adminId, entityType: 'PRIVACY_REQUEST',
      correlationId: id, after: { page: 1, resultCount: 5 },
    });
    expect(JSON.stringify(audit)).not.toContain(customer.id);
    expect(JSON.stringify(audit)).not.toContain(context.evidenceReference);
    expect(JSON.stringify(audit)).not.toContain(context.rationale);
  });
  it('holds block document deletion and account anonymisation; releases preserve existing retention rules', async () => {
    const customer = await buildCustomer(app.db, { userId: null });
    const now = new Date();
    const old = new Date(now.getTime() - 3000 * 86400000);
    const document = await buildDocument(
      app.db,
      { customerId: customer.id },
      { uploadedAt: old },
    );
    const id = await verified(customer.id);
    await app.http
      .post(`${base}/${id}/hold`)
      .set(admin)
      .send({ version: 3, held: true, ...context })
      .expect(201);
    await app.db
      .update(customers)
      .set({ deletedAt: old })
      .where(eq(customers.id, customer.id));
    const retention = new RetentionRepository(app.db);
    const days = defaultRuleValue('DOCUMENT_RETENTION').daysByClass;
    const claim = () =>
      retention.transaction((tx) =>
        retention.claimDocument(tx, document.id, days, now),
      );
    expect(await claim()).toBeNull();
    expect(
      await retention.transaction((tx) =>
        retention.anonymise(tx, customer.id, now, now),
      ),
    ).toBe(false);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({
        version: 4,
        action: 'DECIDED',
        ...context,
        affectedRecords: [{ type: 'DOCUMENT', id: document.id }],
      })
      .expect(201);
    await app.http
      .post(`${base}/${id}/transitions`)
      .set(admin)
      .send({ version: 5, action: 'COMPLETED', ...context })
      .expect(409);
    await app.http
      .post(`${base}/${id}/hold`)
      .set(admin)
      .send({ version: 5, held: false, ...context })
      .expect(201);
    expect(await claim()).not.toBeNull();
    await app.http
      .post(`${base}/${id}/hold`)
      .set(admin)
      .send({ version: 6, held: true, ...context })
      .expect(409);
    const [caseRow] = await app.db
      .select()
      .from(privacyRequests)
      .where(eq(privacyRequests.id, id));
    expect(caseRow.held).toBe(false);
    const [doc] = await app.db
      .select()
      .from(documents)
      .where(eq(documents.id, document.id));
    expect(doc.deletedAt).toBeNull();
  });
  it('customer privacy holds also fence review private-content purge without releasing independent legal holds', async () => {
    const purchase = await buildPurchasedPolicy(app.db);
    const old = new Date('2000-01-01T00:00:00Z');
    await app.db
      .update(policies)
      .set({ status: 'CANCELLED' })
      .where(eq(policies.policyNumber, purchase.policy.policyNumber));
    const [review] = await app.db
      .insert(insurerReviews)
      .values({
        policyNumber: purchase.policy.policyNumber,
        createdAt: old,
        withdrawnAt: old,
      })
      .returning();
    const [revision] = await app.db
      .insert(reviewRevisions)
      .values({
        reviewId: review.id,
        kind: 'REVIEW',
        version: 1,
        status: 'REMOVED',
        rating: 3,
        text: 'Private retained content',
        createdAt: old,
        retiredAt: old,
      })
      .returning();
    const id = await verified(purchase.customer.id);
    await app.http
      .post(`${base}/${id}/hold`)
      .set(admin)
      .send({ version: 3, held: true, ...context })
      .expect(201);
    const retention = new RetentionRepository(app.db);
    const purge = () =>
      retention.transaction((tx) =>
        retention.purgeReview(tx, review.id, new Date(), 365, 30),
      );
    expect(await purge()).toEqual({ revisions: 0, appeals: 0 });
    await app.db
      .update(insurerReviews)
      .set({ legalHoldAt: new Date() })
      .where(eq(insurerReviews.id, review.id));
    await app.http
      .post(`${base}/${id}/hold`)
      .set(admin)
      .send({ version: 4, held: false, ...context })
      .expect(201);
    expect(await purge()).toEqual({ revisions: 0, appeals: 0 });
    await app.db
      .update(insurerReviews)
      .set({ legalHoldAt: null })
      .where(eq(insurerReviews.id, review.id));
    expect(await purge()).toEqual({ revisions: 1, appeals: 0 });
    const [purged] = await app.db
      .select()
      .from(reviewRevisions)
      .where(eq(reviewRevisions.id, revision.id));
    expect(purged.text).toBeNull();
  });
  it('skips document deletion while an uncommitted approved hold owns the customer fence', async () => {
    const customer = await buildCustomer(app.db, { userId: null });
    const document = await buildDocument(
      app.db,
      { customerId: customer.id },
      { uploadedAt: new Date('2000-01-01T00:00:00Z') },
    );
    const id = await verified(customer.id);
    let acquired!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      acquired = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const approval = app.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${customer.id}, 16))`,
      );
      await tx
        .update(privacyRequests)
        .set({ held: true })
        .where(eq(privacyRequests.id, id));
      acquired();
      await gate;
    });
    const retention = new RetentionRepository(app.db);
    const claim = () =>
      retention.transaction((tx) =>
        retention.claimDocument(
          tx,
          document.id,
          defaultRuleValue('DOCUMENT_RETENTION').daysByClass,
          new Date(),
        ),
      );
    try {
      await Promise.race([ready, approval]);
      expect(await claim()).toBeNull();
    } finally {
      release();
      await approval;
    }
    expect(await claim()).toBeNull();
  });
});
