import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import {
  auditLogs,
  claimAttachments,
  claimNotifications,
  claimUpdates,
  customers,
  notifications,
  stateHistory,
} from '../src/db/schema.js';
import {
  buildClaim,
  buildCustomer,
  buildDocument,
  buildInsurer,
  buildPurchasedPolicy,
  buildStaffUser,
} from './builders.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { openTestDatabase, until, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

describe('claim lifecycle', () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await startApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function fixture() {
    const purchase = await buildPurchasedPolicy(app.db);
    const claim = await buildClaim(
      app.db,
      {
        customerId: purchase.customer.id,
        insurerId: purchase.insurer.insurer.id,
        policyNumber: purchase.policy.policyNumber,
      },
      {
        status: 'RECEIVED_BY_INSURER',
        receivedAt: new Date(),
        insurerClaimReference: 'INS-REFERENCE',
      },
    );
    const customer = await signIn(app.http, purchase.customer);
    const insurer = await signIn(app.http, purchase.insurer.staff);
    const updatePath = `/api/v1/insurer/claims/${claim.claimNumber}/updates`;
    const evidencePath = `/api/v1/claims/${claim.claimNumber}/evidence`;
    return {
      ...purchase,
      claim,
      customerSession: customer,
      insurerSession: insurer,
      updatePath,
      evidencePath,
      expectedRevision: `${claim.claimNumber}:acknowledged`,
    };
  }

  async function revision(
    f: Awaited<ReturnType<typeof fixture>>,
  ): Promise<string> {
    const response = await app.http
      .get(`/api/v1/insurer/claims/${f.claim.claimNumber}/timeline`)
      .set(f.insurerSession)
      .expect(200);
    return response.body.revision;
  }

  it('requires the servicing insurer’s reference on verified intake but accepts a retry', async () => {
    const f = await fixture();
    const claim = await buildClaim(
      app.db,
      {
        customerId: f.customer.id,
        insurerId: f.insurer.insurer.id,
        policyNumber: f.policy.policyNumber,
      },
      { status: 'NOTIFIED', responseDueOn: '2026-12-01' },
    );
    const timelinePath = `/api/v1/insurer/claims/${claim.claimNumber}/timeline`;
    expect(
      (await app.http.get(timelinePath).set(f.insurerSession).expect(200)).body
        .revision,
    ).toBe(`${claim.claimNumber}:submitted`);
    const path = `/api/v1/insurer/claims/${claim.claimNumber}/received`;
    const refused = await app.http
      .post(path)
      .set(f.insurerSession)
      .send({})
      .expect(400);
    expect(refused.body.code).toBe('CLAIM_INSURER_REFERENCE_REQUIRED');
    const accepted = await app.http
      .post(path)
      .set(f.insurerSession)
      .send({ insurerClaimReference: '  INS-2026-11  ' })
      .expect(200);
    expect(accepted.body).toMatchObject({
      status: 'RECEIVED_BY_INSURER',
      insurerClaimReference: 'INS-2026-11',
    });
    const replay = await app.http
      .post(path)
      .set(f.insurerSession)
      .send({})
      .expect(200);
    expect(replay.body).toEqual(accepted.body);
    expect(
      (await app.http.get(timelinePath).set(f.insurerSession).expect(200)).body
        .revision,
    ).toBe(`${claim.claimNumber}:acknowledged`);
  });

  it('preserves original facts and appends audited, notified updates; evidence replays exactly and conflicts on changed input', async () => {
    const f = await fixture();
    const revisions = new Map<string, string>();
    const update = async (action: string, evidenceRequest?: string) => {
      const expectedRevision = revisions.get(action) ?? (await revision(f));
      revisions.set(action, expectedRevision);
      return app.http
        .post(f.updatePath)
        .set(f.insurerSession)
        .set('Idempotency-Key', action)
        .send({
          action,
          message: `${action} claim`,
          expectedRevision,
          ...(evidenceRequest ? { evidenceRequest } : {}),
        });
    };
    const started = await update('START_REVIEW');
    expect(started.status).toBe(200);
    expect(started.body.status).toBe('Under review');
    expect(started.body.revision).toBe(started.body.updates.at(-1).id);
    expect(started.body.insurerClaimReference).toBe('INS-REFERENCE');
    expect(
      started.body.updates.map((row: { id: string }) => row.id).slice(0, 2),
    ).toEqual([
      `${f.claim.claimNumber}:submitted`,
      `${f.claim.claimNumber}:acknowledged`,
    ]);
    expect((await update('START_REVIEW')).body).toEqual(started.body);
    expect(
      (await update('REQUEST_EVIDENCE', 'Please supply the police report.'))
        .body.status,
    ).toBe('Additional information required');
    const doc = await buildDocument(
      app.db,
      { customerId: f.customer.id },
      { kind: 'CLAIM_ATTACHMENT' },
    );
    const evidenceRevision = await revision(f);
    const send = (documentIds: string[]) =>
      app.http
        .post(f.evidencePath)
        .set(f.customerSession)
        .set('Idempotency-Key', 'answer')
        .send({ documentIds, expectedRevision: evidenceRevision });
    const answered = await send([doc.id]);
    expect(answered.status).toBe(200);
    expect(answered.body.status).toBe('Under review');
    expect(answered.body.revision).toBe(answered.body.updates.at(-1).id);
    expect(answered.body.updates.at(-1)).toMatchObject({
      actorKind: 'CUSTOMER',
      documents: [expect.objectContaining({ id: doc.id })],
    });
    expect((await send([doc.id])).body).toEqual(answered.body);
    expect((await send([randomUUID()])).status).toBe(409);
    expect(
      (
        await app.http
          .post(f.evidencePath)
          .set(f.customerSession)
          .send({ documentIds: [doc.id], expectedRevision: f.expectedRevision })
      ).status,
    ).toBe(409);
    expect((await update('APPROVE')).body.status).toBe('Approved');
    expect((await update('CLOSE')).body.status).toBe('Closed');
    const timeline = await app.http
      .get(`/api/v1/claims/${f.claim.claimNumber}/timeline`)
      .set(f.customerSession);
    expect(timeline.status).toBe(200);
    expect(timeline.body.updates).toHaveLength(7);
    const events = await app.db
      .select()
      .from(claimUpdates)
      .where(eq(claimUpdates.claimNumber, f.claim.claimNumber));
    expect(events).toHaveLength(5);
    const links = await app.db
      .select()
      .from(claimAttachments)
      .where(eq(claimAttachments.claimNumber, f.claim.claimNumber));
    expect(links).toHaveLength(1);
    expect(links[0].claimUpdateId).toBe(answered.body.updates.at(-1).id);
    const audit = await app.db
      .select({ action: auditLogs.action })
      .from(auditLogs)
      .where(eq(auditLogs.entityId, f.claim.claimNumber));
    expect(
      audit.filter(({ action }) => action === 'claim.status_changed'),
    ).toHaveLength(5);
    expect(
      audit
        .map(({ action }) => action)
        .filter((action) => action !== 'claim.status_changed')
        .sort(),
    ).toEqual(
      [
        'claim.review_started',
        'claim.evidence_requested',
        'claim.evidence_submitted',
        'claim.approved',
        'claim.closed',
      ].sort(),
    );
    expect(
      await app.db
        .select()
        .from(stateHistory)
        .where(eq(stateHistory.entityId, f.claim.claimNumber)),
    ).toHaveLength(5);
    const notices = await app.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.entityId, f.claim.claimNumber),
          eq(notifications.channel, 'IN_APP'),
        ),
      );
    expect(notices.map((row) => row.templateKey).sort()).toEqual(
      [
        'claim.review_started',
        'claim.evidence_requested',
        'claim.evidence_submitted',
        'claim.approved',
        'claim.closed',
      ].sort(),
    );
  });

  it('denies forbidden roles and scopes both reads and commands to the customer, insurer and linked policy', async () => {
    const f = await fixture();
    for (const role of [
      'QUOTE_OFFICER',
      'FINANCE',
      'SUPPORT',
      'COMPLIANCE_READ_ONLY',
      'ADMIN',
    ] as const) {
      const staff = await buildStaffUser(app.db, {
        role,
        insurerId: role === 'ADMIN' ? null : f.insurer.insurer.id,
      });
      const session = await signIn(app.http, staff);
      expect(
        (
          await app.http.post(f.updatePath).set(session).send({
            action: 'START_REVIEW',
            message: 'Review',
            expectedRevision: f.expectedRevision,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await app.http
            .post(f.evidencePath)
            .set(session)
            .send({
              documentIds: [randomUUID()],
              expectedRevision: f.expectedRevision,
            })
        ).status,
      ).toBe(403);
    }
    const otherCustomer = await signIn(app.http, await buildCustomer(app.db));
    const otherInsurer = await signIn(
      app.http,
      (await buildInsurer(app.db)).staff,
    );
    expect(
      (
        await app.http
          .get(`/api/v1/claims/${f.claim.claimNumber}/timeline`)
          .set(otherCustomer)
      ).status,
    ).toBe(404);
    expect(
      (
        await app.http
          .get(`/api/v1/insurer/claims/${f.claim.claimNumber}/timeline`)
          .set(otherInsurer)
      ).status,
    ).toBe(404);
    expect(
      (
        await app.http.post(f.updatePath).set(otherInsurer).send({
          action: 'START_REVIEW',
          message: 'Review',
          expectedRevision: f.expectedRevision,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.http
          .post(f.evidencePath)
          .set(otherCustomer)
          .send({
            documentIds: [randomUUID()],
            expectedRevision: f.expectedRevision,
          })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.http.post(f.updatePath).set(f.customerSession).send({
          action: 'START_REVIEW',
          message: 'Review',
          expectedRevision: f.expectedRevision,
        })
      ).status,
    ).toBe(403);
    const unrelated = await buildPurchasedPolicy(app.db, {
      insurer: f.insurer,
    });
    await app.db
      .update(claimNotifications)
      .set({ policyNumber: unrelated.policy.policyNumber })
      .where(eq(claimNotifications.claimNumber, f.claim.claimNumber));
    expect(
      (
        await app.http
          .get(`/api/v1/claims/${f.claim.claimNumber}/timeline`)
          .set(f.customerSession)
      ).status,
    ).toBe(404);
    expect(
      (
        await app.http.post(f.updatePath).set(f.insurerSession).send({
          action: 'START_REVIEW',
          message: 'Review',
          expectedRevision: f.expectedRevision,
        })
      ).status,
    ).toBe(404);
  });

  it('rejects invalid transitions and unsafe evidence without consuming the retry key or appending an event', async () => {
    const f = await fixture();
    const post = async (action: string, evidenceRequest?: string) =>
      app.http
        .post(f.updatePath)
        .set(f.insurerSession)
        .send({
          action,
          message: 'Please review',
          evidenceRequest,
          expectedRevision: await revision(f),
        });
    expect((await post('CLOSE')).status).toBe(409);
    expect((await post('REQUEST_EVIDENCE')).status).toBe(400);
    expect(
      (await post('START_REVIEW', 'Unexpected evidence request')).status,
    ).toBe(400);
    expect((await post('START_REVIEW')).status).toBe(200);
    expect((await post('REQUEST_EVIDENCE', 'Report')).status).toBe(200);
    const stranger = await buildCustomer(app.db);
    const foreign = await buildDocument(
      app.db,
      { customerId: stranger.id },
      { kind: 'CLAIM_ATTACHMENT' },
    );
    const unscanned = await buildDocument(
      app.db,
      { customerId: f.customer.id },
      { kind: 'CLAIM_ATTACHMENT', scanStatus: 'UNSCANNED' },
    );
    const wrongKind = await buildDocument(app.db, {
      customerId: f.customer.id,
    });
    for (const document of [foreign, unscanned, wrongKind]) {
      expect(
        (
          await app.http
            .post(f.evidencePath)
            .set(f.customerSession)
            .set('Idempotency-Key', 'retry-after-refusal')
            .send({
              documentIds: [document.id],
              expectedRevision: await revision(f),
            })
        ).status,
      ).toBe(409);
    }
    expect(
      (
        await app.http
          .post(f.evidencePath)
          .set(f.customerSession)
          .send({ documentIds: [], expectedRevision: await revision(f) })
      ).status,
    ).toBe(400);
    const clean = await buildDocument(
      app.db,
      { customerId: f.customer.id },
      { kind: 'CLAIM_ATTACHMENT' },
    );
    expect(
      (
        await app.http
          .post(f.evidencePath)
          .set(f.customerSession)
          .set('Idempotency-Key', 'retry-after-refusal')
          .send({
            documentIds: [clean.id],
            expectedRevision: await revision(f),
          })
      ).status,
    ).toBe(200);
    expect((await post('DECLINE')).status).toBe(200);
    expect((await post('CLOSE')).status).toBe(200);
    expect((await post('START_REVIEW')).status).toBe(409);
    expect(
      await app.db
        .select()
        .from(claimUpdates)
        .where(eq(claimUpdates.claimNumber, f.claim.claimNumber)),
    ).toHaveLength(5);
  });

  it('rolls back appended evidence and status if auditing fails, then accepts the same retry key', async () => {
    const f = await fixture();
    await app.db
      .update(claimNotifications)
      .set({ status: 'EVIDENCE_REQUIRED' })
      .where(eq(claimNotifications.claimNumber, f.claim.claimNumber));
    const doc = await buildDocument(
      app.db,
      { customerId: f.customer.id },
      { kind: 'CLAIM_ATTACHMENT' },
    );
    const send = () =>
      app.http
        .post(f.evidencePath)
        .set(f.customerSession)
        .set('Idempotency-Key', 'recover')
        .send({ documentIds: [doc.id], expectedRevision: f.expectedRevision });
    const failure = vi
      .spyOn(app.app.get(AuditService), 'transition')
      .mockRejectedValueOnce(new Error('Audit unavailable'));
    try {
      expect((await send()).status).toBe(500);
    } finally {
      failure.mockRestore();
    }
    expect(
      await app.db
        .select()
        .from(claimUpdates)
        .where(eq(claimUpdates.claimNumber, f.claim.claimNumber)),
    ).toHaveLength(0);
    expect(
      await app.db
        .select()
        .from(claimAttachments)
        .where(eq(claimAttachments.claimNumber, f.claim.claimNumber)),
    ).toHaveLength(0);
    const [claim] = await app.db
      .select()
      .from(claimNotifications)
      .where(eq(claimNotifications.claimNumber, f.claim.claimNumber));
    expect(claim.status).toBe('EVIDENCE_REQUIRED');
    expect((await send()).status).toBe(200);
  });

  it('serializes competing commands behind a held claim lock and commits only one update', async () => {
    const f = await fixture();
    const side = openTestDatabase();
    const holder = await side.pool.connect();
    const requests: Promise<{ status: number }>[] = [];
    try {
      await holder.query('BEGIN');
      await holder.query(
        'SELECT 1 FROM claim_notifications WHERE "claimNumber" = $1 FOR UPDATE',
        [f.claim.claimNumber],
      );
      for (let i = 0; i < 2; i++)
        requests.push(
          app.http
            .post(f.updatePath)
            .set(f.insurerSession)
            .set('Idempotency-Key', `concurrent-${i}`)
            .send({
              action: 'START_REVIEW',
              message: 'Review',
              expectedRevision: f.expectedRevision,
            })
            .then((response) => response),
        );
      await until(async () => {
        const { rows } = await side.pool.query<{ count: string }>(
          `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query ILIKE '%claim_notifications%'`,
        );
        return Number(rows[0].count) >= 2;
      }, 'both lifecycle commands to wait for the claim lock');
      await holder.query('COMMIT');
      expect(
        (await Promise.all(requests))
          .map((response) => response.status)
          .sort((left, right) => left - right),
      ).toEqual([200, 409]);
      expect(
        await app.db
          .select()
          .from(claimUpdates)
          .where(eq(claimUpdates.claimNumber, f.claim.claimNumber)),
      ).toHaveLength(1);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      await Promise.allSettled(requests);
      await side.close();
    }
  });

  it('rejects old approvals and stale evidence across a new evidence cycle, while preserving exact retries', async () => {
    const f = await fixture();
    const update = (
      action: string,
      expectedRevision: string,
      evidenceRequest?: string,
    ) =>
      app.http.post(f.updatePath).set(f.insurerSession).send({
        action,
        expectedRevision,
        message: 'Review claim',
        evidenceRequest,
      });
    const review = await update('START_REVIEW', f.expectedRevision).expect(200);
    const oldApproval = {
      action: 'APPROVE',
      message: 'Approve claim',
      expectedRevision: review.body.revision,
    };
    const firstRequest = await update(
      'REQUEST_EVIDENCE',
      review.body.revision,
      'First report',
    ).expect(200);
    const first = await buildDocument(
      app.db,
      { customerId: f.customer.id },
      { kind: 'CLAIM_ATTACHMENT' },
    );
    const firstAnswer = {
      documentIds: [first.id],
      expectedRevision: firstRequest.body.revision,
    };
    const answered = await app.http
      .post(f.evidencePath)
      .set(f.customerSession)
      .set('Idempotency-Key', 'first-answer')
      .send(firstAnswer)
      .expect(200);
    const staleApproval = await app.http
      .post(f.updatePath)
      .set(f.insurerSession)
      .set('Idempotency-Key', 'approval')
      .send(oldApproval)
      .expect(409);
    expect(staleApproval.body.code).toBe('CLAIM_REVISION_CHANGED');
    const secondRequest = await update(
      'REQUEST_EVIDENCE',
      answered.body.revision,
      'Second report',
    ).expect(200);
    const second = await buildDocument(
      app.db,
      { customerId: f.customer.id },
      { kind: 'CLAIM_ATTACHMENT' },
    );
    const staleEvidence = await app.http
      .post(f.evidencePath)
      .set(f.customerSession)
      .set('Idempotency-Key', 'second-answer')
      .send({
        documentIds: [second.id],
        expectedRevision: firstRequest.body.revision,
      })
      .expect(409);
    expect(staleEvidence.body.code).toBe('CLAIM_REVISION_CHANGED');
    expect(await revision(f)).toBe(secondRequest.body.revision);
    expect(
      await app.db
        .select()
        .from(claimAttachments)
        .where(eq(claimAttachments.documentId, second.id)),
    ).toHaveLength(0);
    // Same key and original payload replay despite the newer evidence request.
    const replay = await app.http
      .post(f.evidencePath)
      .set(f.customerSession)
      .set('Idempotency-Key', 'first-answer')
      .send(firstAnswer)
      .expect(200);
    expect(replay.body).toEqual(answered.body);
    const secondAnswer = await app.http
      .post(f.evidencePath)
      .set(f.customerSession)
      .set('Idempotency-Key', 'second-answer')
      .send({
        documentIds: [second.id],
        expectedRevision: secondRequest.body.revision,
      })
      .expect(200);
    // Refused commands have not consumed their idempotency keys.
    await app.http
      .post(f.updatePath)
      .set(f.insurerSession)
      .set('Idempotency-Key', 'approval')
      .send({ ...oldApproval, expectedRevision: secondAnswer.body.revision })
      .expect(200);
    expect(
      await app.db
        .select()
        .from(claimUpdates)
        .where(eq(claimUpdates.claimNumber, f.claim.claimNumber)),
    ).toHaveLength(6);
  });

  it('requires a nonempty string revision on both commands', async () => {
    const f = await fixture();
    for (const expectedRevision of [undefined, null, '', 42]) {
      await app.http
        .post(f.updatePath)
        .set(f.insurerSession)
        .send({ action: 'START_REVIEW', message: 'Review', expectedRevision })
        .expect(400);
      await app.http
        .post(f.evidencePath)
        .set(f.customerSession)
        .send({ documentIds: [randomUUID()], expectedRevision })
        .expect(400);
    }
  });

  it('allows the servicing insurer to read and update legacy policy claims without a customer link', async () => {
    const f = await fixture();
    await app.db
      .update(claimNotifications)
      .set({ customerId: null })
      .where(eq(claimNotifications.claimNumber, f.claim.claimNumber));
    expect(await revision(f)).toBe(f.expectedRevision);
    const started = await app.http
      .post(f.updatePath)
      .set(f.insurerSession)
      .send({
        action: 'START_REVIEW',
        message: 'Review',
        expectedRevision: f.expectedRevision,
      })
      .expect(200);
    const unavailable = await app.http
      .post(f.updatePath)
      .set(f.insurerSession)
      .send({
        action: 'REQUEST_EVIDENCE',
        message: 'Report required',
        evidenceRequest: 'Report',
        expectedRevision: started.body.revision,
      })
      .expect(409);
    expect(unavailable.body.code).toBe('CLAIM_CUSTOMER_UNAVAILABLE');
    await app.http
      .get(`/api/v1/claims/${f.claim.claimNumber}/timeline`)
      .set(f.customerSession)
      .expect(404);
    const other = await signIn(app.http, (await buildInsurer(app.db)).staff);
    await app.http
      .get(`/api/v1/insurer/claims/${f.claim.claimNumber}/timeline`)
      .set(other)
      .expect(404);
    await app.http
      .post(f.updatePath)
      .set(other)
      .send({
        action: 'APPROVE',
        message: 'Approve',
        expectedRevision: started.body.revision,
      })
      .expect(404);
    // Nullable customer does not weaken the policy's insurer boundary.
    const unrelated = await buildPurchasedPolicy(app.db);
    await app.db
      .update(claimNotifications)
      .set({ policyNumber: unrelated.policy.policyNumber })
      .where(eq(claimNotifications.claimNumber, f.claim.claimNumber));
    await app.http
      .get(`/api/v1/insurer/claims/${f.claim.claimNumber}/timeline`)
      .set(f.insurerSession)
      .expect(404);
  });

  it('refuses requesting evidence from a closed customer without appending an update', async () => {
    const f = await fixture();
    const started = await app.http
      .post(f.updatePath)
      .set(f.insurerSession)
      .send({
        action: 'START_REVIEW',
        message: 'Review',
        expectedRevision: f.expectedRevision,
      })
      .expect(200);
    await app.db
      .update(customers)
      .set({ deletedAt: new Date() })
      .where(eq(customers.id, f.customer.id));
    const refused = await app.http
      .post(f.updatePath)
      .set(f.insurerSession)
      .send({
        action: 'REQUEST_EVIDENCE',
        message: 'Report required',
        evidenceRequest: 'Report',
        expectedRevision: started.body.revision,
      })
      .expect(409);
    expect(refused.body.code).toBe('CLAIM_CUSTOMER_UNAVAILABLE');
    expect(await revision(f)).toBe(started.body.revision);
    expect(
      await app.db
        .select()
        .from(claimUpdates)
        .where(eq(claimUpdates.claimNumber, f.claim.claimNumber)),
    ).toHaveLength(1);
  });

  it('waits for customer closure before locking the claim when requesting evidence', async () => {
    const f = await fixture();
    const started = await app.http
      .post(f.updatePath)
      .set(f.insurerSession)
      .send({
        action: 'START_REVIEW',
        message: 'Review',
        expectedRevision: f.expectedRevision,
      })
      .expect(200);
    const side = openTestDatabase();
    const holder = await side.pool.connect();
    let pending:
      Promise<{ status: number; body: { code: string } }> | undefined;
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT 1 FROM customers WHERE id = $1 FOR UPDATE', [
        f.customer.id,
      ]);
      pending = app.http
        .post(f.updatePath)
        .set(f.insurerSession)
        .send({
          action: 'REQUEST_EVIDENCE',
          message: 'Report required',
          evidenceRequest: 'Report',
          expectedRevision: started.body.revision,
        })
        .then((response) => response);
      await until(async () => {
        const { rows } = await side.pool.query<{ count: string }>(
          `SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()
            AND wait_event_type = 'Lock' AND query ILIKE '%"customers"%'`,
        );
        return Number(rows[0].count) > 0;
      }, 'the evidence request to wait on the customer lock');
      // A request waiting on the customer must hold no claim lock that could deadlock closure.
      await holder.query(
        'SELECT 1 FROM claim_notifications WHERE "claimNumber" = $1 FOR UPDATE NOWAIT',
        [f.claim.claimNumber],
      );
      await holder.query(
        'UPDATE customers SET "deletedAt" = now() WHERE id = $1',
        [f.customer.id],
      );
      await holder.query('COMMIT');
      const refused = await pending;
      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('CLAIM_CUSTOMER_UNAVAILABLE');
      expect(await revision(f)).toBe(started.body.revision);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
      if (pending) await Promise.allSettled([pending]);
      await side.close();
    }
  });
});
