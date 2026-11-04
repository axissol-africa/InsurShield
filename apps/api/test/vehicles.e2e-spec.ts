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

  it('returns the registry stand-in to a guest, even when the plate is on the platform', async () => {
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
    await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [], vehicleId: vehicle.id });

    const response = await lookup(`${prefix} 4821`).expect(200);

    expect(Object.keys(response.body).sort()).toEqual(LOOKUP_KEYS);
    expect(response.body).toMatchObject({ plateNumber: `${prefix} 4821`, source: 'RTSA_STAND_IN' });
    expect(response.body.chassisNumber).not.toBe(vehicle.chassisNumber);
    expect(response.body.engineNumber).not.toBe(vehicle.engineNumber);
  });

  it('returns the signed-in customer’s latest submitted matching vehicle', async () => {
    const customer = await buildCustomer(testApp.db);
    const prefix = letters(4);
    const plate = `${prefix} 7310`;
    const older = await buildVehicle(testApp.db, { plateNumber: plate, make: 'Older', chassisNumber: 'OLD-CHASSIS' });
    const latest = await buildVehicle(testApp.db, {
      plateNumber: `${prefix.toLowerCase()}7310`,
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

  it('returns a customer’s policy vehicle even when no request refers to that vehicle', async () => {
    const customer = await buildCustomer(testApp.db);
    const { insurer, staff } = await buildInsurer(testApp.db);
    const linkedRequest = await buildQuoteRequest(testApp.db, { customerId: customer.id, insurerIds: [insurer.id] });
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
    const prefix = letters(4);
    const policyVehicle = await buildVehicle(testApp.db, {
      plateNumber: `${prefix} 6042`,
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
  });

  it('returns the registry stand-in to customers without the plate and to all staff', async () => {
    const owner = await buildCustomer(testApp.db);
    const otherCustomer = await buildCustomer(testApp.db);
    const staff = await buildStaffUser(testApp.db);
    const prefix = letters(4);
    const vehicle = await buildVehicle(testApp.db, {
      plateNumber: `${prefix} 5520`,
      chassisNumber: 'OWNER-CHASSIS',
      engineNumber: 'OWNER-ENGINE',
    });
    await buildQuoteRequest(testApp.db, { customerId: owner.id, insurerIds: [], vehicleId: vehicle.id });

    for (const session of [await signIn(testApp.http, otherCustomer), await signIn(testApp.http, staff)]) {
      const response = await lookup(`${prefix} 5520`, session).expect(200);
      expect(response.body).toMatchObject({ plateNumber: `${prefix} 5520`, source: 'RTSA_STAND_IN' });
      expect(response.body.chassisNumber).not.toBe('OWNER-CHASSIS');
      expect(response.body.engineNumber).not.toBe('OWNER-ENGINE');
    }
  });

  it('answers an unknown plate with the registry stand-in, the plate in display form and exact keys', async () => {
    const prefix = letters(5);

    const response = await lookup(` ${prefix.toLowerCase()}9876 `).expect(200);

    expect(Object.keys(response.body).sort()).toEqual(LOOKUP_KEYS);
    expect(response.body).toEqual({
      plateNumber: `${prefix} 9876`,
      make: 'Toyota',
      model: 'Hilux',
      year: '2020',
      color: 'White',
      chassisNumber: 'JTEH1234560012345',
      engineNumber: '2GD-FTV-12345',
      registrationDate: '2020-03-15',
      rtsaAnniversaryDate: '2023-10-31',
      source: 'RTSA_STAND_IN',
    });
  });

  it('keeps an unknown plate that is not letters then digits in its compact form', async () => {
    const prefix = letters(3);

    const response = await lookup(`${prefix.toLowerCase()} 12 x`).expect(200);

    expect(response.body).toMatchObject({ plateNumber: `${prefix}12X`, source: 'RTSA_STAND_IN' });
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
