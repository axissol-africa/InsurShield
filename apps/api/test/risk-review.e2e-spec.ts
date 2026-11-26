import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { auditLogs, insurerQuotes, reconciliationItems, riskReviewFlags } from '../src/db/schema.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { RiskReviewRepository } from '../src/risk-review/risk-review.repository.js';
import { buildCustomer, buildStaffUser } from './builders.js';
import { buildPayableQuote } from './builders/payments.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

describe('controlled manual risk review', () => {
  let app: TestApp;
  let session: Awaited<ReturnType<typeof signIn>>;
  let staffId: string;
  const base = '/api/v1/admin/risk-review';
  beforeAll(async () => {
    app = await startApp();
    const staff = await buildStaffUser(app.db, { role: 'ADMIN' });
    staffId = staff.id;
    session = await signIn(app.http, staff);
  });
  afterAll(async () => { await app?.close(); });
  const post = (path: string, body: object) => app.http.post(`${base}${path}`).set(session).send(body);
  async function referral() {
    const built = await buildPayableQuote(app.db);
    const body = { workflowType: 'QUOTE', workflowId: built.quote.id, evidenceReference: `quote:${built.quote.id}`, severity: 'MEDIUM', reason: 'Manual review requested by operations', nextAction: 'Review the quote record' };
    return { built, body };
  }
  it('restricts every endpoint to authorized administrators', async () => {
    const customer = await buildCustomer(app.db);
    const customerSession = await signIn(app.http, customer);
    expect((await app.http.get(base)).status).toBe(401);
    expect((await app.http.get(base).set(customerSession)).status).toBe(403);
    for (const path of ['', `/${randomUUID()}/assign`, `/${randomUUID()}/resolve`]) {
      expect((await app.http.post(`${base}${path}`).set(customerSession).send({})).status).toBe(403);
    }
  });
  it('validates evidence and actual workflow existence and bounds the queue', async () => {
    const { body } = await referral();
    expect((await post('', { ...body, evidenceReference: 'https://invalid.test' })).status).toBe(400);
    const missing = randomUUID();
    expect((await post('', { ...body, workflowId: missing, evidenceReference: `quote:${missing}` })).status).toBe(404);
    expect((await post('', { ...body, reason: '            ' })).status).toBe(400);
    expect((await app.http.get(`${base}?limit=101`).set(session)).status).toBe(400);
    expect((await app.http.get(`${base}?cursor=invalid`).set(session)).status).toBe(400);
    await post('', body).expect(201);
    const second = await referral();
    await post('', second.body).expect(201);
    const page = await app.http.get(`${base}?limit=1`).set(session).expect(200);
    expect(page.body.items).toHaveLength(1);
    expect(page.body.next).toBe(page.body.items[0].id);
    const next = await app.http.get(`${base}?limit=1&cursor=${page.body.next}`).set(session).expect(200);
    expect(next.body.items[0].id).not.toBe(page.body.items[0].id);
  });
  it('records assignment and outcome atomically without changing the quote', async () => {
    const { body, built } = await referral();
    const created = await post('', body).expect(201);
    expect(created.body).toMatchObject({ status: 'OPEN', version: 1, workflowEffect: 'METADATA_ONLY', referredByStaffId: staffId });
    expect((await post('', body)).body.code).toBe('RISK_REVIEW_EXISTS');
    const assigned = await post(`/${created.body.id}/assign`, { staffId, expectedVersion: 1, nextAction: 'Examine the supporting record' }).expect(200);
    expect(assigned.body).toMatchObject({ status: 'IN_PROGRESS', version: 2, ownerStaffId: staffId });
    const resolution = { expectedVersion: 2, outcome: 'REFERRED', reason: 'Operations will investigate separately', nextAction: 'Contact the operations owner' };
    const resolved = await post(`/${created.body.id}/resolve`, resolution).expect(200);
    expect(resolved.body).toMatchObject({ status: 'RESOLVED', outcome: 'REFERRED', resolvedByStaffId: staffId, workflowEffect: 'METADATA_ONLY', version: 3 });
    expect(resolved.body.resolvedAt).toBeTruthy();
    expect((await post(`/${created.body.id}/resolve`, resolution)).body.code).toBe('RISK_REVIEW_RESOLVED');
    const [quote] = await app.db.select().from(insurerQuotes).where(eq(insurerQuotes.id, built.quote.id));
    expect(quote).toEqual(built.quote);
    const events = await app.db.select().from(auditLogs).where(eq(auditLogs.entityId, created.body.id));
    expect(events.map((event) => event.action).sort()).toEqual(['risk_review.assigned', 'risk_review.referred', 'risk_review.resolved']);
  });
  it('supports a reconciliation reference without resolving its financial workflow', async () => {
    const [item] = await app.db.insert(reconciliationItems).values({ kind: 'REFUND_REQUIRED', reason: 'Manual financial review needed' }).returning();
    const created = await post('', { workflowType: 'RECONCILIATION_ITEM', workflowId: item.id, evidenceReference: `reconciliation:${item.id}`, severity: 'HIGH', reason: 'Operations has referred this item', nextAction: 'Review reconciliation evidence' }).expect(201);
    await post(`/${created.body.id}/resolve`, { expectedVersion: 1, outcome: 'NO_ACTION', reason: 'No risk action is required', nextAction: 'No further risk action' }).expect(200);
    const [unchanged] = await app.db.select().from(reconciliationItems).where(eq(reconciliationItems.id, item.id));
    expect(unchanged).toEqual(item);
  });
  it('rejects inactive owners and rolls the review back when audit fails', async () => {
    const { body } = await referral();
    const created = await post('', body).expect(201);
    const inactive = await buildStaffUser(app.db, { role: 'ADMIN', isActive: false });
    expect((await post(`/${created.body.id}/assign`, { staffId: inactive.id, expectedVersion: 1, nextAction: 'Review evidence' })).status).toBe(400);
    const spy = vi.spyOn(app.app.get(AuditService), 'write').mockRejectedValueOnce(new Error('audit unavailable'));
    try {
      expect((await post(`/${created.body.id}/assign`, { staffId, expectedVersion: 1, nextAction: 'Review evidence' })).status).toBe(500);
    } finally { spy.mockRestore(); }
    const [row] = await app.db.select().from(riskReviewFlags).where(eq(riskReviewFlags.id, created.body.id));
    expect(row).toMatchObject({ status: 'OPEN', version: 1, ownerStaffId: null });
  });
  it('forces competing edits to overlap and rejects the stale version', async () => {
    const { body } = await referral();
    const created = await post('', body).expect(201);
    const repository = app.app.get(RiskReviewRepository);
    const original = repository.lock.bind(repository);
    let release!: () => void;
    let locked!: () => void;
    let competing!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const firstLocked = new Promise<void>((resolve) => { locked = resolve; });
    const secondEntered = new Promise<void>((resolve) => { competing = resolve; });
    let count = 0;
    const spy = vi.spyOn(repository, 'lock').mockImplementation(async (tx, id) => {
      count += 1;
      if (count === 1) {
        const row = await original(tx, id);
        locked();
        await gate;
        return row;
      }
      competing();
      return original(tx, id);
    });
    try {
      const first = post(`/${created.body.id}/assign`, { expectedVersion: 1, staffId, nextAction: 'First reviewer action' }).then((response) => response);
      await firstLocked;
      const second = post(`/${created.body.id}/assign`, { expectedVersion: 1, staffId: null, nextAction: 'Competing reviewer action' }).then((response) => response);
      await secondEntered;
      release();
      expect((await first).status).toBe(200);
      expect((await second).body.code).toBe('RISK_REVIEW_STALE');
    } finally { release(); spy.mockRestore(); }
  });
});
