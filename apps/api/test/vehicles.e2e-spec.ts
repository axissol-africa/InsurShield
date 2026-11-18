import { randomBytes } from 'node:crypto';
import {
  buildCustomer,
  buildInsurer,
  buildInsurerQuote,
  buildPayment,
  buildPolicy,
  buildQuoteRequest,
  buildStaffUser,
  buildVehicle,
} from './builders.js';
import { startApp, type TestApp } from './helpers.js';
import { signIn, type SessionHeaders } from './sessions.js';

const LOOKUP_KEYS = [
  'chassisNumber',
  'color',
  'engineNumber',
  'make',
  'model',
  'plateNumber',
  'registrationDate',
  'rtsaAnniversaryDate',
  'source',
  'year',
];

const letters = (count: number) =>
  Array.from(randomBytes(count), (byte) => String.fromCharCode(65 + (byte % 26))).join('');

describe('GET /vehicles/lookup', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  const lookup = (plate: string, session?: SessionHeaders) => {
    const request = testApp.http.get('/api/v1/vehicles/lookup').query({ plate });
    return session ? request.set(session) : request;
  };

  it('requires manual entry from a guest, even when the plate is on the platform', async () => {
    const customer = await buildCustomer(testApp.db);
    const prefix = letters(4);
    const vehicle = await buildVehicle(testApp.db, {
      plateNumber: `${prefix} 4821`,
      make: 'Nissan',
      model: 'Navara',
      year: '2018',
      color: 'Silver',
      chassisNumber: 'CHASSIS-PRIVATE',
      engineNumber: 'ENGINE-PRIVATE',
    });
    await buildQuoteRequest(testApp.db, {
      customerId: customer.id,
      insurerIds: [],
      vehicleId: vehicle.id,
    });

    const response = await lookup(`${prefix} 4821`).expect(503);

    expect(response.body).toEqual({
      code: 'RTSA_LOOKUP_UNAVAILABLE',
      message: 'Vehicle lookup is not connected yet. Enter the vehicle details manually to continue.',
      details: { manualEntry: true },
    });
    // A public lookup never exposes a vehicle stored by another customer.
    expect(JSON.stringify(response.body)).not.toContain(vehicle.chassisNumber);
    expect(JSON.stringify(response.body)).not.toContain(vehicle.engineNumber);
  });

  it('returns the signed-in customer’s latest submitted matching vehicle', async () => {
    const customer = await buildCustomer(testApp.db);
    const prefix = letters(2);
    const plate = `${prefix} 7310`;
    const older = await buildVehicle(testApp.db, {
      plateNumber: plate,
      make: 'Older',
      chassisNumber: 'OLD-CHASSIS',
    });
    const latest = await buildVehicle(testApp.db, {
      plateNumber: `${prefix.toLowerCase()}\u00a073\ufeff10`,
      make: 'Latest',
      model: 'Hilux',
      year: '2025',
      color: 'Black',
      chassisNumber: 'LATEST-CHASSIS',
      engineNumber: 'LATEST-ENGINE',
    });
    await buildQuoteRequest(
      testApp.db,
      { customerId: customer.id, insurerIds: [], vehicleId: older.id },
      { submittedAt: new Date('2026-01-01T00:00:00.000Z') },
    );
    await buildQuoteRequest(
      testApp.db,
      { customerId: customer.id, insurerIds: [], vehicleId: latest.id },
      { submittedAt: new Date('2026-02-01T00:00:00.000Z') },
    );

    const response = await lookup(` ${prefix.toLowerCase()}  7310 `, await signIn(testApp.http, customer)).expect(200);

    expect(Object.keys(response.body).sort()).toEqual(LOOKUP_KEYS);
    expect(response.body).toMatchObject({
      plateNumber: latest.plateNumber,
      make: 'Latest',
      chassisNumber: 'LATEST-CHASSIS',
      engineNumber: 'LATEST-ENGINE',
      source: 'PLATFORM',
    });
  });

  it.each([' ', '  ', '\t', '\u00a0', '\ufeff'])(
    'matches a policy plate with internal whitespace %j without a vehicle request',
    async (spacing) => {
      const customer = await buildCustomer(testApp.db);
      const { insurer, staff } = await buildInsurer(testApp.db);
      const linkedRequest = await buildQuoteRequest(testApp.db, {
        customerId: customer.id,
        insurerIds: [insurer.id],
      });
      const { quote } = await buildInsurerQuote(testApp.db, {
        quoteRequestId: linkedRequest.quoteRequest.id,
        insurerId: insurer.id,
        staffId: staff.id,
      });
      const payment = await buildPayment(testApp.db, {
        customerId: customer.id,
        quoteRequestId: linkedRequest.quoteRequest.id,
        insurerQuoteId: quote.id,
      });
      const prefix = letters(2);
      const policyVehicle = await buildVehicle(testApp.db, {
        plateNumber: `${prefix}${spacing}60${spacing}42`,
        make: 'Mazda',
        model: 'BT-50',
        chassisNumber: 'POLICY-CHASSIS',
      });
      await buildPolicy(testApp.db, {
        insurerId: insurer.id,
        customerId: customer.id,
        vehicleId: policyVehicle.id,
        paymentId: payment.id,
      });

      const response = await lookup(`${prefix}6042`, await signIn(testApp.http, customer)).expect(200);

      expect(response.body).toMatchObject({
        plateNumber: policyVehicle.plateNumber,
        make: 'Mazda',
        chassisNumber: 'POLICY-CHASSIS',
        source: 'PLATFORM',
      });

      const otherCustomer = await buildCustomer(testApp.db);
      const otherResponse = await lookup(`${prefix}6042`, await signIn(testApp.http, otherCustomer)).expect(503);
      expect(otherResponse.body.code).toBe('RTSA_LOOKUP_UNAVAILABLE');
      expect(JSON.stringify(otherResponse.body)).not.toContain(policyVehicle.chassisNumber);
    },
  );

  it('requires manual entry for customers without the plate and for all staff', async () => {
    const owner = await buildCustomer(testApp.db);
    const otherCustomer = await buildCustomer(testApp.db);
    const staff = await buildStaffUser(testApp.db);
    const prefix = letters(2);
    const vehicle = await buildVehicle(testApp.db, {
      plateNumber: `${prefix} 5520`,
      chassisNumber: 'OWNER-CHASSIS',
      engineNumber: 'OWNER-ENGINE',
    });
    await buildQuoteRequest(testApp.db, {
      customerId: owner.id,
      insurerIds: [],
      vehicleId: vehicle.id,
    });

    for (const session of [await signIn(testApp.http, otherCustomer), await signIn(testApp.http, staff)]) {
      const response = await lookup(`${prefix} 5520`, session).expect(503);
      expect(response.body).toMatchObject({ code: 'RTSA_LOOKUP_UNAVAILABLE', details: { manualEntry: true } });
      expect(JSON.stringify(response.body)).not.toContain('OWNER-CHASSIS');
      expect(JSON.stringify(response.body)).not.toContain('OWNER-ENGINE');
    }
  });

  it('answers an unknown plate with the explicit manual-entry fallback', async () => {
    const prefix = letters(5);

    const response = await lookup(` ${prefix.toLowerCase()}9876 `).expect(503);

    expect(response.body).toMatchObject({ code: 'RTSA_LOOKUP_UNAVAILABLE', details: { manualEntry: true } });
  });

  it('keeps an unknown plate that is not letters then digits in its compact form', async () => {
    const prefix = letters(3);

    const response = await lookup(`${prefix.toLowerCase()} 12 x`).expect(503);

    expect(response.body).toMatchObject({ code: 'RTSA_LOOKUP_UNAVAILABLE', details: { manualEntry: true } });
  });

  it.each([['ab'], ['  a  '], ['']])('refuses the plate %j with 400 INVALID_PLATE', async (plate) => {
    const response = await lookup(plate).expect(400);

    expect(response.body).toEqual({
      code: 'INVALID_PLATE',
      message: 'Enter the vehicle’s licence plate number.',
      details: null,
    });
  });

  it('refuses a request without a plate with 400 INVALID_PLATE', async () => {
    const response = await testApp.http.get('/api/v1/vehicles/lookup').expect(400);

    expect(response.body).toMatchObject({ code: 'INVALID_PLATE' });
  });
});
