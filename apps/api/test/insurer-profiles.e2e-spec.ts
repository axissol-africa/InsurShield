import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { AuditService } from '../src/common/audit/audit.service.js';
import { auditLogs, insurerProfileDecisions, insurerProfileRevisions, insurers } from '../src/db/schema.js';
import { InsurerProfilesRepository } from '../src/insurer-profiles/insurer-profiles.repository.js';
import { buildInsurer, buildStaffUser } from './builders.js';
import { buildInsurerProfileProducts } from './builders/insurer-profiles.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

const content = (brandName = 'Approved brand') => ({ brandName, description: 'Public description', serviceInformation: 'Contact our service desk', contactEmail: 'public@example.com' });
const ownPath = '/api/v1/insurer/profile/revisions';
const publicPath = (id: string) => `/api/v1/insurer-profiles/${id}`;
const decisionPath = (id: string, revisionId: string) => `/api/v1/admin/insurer-profiles/${id}/revisions/${revisionId}/decision`;

describe('insurer-profiles approved revision lifecycle', () => {
  let app: TestApp;
  let admin: SessionHeaders;
  beforeAll(async () => {
    app = await startApp();
    admin = await signIn(app.http, await buildStaffUser(app.db, { role: 'ADMIN' }));
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => { if (app) await app.close(); });

  async function owner() {
    const built = await buildInsurer(app.db, { staff: { role: 'INSURER_ADMIN' } });
    return { ...built, headers: await signIn(app.http, built.staff) };
  }
  const submit = (headers: SessionHeaders, brandName?: string) => app.http.post(ownPath).set(headers).send(content(brandName));
  const decide = (id: string, revisionId: string, decision = 'APPROVE') => app.http.post(decisionPath(id, revisionId)).set(admin).send({ decision, reason: 'Checked public details' });

  it('publishes only an explicit approved revision and keeps it visible during replacement review', async () => {
    const built = await owner();
    const first = await submit(built.headers).expect(201);
    await app.http.get(publicPath(built.insurer.id)).expect(404);
    await decide(built.insurer.id, first.body.id).expect(200);
    const pending = await submit(built.headers, 'PRIVATE pending brand').expect(201);
    const visible = await app.http.get(publicPath(built.insurer.id)).expect(200);
    expect(visible.body.profile.brandName).toBe('Approved brand');
    expect(Object.keys(visible.body).sort()).toEqual(['insurerId', 'licence', 'name', 'products', 'productsTruncated', 'profile', 'revisionId', 'status', 'tradingName'].sort());
    expect(JSON.stringify(visible.body)).not.toContain('PRIVATE');
    expect(JSON.stringify(visible.body)).not.toContain(built.staff.id);
    await submit(built.headers).expect(409);
    await decide(built.insurer.id, pending.body.id, 'REJECT').expect(200);
    expect((await app.http.get(publicPath(built.insurer.id)).expect(200)).body.revisionId).toBe(first.body.id);
    const replacement = await submit(built.headers, 'Replacement approved').expect(201);
    await decide(built.insurer.id, replacement.body.id).expect(200);
    expect((await app.http.get(publicPath(built.insurer.id)).expect(200)).body.revisionId).toBe(replacement.body.id);
    await decide(built.insurer.id, first.body.id).expect(409);
    const history = await app.http.get(ownPath).set(built.headers).query({ limit: 2 }).expect(200);
    expect(history.body.map((row: { status: string }) => row.status)).toEqual(['APPROVED', 'REJECTED']);
    expect((await app.http.get(ownPath).set(built.headers).query({ beforeVersion: 2 }).expect(200)).body[0].status).toBe('SUPERSEDED');
    const audits = await app.db.select().from(auditLogs).where(eq(auditLogs.entityId, built.insurer.id));
    expect(audits.filter((row) => row.action === 'insurer_profile.decided')).toHaveLength(3);
    expect(JSON.stringify(audits)).not.toContain('Public description');
    expect(JSON.stringify(audits)).not.toContain('Checked public details');
  });

  it('enforces roles, tenant ownership, validation and explicit decision reasons', async () => {
    const first = await owner();
    const other = await owner();
    const revision = await submit(first.headers).expect(201);
    await app.http.post(decisionPath(first.insurer.id, revision.body.id)).set(first.headers).send({ decision: 'APPROVE', reason: 'No' }).expect(403);
    await decide(other.insurer.id, revision.body.id).expect(404);
    expect((await app.http.get(ownPath).set(other.headers).expect(200)).body).toEqual([]);
    const support = await buildStaffUser(app.db, { role: 'SUPPORT', insurerId: first.insurer.id });
    await submit(await signIn(app.http, support)).expect(403);
    await app.http.post(ownPath).set(other.headers).send({ ...content(), insurerId: first.insurer.id }).expect(400);
    await app.http.post(ownPath).set(other.headers).send({ ...content(), websiteUrl: 'javascript:alert(1)' }).expect(400);
    await app.http.post(decisionPath(first.insurer.id, revision.body.id)).set(admin).send({ decision: 'APPROVE', reason: ' ' }).expect(400);
    await app.http.get(publicPath('not-a-uuid')).expect(400);
    await app.http.get(publicPath(randomUUID())).expect(404);
    await app.http.post(ownPath).send(content()).expect(401);
  });

  it('joins canonical licence and published products without pending product content', async () => {
    const built = await owner();
    const revision = await submit(built.headers).expect(201);
    await decide(built.insurer.id, revision.body.id).expect(200);
    expect((await app.http.get(publicPath(built.insurer.id)).expect(200)).body.licence.current).toBe(false);
    const { approved } = await buildInsurerProfileProducts(app.db, built);
    await app.db.update(insurers).set({ licenceNumber: 'CANONICAL-123' }).where(eq(insurers.id, built.insurer.id));
    const response = await app.http.get(publicPath(built.insurer.id)).expect(200);
    expect(response.body.licence).toMatchObject({ number: 'CANONICAL-123', current: true });
    expect(response.body.products).toHaveLength(1);
    expect(response.body.products[0].versionId).toBe(approved.id);
    expect(JSON.stringify(response.body)).not.toContain('Private product replacement');
    await app.db.update(insurers).set({ licenceExpiry: new Date('2020-01-01') }).where(eq(insurers.id, built.insurer.id));
    const expired = await app.http.get(publicPath(built.insurer.id)).expect(200);
    expect(expired.body.licence.current).toBe(false);
    expect(expired.body.products).toEqual([]);
  });

  it('retains suspended profiles with no available products and hides deleted insurers', async () => {
    const built = await owner();
    const revision = await submit(built.headers).expect(201);
    await decide(built.insurer.id, revision.body.id).expect(200);
    await app.db.update(insurers).set({ status: 'SUSPENDED' }).where(eq(insurers.id, built.insurer.id));
    expect((await app.http.get(publicPath(built.insurer.id)).expect(200)).body.products).toEqual([]);
    await app.db.update(insurers).set({ deletedAt: new Date() }).where(eq(insurers.id, built.insurer.id));
    await app.http.get(publicPath(built.insurer.id)).expect(404);
    await submit(built.headers).expect(404);
  });

  it('rolls back publication and its decision if audit persistence fails', async () => {
    const built = await owner();
    const revision = await submit(built.headers).expect(201);
    vi.spyOn(app.app.get(AuditService), 'write').mockRejectedValueOnce(new Error('Audit unavailable'));
    await decide(built.insurer.id, revision.body.id).expect(500);
    expect((await app.db.select().from(insurerProfileRevisions).where(eq(insurerProfileRevisions.id, revision.body.id)))[0].status).toBe('PENDING');
    expect(await app.db.select().from(insurerProfileDecisions).where(eq(insurerProfileDecisions.revisionId, revision.body.id))).toEqual([]);
    await decide(built.insurer.id, revision.body.id).expect(200);
  });

  it('serializes simultaneous first submissions and preserves a single pending revision', async () => {
    const built = await owner();
    const repository = app.app.get(InsurerProfilesRepository);
    const originalSubmit = repository.submit.bind(repository);
    let entered!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(repository, 'submit').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return originalSubmit(...args);
    });
    const first = submit(built.headers, 'First submission').then((response) => response);
    await locked;
    let attemptingLock!: () => void;
    const attempted = new Promise<void>((resolve) => { attemptingLock = resolve; });
    const originalInsurer = repository.insurer.bind(repository);
    vi.spyOn(repository, 'insurer').mockImplementationOnce((...args) => {
      const waiting = originalInsurer(...args);
      attemptingLock();
      return waiting;
    });
    const second = submit(built.headers, 'Competing submission').then((response) => response);
    await attempted;
    release();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([201, 409]);
    const revisions = await app.db.select().from(insurerProfileRevisions).where(eq(insurerProfileRevisions.insurerId, built.insurer.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ versionNumber: 1, status: 'PENDING', brandName: 'First submission' });
  });

  it('serializes competing decisions on the insurer lock with only one durable decision', async () => {
    const built = await owner();
    const revision = await submit(built.headers).expect(201);
    const repository = app.app.get(InsurerProfilesRepository);
    const original = repository.transition.bind(repository);
    let entered!: () => void;
    let release!: () => void;
    const locked = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.spyOn(repository, 'transition').mockImplementationOnce(async (...args) => {
      entered();
      await gate;
      return original(...args);
    });
    const first = decide(built.insurer.id, revision.body.id).then((response) => response);
    await locked;
    let attemptingLock!: () => void;
    const attempted = new Promise<void>((resolve) => { attemptingLock = resolve; });
    const originalInsurer = repository.insurer.bind(repository);
    vi.spyOn(repository, 'insurer').mockImplementationOnce((...args) => {
      const waiting = originalInsurer(...args);
      attemptingLock();
      return waiting;
    });
    const second = decide(built.insurer.id, revision.body.id, 'REJECT').then((response) => response);
    await attempted;
    release();
    const responses = await Promise.all([first, second]);
    expect(responses.map((response) => response.status)).toEqual([200, 409]);
    expect(await app.db.select().from(insurerProfileDecisions).where(eq(insurerProfileDecisions.revisionId, revision.body.id))).toHaveLength(1);
  });
});
