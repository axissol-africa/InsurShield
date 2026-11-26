import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { SettingsService } from '../src/settings/settings.service.js';
import { auditLogs } from '../src/db/schema.js';
import { buildInsurer, buildStaffUser } from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

describe('versioned rule settings and comparison taxonomy', () => {
  let testApp: TestApp;
  let admin: Awaited<ReturnType<typeof buildStaffUser>>;
  let asAdmin: SessionHeaders;

  beforeAll(async () => {
    testApp = await startApp();
    admin = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    asAdmin = await signIn(testApp.http, admin);
  });

  afterAll(async () => testApp.close());

  it('keeps provisional rule values immutable, then records an auditable confirmed version', async () => {
    const effectiveFrom = '2026-11-01';
    const created = await testApp.http
      .post('/api/v1/admin/settings/rules/QUOTE_REPLY_DEADLINE/versions')
      .set(asAdmin)
      .send({ value: { days: 5 }, effectiveFrom, note: 'Initial launch deadline.' })
      .expect(201);
    expect(created.body).toMatchObject({ key: 'QUOTE_REPLY_DEADLINE', versionNumber: 1, state: 'PROVISIONAL', value: { days: 5 } });

    const confirmed = await testApp.http
      .post(`/api/v1/admin/settings/rules/QUOTE_REPLY_DEADLINE/versions/${created.body.id}/confirm`)
      .set(asAdmin)
      .expect(201);
    expect(confirmed.body).toMatchObject({ key: 'QUOTE_REPLY_DEADLINE', versionNumber: 2, state: 'CONFIRMED', value: { days: 5 }, confirmedByStaffId: admin.id });

    const history = await testApp.http.get('/api/v1/admin/settings/rules/QUOTE_REPLY_DEADLINE').set(asAdmin).expect(200);
    expect(history.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.body.id, state: 'PROVISIONAL' }),
      expect.objectContaining({ id: confirmed.body.id, state: 'CONFIRMED' }),
    ]));
    const events = await testApp.db.select().from(auditLogs).where(eq(auditLogs.entityId, confirmed.body.id));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'rule_version.confirmed', actorId: admin.id })]));
  });

  it('governs review policy defaults, validation, confirmation permissions and audited versions', async () => {
    const settings = testApp.app.get(SettingsService);
    const defaults = { submissionDays: 90, editDays: 30, appealDays: 30, appealDecisionDays: 14, privateRetentionDays: 365 };
    const before = new Date('2001-11-25T21:59:59Z');
    const effectiveAt = new Date('2001-11-25T22:00:00Z');
    expect(await settings.effective('REVIEW_POLICY', effectiveAt)).toEqual({ value: defaults, provisional: true, version: null });
    await testApp.http.post('/api/v1/admin/settings/rules/REVIEW_POLICY/versions').set(asAdmin)
      .send({ value: { ...defaults, privateRetentionDays: 0 }, effectiveFrom: '2001-11-26' })
      .expect(400).expect(({ body }) => expect(body.code).toBe('RULE_VALUE_INVALID'));
    const value = { ...defaults, privateRetentionDays: 730 };
    const created = await testApp.http.post('/api/v1/admin/settings/rules/REVIEW_POLICY/versions').set(asAdmin)
      .send({ value, effectiveFrom: '2001-11-26', effectiveUntil: '2001-11-26' }).expect(201);
    expect(created.body).toMatchObject({ key: 'REVIEW_POLICY', state: 'PROVISIONAL', value });
    expect(await settings.effective('REVIEW_POLICY', before)).toEqual({ value: defaults, provisional: true, version: null });
    expect(await settings.effective('REVIEW_POLICY', effectiveAt)).toEqual({ value, provisional: true, version: created.body.versionNumber });

    const insurer = await buildInsurer(testApp.db, { staff: { role: 'INSURER_ADMIN' } });
    const asInsurer = await signIn(testApp.http, insurer.staff);
    const confirmPath = `/api/v1/admin/settings/rules/REVIEW_POLICY/versions/${created.body.id}/confirm`;
    await testApp.http.post(confirmPath).set(asInsurer).expect(403);
    expect((await settings.effective('REVIEW_POLICY', effectiveAt)).provisional).toBe(true);
    const confirmed = await testApp.http.post(confirmPath).set(asAdmin).expect(201);
    expect(confirmed.body).toMatchObject({ state: 'CONFIRMED', value, confirmedByStaffId: admin.id });
    expect(await settings.effective('REVIEW_POLICY', effectiveAt)).toEqual({ value, provisional: false, version: confirmed.body.versionNumber });
    expect(await settings.effective('REVIEW_POLICY', new Date('2001-11-26T22:00:00Z'))).toEqual({ value: defaults, provisional: true, version: null });
    for (const [id, action] of [[created.body.id, 'rule_version.provisional_created'], [confirmed.body.id, 'rule_version.confirmed']]) {
      const events = await testApp.db.select().from(auditLogs).where(eq(auditLogs.entityId, id));
      expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ action, actorId: admin.id, correlationId: 'REVIEW_POLICY' })]));
    }
  });

  it('validates a structured taxonomy and lets administrators disable, rather than erase, historic terms', async () => {
    const code = `OWN_DAMAGE_${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`;
    const created = await testApp.http
      .post('/api/v1/admin/settings/comparison-taxonomy')
      .set(asAdmin)
      .send({
        code,
        label: 'Own damage',
        description: 'Repair or replacement of the insured vehicle.',
        category: 'COVERAGE',
        dataType: 'BOOLEAN',
        displayRule: 'ALWAYS_SHOW',
        displayOrder: 10,
      })
      .expect(201);
    expect(created.body).toMatchObject({
      code,
      status: 'ACTIVE',
      category: 'COVERAGE',
      dataType: 'BOOLEAN',
      displayRule: 'ALWAYS_SHOW',
      versionNumber: 1,
    });

    const disabled = await testApp.http
      .patch(`/api/v1/admin/settings/comparison-taxonomy/${created.body.id}`)
      .set(asAdmin)
      .send({ status: 'DISABLED' })
      .expect(200);
    expect(disabled.body).toMatchObject({ id: created.body.id, status: 'DISABLED', versionNumber: 2 });

    const all = await testApp.http.get('/api/v1/admin/settings/comparison-taxonomy').set(asAdmin).expect(200);
    expect(all.body).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.body.id, status: 'DISABLED' })]));
  });

  it('keeps the PIA floor on its existing maker-checker approval path', async () => {
    await testApp.http
      .post('/api/v1/admin/settings/rules/PIA_FLOOR/versions')
      .set(asAdmin)
      .send({ value: { rateBps: 450 }, effectiveFrom: '2026-11-01' })
      .expect(409)
      .expect(({ body }) => expect(body).toMatchObject({ code: 'PIA_FLOOR_REQUIRES_APPROVAL' }));
  });
});
