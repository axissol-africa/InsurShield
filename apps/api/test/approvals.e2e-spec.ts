import { eq } from 'drizzle-orm';
import { approvalRequests, insurers, piaConfig } from '../src/db/schema.js';
import { buildInsurer, buildStaffUser } from './builders.js';
import { buildPiaConfig } from './builders/admin.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { signIn } from './sessions.js';

describe('two-person approval controls', () => {
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

  it('keeps a PIA change pending until a different administrator approves it', async () => {
    await buildPiaConfig(testApp.db, { piaRateBps: 400 });
    const maker = await buildStaffUser(testApp.db, { role: 'ADMIN', fullName: 'Maker Admin' });
    const checker = await buildStaffUser(testApp.db, { role: 'ADMIN', fullName: 'Checker Admin' });
    const makerSession = await signIn(testApp.http, maker);
    const checkerSession = await signIn(testApp.http, checker);

    const proposed = await testApp.http
      .put('/api/v1/config/pia')
      .set(makerSession)
      .send({ piaRatePercentage: 5.25 })
      .expect(200);

    expect(proposed.body).toMatchObject({
      action: 'PIA_FLOOR_CHANGE',
      status: 'PENDING',
      requestedByStaffId: maker.id,
      proposal: { piaRatePercentage: 5.25 },
    });
    expect((await side.db.select().from(piaConfig).where(eq(piaConfig.id, 'current')))[0].piaRateBps).toBe(400);

    const inbox = await testApp.http.get('/api/v1/admin/approvals').set(checkerSession).expect(200);
    expect(inbox.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: proposed.body.id, requestedByName: 'Maker Admin', status: 'PENDING' }),
    ]));

    await testApp.http
      .post(`/api/v1/admin/approvals/${proposed.body.id}/approve`)
      .set(makerSession)
      .send({ reason: 'I cannot review my own request.' })
      .expect(403);

    await testApp.http
      .post(`/api/v1/admin/approvals/${proposed.body.id}/approve`)
      .set(checkerSession)
      .send({ reason: 'Published floor confirmed.' })
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'EXECUTED', decidedByStaffId: checker.id }));

    expect((await side.db.select().from(piaConfig).where(eq(piaConfig.id, 'current')))[0].piaRateBps).toBe(525);

    const history = await testApp.http.get('/api/v1/admin/approvals').set(checkerSession).expect(200);
    expect(history.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: proposed.body.id, status: 'EXECUTED', proposal: { piaRatePercentage: 5.25 } }),
    ]));
  });

  it('records a rejection without changing the requested setting', async () => {
    await buildPiaConfig(testApp.db, { piaRateBps: 400 });
    const maker = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const checker = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const proposed = await testApp.http
      .put('/api/v1/config/pia')
      .set(await signIn(testApp.http, maker))
      .send({ piaRatePercentage: 5.5 })
      .expect(200);

    await testApp.http
      .post(`/api/v1/admin/approvals/${proposed.body.id}/reject`)
      .set(await signIn(testApp.http, checker))
      .send({ reason: 'The supporting review is incomplete.' })
      .expect(201)
      .expect(({ body }) => expect(body).toMatchObject({ status: 'REJECTED', decidedByStaffId: checker.id, executedAt: null }));

    expect((await side.db.select().from(piaConfig).where(eq(piaConfig.id, 'current')))[0].piaRateBps).toBe(400);
  });

  it('does not deactivate an insurer until an independent administrator decides the request', async () => {
    const maker = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const checker = await buildStaffUser(testApp.db, { role: 'ADMIN' });
    const { insurer } = await buildInsurer(testApp.db);
    const proposed = await testApp.http
      .patch(`/api/v1/insurers/${insurer.id}/status`)
      .set(await signIn(testApp.http, maker))
      .send({ status: 'INACTIVE' })
      .expect(200);

    expect(proposed.body).toMatchObject({ action: 'INSURER_DEACTIVATE', status: 'PENDING', targetId: insurer.id });
    expect((await side.db.select().from(insurers).where(eq(insurers.id, insurer.id)))[0].status).toBe('ACTIVE');

    await testApp.http
      .post(`/api/v1/admin/approvals/${proposed.body.id}/approve`)
      .set(await signIn(testApp.http, checker))
      .send({ reason: 'No new business while the information is reviewed.' })
      .expect(201);

    expect((await side.db.select().from(insurers).where(eq(insurers.id, insurer.id)))[0].status).toBe('INACTIVE');
    expect((await side.db.select().from(approvalRequests).where(eq(approvalRequests.id, proposed.body.id)))[0].status).toBe('EXECUTED');
  });
});
