import { eq } from 'drizzle-orm';
import { auditLogs, authSessions } from '../src/db/schema.js';
import { buildInsurer, buildStaffUser } from './builders.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

const STAFF = '/api/v1/staff';

describe('staff management', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const users = (session: SessionHeaders) => testApp.http.get(`${STAFF}/users`).set(session);

  it('keeps an insurer administrator inside their own organisation for users and teams', async () => {
    const own = await buildInsurer(testApp.db, { staff: { role: 'INSURER_ADMIN' } });
    const other = await buildInsurer(testApp.db, { staff: { role: 'INSURER_ADMIN' } });
    const asOwnAdmin = await signIn(testApp.http, own.staff);

    const listed = await users(asOwnAdmin).expect(200);
    expect(listed.body).toEqual([
      expect.objectContaining({ id: own.staff.id, insurerId: own.insurer.id }),
    ]);

    await testApp.http
      .post(`${STAFF}/teams`)
      .set(asOwnAdmin)
      .send({ insurerId: other.insurer.id, name: 'Underwriting', reason: 'Set up the underwriting team.' })
      .expect(403);

    await testApp.http
      .patch(`${STAFF}/users/${other.staff.id}`)
      .set(asOwnAdmin)
      .send({ isActive: false, reason: 'Attempted cross-insurer change.' })
      .expect(404);
  });

  it('revokes every active session when a staff account is deactivated and records the reason', async () => {
    const admin = await buildStaffUser(testApp.db, { role: 'SUPER_ADMIN' });
    const target = await buildInsurer(testApp.db, { staff: { role: 'QUOTE_OFFICER' } });
    const asAdmin = await signIn(testApp.http, admin);
    const asTarget = await signIn(testApp.http, target.staff);

    await testApp.http.get('/api/v1/auth/me').set(asTarget).expect(200);

    const update = await testApp.http
      .patch(`${STAFF}/users/${target.staff.id}`)
      .set(asAdmin)
      .send({ isActive: false, reason: 'The staff member has left the insurer.' })
      .expect(200);
    expect(update.body).toMatchObject({ id: target.staff.id, isActive: false });

    await testApp.http.get('/api/v1/auth/me').set(asTarget).expect(401);
    expect(await side.db.select().from(authSessions).where(eq(authSessions.userId, target.staff.userId ?? ''))).toEqual([]);

    const [audit] = await side.db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, target.staff.id))
      .orderBy(auditLogs.createdAt);
    expect(audit).toMatchObject({
      actorId: admin.id,
      action: 'staff.status_changed',
      entityType: 'STAFF_USER',
      entityId: target.staff.id,
      before: expect.objectContaining({ isActive: true }),
      after: expect.objectContaining({ isActive: false }),
      note: 'The staff member has left the insurer.',
    });
  });
});
