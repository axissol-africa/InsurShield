import { eq } from 'drizzle-orm';
import { piaConfig } from '../src/db/schema.js';
import { buildCustomer, buildInsurer, buildStaffUser } from './builders.js';
import { buildPiaConfig } from './builders/admin.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { bearer, customerToken, staffToken } from './jwks.js';

const ISO_MS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const PATH = '/api/v1/config/pia';

describe('PIA minimum rate', () => {
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

  const storedRow = async () => {
    const [row] = await side.db.select().from(piaConfig).where(eq(piaConfig.id, 'current'));
    return row;
  };

  const asAdmin = async (fullName = 'Admin Person') => {
    const staff = await buildStaffUser(testApp.db, { role: 'ADMIN', fullName });
    return bearer(await staffToken(staff, ['admin']));
  };

  it('answers the regulatory default when no rate is stored', async () => {
    await side.db.delete(piaConfig);

    const { body } = await testApp.http.get(PATH).expect(200);

    expect(body).toEqual({ piaRatePercentage: 4, lastUpdated: null, updatedBy: null });
  });

  it('sends the stored rate as a percentage with exactly the expected keys (T-HTTP1)', async () => {
    const staff = await buildStaffUser(testApp.db, { fullName: 'Lungu Mwale' });
    const updatedAt = new Date('2026-04-02T22:00:00.042Z');
    await buildPiaConfig(testApp.db, { piaRateBps: 525, updatedByStaffId: staff.id });
    await side.db.update(piaConfig).set({ updatedAt }).where(eq(piaConfig.id, 'current'));

    const { body } = await testApp.http.get(PATH).expect(200);

    expect(body).toEqual({ piaRatePercentage: 5.25, lastUpdated: '2026-04-02T22:00:00.042Z', updatedBy: 'Lungu Mwale' });
  });

  it('sends updatedBy null when no staff member is recorded', async () => {
    await buildPiaConfig(testApp.db, { piaRateBps: 1, updatedByStaffId: null });

    expect((await testApp.http.get(PATH).expect(200)).body).toMatchObject({ piaRatePercentage: 0.01, updatedBy: null });
  });

  it('creates the row when none exists, in basis points, naming who set it', async () => {
    await side.db.delete(piaConfig);

    const response = await testApp.http.put(PATH).set(await asAdmin('First Setter')).send({ piaRatePercentage: 4.75 }).expect(200);

    expect(response.body).toEqual({ piaRatePercentage: 4.75, lastUpdated: expect.stringMatching(ISO_MS), updatedBy: 'First Setter' });
    const row = await storedRow();
    expect(row.piaRateBps).toBe(475);
    expect(row.updatedAt.toISOString()).toBe(response.body.lastUpdated);
  });

  it('replaces the stored rate and advances updatedAt (T-AD3)', async () => {
    await buildPiaConfig(testApp.db, { piaRateBps: 400 });
    await side.db.update(piaConfig).set({ updatedAt: new Date('2026-01-01T00:00:00.000Z') }).where(eq(piaConfig.id, 'current'));

    const response = await testApp.http.put(PATH).set(await asAdmin('Second Setter')).send({ piaRatePercentage: 5 }).expect(200);

    expect(response.body).toMatchObject({ piaRatePercentage: 5, updatedBy: 'Second Setter' });
    const row = await storedRow();
    expect(row.piaRateBps).toBe(500);
    expect(row.updatedAt.getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime());
    expect(response.body.lastUpdated).toBe(row.updatedAt.toISOString());
    expect((await testApp.http.get(PATH).expect(200)).body).toEqual(response.body);
  });

  it.each([
    [0, 200],
    [100, 200],
    [12.34, 200],
  ])('accepts a rate of %s', async (piaRatePercentage, status) => {
    await testApp.http.put(PATH).set(await asAdmin()).send({ piaRatePercentage }).expect(status);
    expect((await storedRow()).piaRateBps).toBe(Math.round(piaRatePercentage * 100));
  });

  it.each([
    [-0.01, 'The PIA rate cannot be negative.'],
    [100.01, 'The PIA rate cannot exceed 100%.'],
  ])('refuses a rate of %s with its message', async (piaRatePercentage, message) => {
    const response = await testApp.http.put(PATH).set(await asAdmin()).send({ piaRatePercentage }).expect(400);

    expect(response.body).toEqual({
      code: 'VALIDATION_FAILED',
      message: 'Some of the details you entered need attention.',
      details: { fields: [message] },
    });
  });

  it.each([[5.255], ['5']])('refuses a rate of %j that is not a two-decimal number', async (piaRatePercentage) => {
    const response = await testApp.http.put(PATH).set(await asAdmin()).send({ piaRatePercentage }).expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
  });

  it('lets only administrators set the rate', async () => {
    const customer = await buildCustomer(testApp.db);
    const { staff } = await buildInsurer(testApp.db);
    await buildPiaConfig(testApp.db, { piaRateBps: 400 });

    await testApp.http.put(PATH).set(bearer(await customerToken(customer))).send({ piaRatePercentage: 1 }).expect(403);
    await testApp.http.put(PATH).set(bearer(await staffToken(staff, ['insurer_user']))).send({ piaRatePercentage: 1 }).expect(403);
    await testApp.http.put(PATH).send({ piaRatePercentage: 1 }).expect(401);

    expect((await storedRow()).piaRateBps).toBe(400);
  });
});
