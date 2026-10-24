import { randomBytes } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { vehicles } from '../src/db/schema.js';
import { buildVehicle } from './builders.js';
import { startApp, type TestApp } from './helpers.js';

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

const minutesFromNow = (minutes: number) => new Date(Date.now() + minutes * 60_000);

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

  const lookup = (plate: string) => testApp.http.get('/api/v1/vehicles/lookup').query({ plate });

  it('answers a plate already on the platform from its record, with the stored values and exact keys', async () => {
    const prefix = letters(4);
    const vehicle = await buildVehicle(testApp.db, {
      plateNumber: `${prefix} 4821`,
      make: 'Nissan',
      model: 'Navara',
      year: '2018',
      color: 'Silver',
      chassisNumber: 'CH-123',
      engineNumber: 'EN-456',
      registrationDate: new Date('2018-04-05T10:11:12.345Z'),
      rtsaAnniversaryDate: null,
    });

    const response = await lookup(`${prefix} 4821`).expect(200);

    expect(Object.keys(response.body).sort()).toEqual(LOOKUP_KEYS);
    expect(response.body).toEqual({
      plateNumber: vehicle.plateNumber,
      make: 'Nissan',
      model: 'Navara',
      year: '2018',
      color: 'Silver',
      chassisNumber: 'CH-123',
      engineNumber: 'EN-456',
      registrationDate: '2018-04-05T10:11:12.345Z',
      rtsaAnniversaryDate: null,
      source: 'PLATFORM',
    });
  });

  it('matches a plate whatever its letter case and spacing', async () => {
    const prefix = letters(4);
    await buildVehicle(testApp.db, { plateNumber: `${prefix} 7310` });

    for (const typed of [prefix.toLowerCase() + '7310', ` ${prefix.toLowerCase()}  7310 `, `${prefix[0]} ${prefix.slice(1)} 73 10`]) {
      const response = await lookup(typed).expect(200);
      expect(response.body).toMatchObject({ plateNumber: `${prefix} 7310`, source: 'PLATFORM' });
    }
  });

  it('matches a stored plate written in lower case or without its space', async () => {
    const prefix = letters(4);
    await buildVehicle(testApp.db, { plateNumber: `${prefix.toLowerCase()}5520` });

    const response = await lookup(`${prefix} 5520`).expect(200);

    expect(response.body).toMatchObject({ plateNumber: `${prefix.toLowerCase()}5520`, source: 'PLATFORM' });
  });

  it('answers the most recently updated of two records for one plate', async () => {
    const prefix = letters(4);
    await buildVehicle(testApp.db, { plateNumber: `${prefix} 1001`, make: 'Older', updatedAt: minutesFromNow(1) });
    await buildVehicle(testApp.db, { plateNumber: `${prefix}1001`, make: 'Newer', updatedAt: minutesFromNow(2) });

    const response = await lookup(`${prefix}1001`).expect(200);

    expect(response.body).toMatchObject({ make: 'Newer', source: 'PLATFORM' });
  });

  it('searches only the 50 most recently updated vehicles, and answers the stand-in for a plate beyond them', async () => {
    const prefix = letters(4);
    const known = await buildVehicle(testApp.db, { plateNumber: `${prefix} 9090`, make: 'Mazda', updatedAt: minutesFromNow(60) });
    const later: string[] = [];
    const updateAnother = async (index: number) => {
      const vehicle = await buildVehicle(testApp.db, { plateNumber: `${letters(4)} ${index}`, updatedAt: minutesFromNow(120) });
      later.push(vehicle.id);
    };
    try {
      for (let index = 0; index < 49; index += 1) await updateAnother(index);

      const fiftieth = await lookup(`${prefix}9090`).expect(200);
      expect(fiftieth.body).toMatchObject({ plateNumber: `${prefix} 9090`, make: 'Mazda', source: 'PLATFORM' });

      await updateAnother(49);

      const beyond = await lookup(`${prefix}9090`).expect(200);
      expect(beyond.body).toMatchObject({
        plateNumber: `${prefix} 9090`,
        make: 'Toyota',
        chassisNumber: 'JTEH1234560012345',
        source: 'RTSA_STAND_IN',
      });
    } finally {
      await testApp.db.delete(vehicles).where(inArray(vehicles.id, [known.id, ...later]));
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
