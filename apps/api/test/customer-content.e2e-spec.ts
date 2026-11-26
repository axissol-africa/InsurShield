import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { CustomerContentRepository } from '../src/customer-content/customer-content.repository.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { auditLogs } from '../src/db/schema.js';
import { buildInsurer, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

const base = '/api/v1/customer-content';
const slug = () => `content-${randomUUID()}`;
const draft = (overrides = {}) => ({ type: 'FAQ', title: 'How can I contact support?', body: 'Use the support directory.', effectiveFrom: '2020-01-01', expectedVersion: 0, ...overrides });
describe('governed customer content', () => {
  let app: TestApp;
  let maker: Awaited<ReturnType<typeof buildStaffUser>>;
  let checker: Awaited<ReturnType<typeof buildStaffUser>>;
  let asMaker: SessionHeaders;
  let asChecker: SessionHeaders;
  beforeAll(async () => {
    app = await startApp();
    maker = await buildStaffUser(app.db, { role: 'ADMIN' });
    checker = await buildStaffUser(app.db, { role: 'ADMIN' });
    asMaker = await signIn(app.http, maker);
    asChecker = await signIn(app.http, checker);
  });
  afterAll(async () => app.close());
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
  const create = (key: string, payload = draft()) => app.http.post(`${base}/admin/${key}/versions`).set(asMaker).send(payload);
  const approve = (key: string, id: string) => app.http.post(`${base}/admin/${key}/versions/${id}/approve`).set(asChecker).send({});
  const withdraw = (key: string, id: string) => app.http.post(`${base}/admin/${key}/versions/${id}/withdraw`).set(asMaker).send({ reason: 'Retired wording.' });
  async function publicItems(key: string) {
    const { body } = await app.http.get(`${base}/public`).expect(200);
    return body.items.filter((item: { slug: string }) => item.slug === key);
  }
  it('requires independent approval, hides drafts and publishes only the explicit public fields', async () => {
    const key = slug();
    const { body: row } = await create(key).expect(201);
    expect(row).toMatchObject({ status: 'DRAFT', version: 1, ownerStaffId: maker.id, audience: 'CUSTOMER', channel: 'SUPPORT' });
    expect(await publicItems(key)).toEqual([]);
    await app.http.post(`${base}/admin/${key}/versions/${row.id}/approve`).set(asMaker).expect(403)
      .expect(({ body }) => expect(body.code).toBe('CONTENT_SELF_APPROVAL'));
    await approve(key, row.id).expect(201);
    expect(await publicItems(key)).toEqual([{ id: row.id, slug: key, type: 'FAQ', version: 1,
      title: row.title, body: row.body, effectiveFrom: row.effectiveFrom, expiresOn: null }]);
    await approve(key, row.id).expect(409);
    const events = await app.db.select().from(auditLogs).where(eq(auditLogs.entityId, row.id));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'customer_content.drafted', actorId: maker.id, correlationId: key }),
      expect.objectContaining({ action: 'customer_content.approved', actorId: checker.id }),
    ]));
  });
  it('preserves immutable wording and history and never revives prior copy after withdrawal', async () => {
    const key = slug();
    const { body: first } = await create(key).expect(201);
    await approve(key, first.id).expect(201);
    const { body: second } = await create(key, draft({ expectedVersion: 1, body: 'New approved wording.' })).expect(201);
    expect((await publicItems(key))[0].id).toBe(first.id);
    await approve(key, second.id).expect(201);
    await withdraw(key, second.id).expect(201);
    expect(await publicItems(key)).toEqual([]);
    await approve(key, second.id).expect(409);
    await withdraw(key, second.id).expect(409);
    const history = await app.http.get(`${base}/admin/${key}/history`).set(asMaker).expect(200);
    expect(history.body.items).toEqual([
      expect.objectContaining({ id: second.id, body: 'New approved wording.', status: 'WITHDRAWN', withdrawalReason: 'Retired wording.', withdrawnByStaffId: maker.id }),
      expect.objectContaining({ id: first.id, body: first.body, status: 'APPROVED' }),
    ]);
    await app.http.patch(`${base}/admin/${key}/versions/${first.id}`).set(asMaker).send({ body: 'Tampered' }).expect(404);
  });
  it('keeps scheduled approvals private and lets withdrawn drafts leave current copy intact', async () => {
    const key = slug();
    const { body: first } = await create(key).expect(201);
    await approve(key, first.id).expect(201);
    const { body: second } = await create(key, draft({ expectedVersion: 1 })).expect(201);
    await withdraw(key, second.id).expect(201);
    expect((await publicItems(key))[0].id).toBe(first.id);
    const { body: third } = await create(key, draft({ expectedVersion: 2, effectiveFrom: '2099-01-01' })).expect(201);
    await approve(key, third.id).expect(201);
    expect((await publicItems(key))[0].id).toBe(first.id);
    await withdraw(key, third.id).expect(201);
    expect(await publicItems(key)).toEqual([]);
  });
  it('uses Lusaka midnight and does not revive old copy after the latest publication expires', async () => {
    const key = slug();
    const { body: first } = await create(key).expect(201);
    await approve(key, first.id).expect(201);
    const { body: second } = await create(key, draft({ expectedVersion: 1, effectiveFrom: '2090-01-02', expiresOn: '2090-01-02' })).expect(201);
    await approve(key, second.id).expect(201);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2090-01-01T21:59:59Z'));
    expect((await publicItems(key))[0].id).toBe(first.id);
    vi.setSystemTime(new Date('2090-01-01T22:00:00Z'));
    expect((await publicItems(key))[0].id).toBe(second.id);
    vi.setSystemTime(new Date('2090-01-02T21:59:59Z'));
    expect((await publicItems(key))[0].id).toBe(second.id);
    vi.setSystemTime(new Date('2090-01-02T22:00:00Z'));
    expect(await publicItems(key)).toEqual([]);
  });
  it('refuses stale version commands, changed types, malformed dates and rich text', async () => {
    const key = slug();
    const { body: first } = await create(key).expect(201);
    await create(key).expect(409);
    await create(key, draft({ expectedVersion: 1, type: 'LEGAL' })).expect(409);
    const { body: second } = await create(key, draft({ expectedVersion: 1 })).expect(201);
    await approve(key, first.id).expect(409);
    for (const payload of [draft({ effectiveFrom: '2026-02-30' }), draft({ effectiveFrom: '2026-01-01T00:00:00Z' }),
      draft({ expiresOn: '2019-12-31' }), draft({ title: ' ' }), draft({ body: '<b>HTML</b>' }), draft({ expectedVersion: -1 })]) {
      await create(slug(), payload).expect(400);
    }
    await app.http.post(`${base}/admin/${key}/versions/${second.id}/withdraw`).set(asMaker).send({ reason: '' }).expect(400);
    const expiredKey = slug();
    const { body: expired } = await create(expiredKey, draft({ expiresOn: '2020-01-02' })).expect(201);
    await approve(expiredKey, expired.id).expect(409).expect(({ body }) => expect(body.code).toBe('CONTENT_EXPIRED'));
  });
  it('denies guests and insurer staff across management routes', async () => {
    const key = slug();
    const { body: row } = await create(key).expect(201);
    await app.http.get(`${base}/admin`).expect(401);
    const insurer = await buildInsurer(app.db, { staff: { role: 'INSURER_ADMIN' } });
    const headers = await signIn(app.http, insurer.staff);
    await app.http.get(`${base}/admin`).set(headers).expect(403);
    await app.http.get(`${base}/admin/${key}/history`).set(headers).expect(403);
    await app.http.post(`${base}/admin/${key}/versions`).set(headers).send(draft({ expectedVersion: 1 })).expect(403);
    await app.http.post(`${base}/admin/${key}/versions/${row.id}/approve`).set(headers).expect(403);
    await app.http.post(`${base}/admin/${key}/versions/${row.id}/withdraw`).set(headers).send({ reason: 'No authority' }).expect(403);
  });
  it('rolls back the draft when its audit fails', async () => {
    const key = slug();
    vi.spyOn(app.app.get(AuditService), 'write').mockRejectedValueOnce(new Error('Audit unavailable'));
    await create(key).expect(500);
    const { body } = await app.http.get(`${base}/admin/${key}/history`).set(asMaker).expect(200);
    expect(body.items).toEqual([]);
    await create(key).expect(201);
  });
  it('serializes competing first drafts with an explicitly held transaction lock', async () => {
    const key = slug();
    const repo = app.app.get(CustomerContentRepository);
    const original = repo.lock.bind(repo);
    let unlock!: () => void;
    let entered!: () => void;
    let contender!: () => void;
    const held = new Promise<void>(resolve => { entered = resolve; });
    const release = new Promise<void>(resolve => { unlock = resolve; });
    const attempted = new Promise<void>(resolve => { contender = resolve; });
    let count = 0;
    vi.spyOn(repo, 'lock').mockImplementation(async (tx, target) => {
      if (target !== key) return original(tx, target);
      const invocation = ++count;
      if (invocation === 2) contender();
      const rows = await original(tx, target);
      if (invocation === 1) { entered(); await release; }
      return rows;
    });
    const first = create(key).then(response => response);
    let second: typeof first | undefined;
    try {
      await held;
      second = create(key).then(response => response);
      await attempted;
    } finally { unlock(); }
    const results = await Promise.all([first, second]);
    expect(results.map(response => response?.status ?? 0).sort((a, b) => a - b)).toEqual([201, 409]);
    const { body } = await app.http.get(`${base}/admin/${key}/history`).set(asMaker).expect(200);
    expect(body.items).toHaveLength(1);
  });
});
