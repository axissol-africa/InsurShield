import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { auditLogs } from '../src/db/schema.js';
import { buildStaffUser } from './builders.js';
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
