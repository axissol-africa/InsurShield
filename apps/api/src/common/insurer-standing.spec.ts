import { describe, expect, it } from 'vitest';
import { licenceValid, servicesExistingBusiness, takesNewBusiness } from './insurer-standing.js';

// A licence recorded as expiring on 10 November, the way the DTO stores a date-only value.
const EXPIRES_10_NOV = new Date('2026-11-10T00:00:00.000Z');

describe('licenceValid', () => {
  it('holds for the whole of the day the licence expires, in Lusaka', () => {
    // 21:00 UTC is 23:00 on the 10th in Lusaka: the last hour of the licence.
    expect(licenceValid(EXPIRES_10_NOV, new Date('2026-11-10T21:00:00.000Z'))).toBe(true);
    expect(licenceValid(EXPIRES_10_NOV, new Date('2026-11-10T06:00:00.000Z'))).toBe(true);
  });

  it('lapses at Lusaka midnight, not two hours later at UTC midnight', () => {
    // 22:00 UTC on the 10th is 00:00 on the 11th in Lusaka. A UTC day would
    // still have honoured the licence here, for two hours of trading.
    expect(licenceValid(EXPIRES_10_NOV, new Date('2026-11-10T22:00:00.000Z'))).toBe(false);
    expect(licenceValid(EXPIRES_10_NOV, new Date('2026-11-11T12:00:00.000Z'))).toBe(false);
  });

  it('reads an expiry recorded with a Lusaka offset as that Lusaka day', () => {
    // The DTO accepts an offset, so midnight Lusaka on the 10th stores as 22:00
    // UTC on the 9th. Comparing Lusaka days keeps that the 10th, not the 9th.
    const lusakaMidnight = new Date('2026-11-10T00:00:00.000+02:00');
    expect(licenceValid(lusakaMidnight, new Date('2026-11-10T06:00:00.000Z'))).toBe(true);
    expect(licenceValid(lusakaMidnight, new Date('2026-11-10T22:00:00.000Z'))).toBe(false);
  });

  it('treats a licence nobody recorded as current, because no insurer row carries one yet', () => {
    expect(licenceValid(null, new Date('2026-11-10T12:00:00.000Z'))).toBe(true);
  });
});

describe('takesNewBusiness', () => {
  const noon = new Date('2026-11-10T12:00:00.000Z');

  it('admits an active insurer whose licence is current', () => {
    expect(takesNewBusiness({ status: 'ACTIVE', licenceExpiry: null }, noon)).toBe(true);
    expect(takesNewBusiness({ status: 'ACTIVE', licenceExpiry: EXPIRES_10_NOV }, noon)).toBe(true);
  });

  it('refuses an active insurer whose licence has lapsed', () => {
    expect(takesNewBusiness({ status: 'ACTIVE', licenceExpiry: new Date('2026-11-09') }, noon)).toBe(false);
  });

  it('refuses a deactivated or removed insurer however current its licence', () => {
    expect(takesNewBusiness({ status: 'INACTIVE', licenceExpiry: null }, noon)).toBe(false);
    expect(takesNewBusiness({ status: 'DELETED', licenceExpiry: new Date('2099-01-01') }, noon)).toBe(false);
  });
});

describe('servicesExistingBusiness', () => {
  it('keeps servicing an insurer that may no longer sell, whatever its licence says', () => {
    expect(servicesExistingBusiness({ status: 'ACTIVE', licenceExpiry: null })).toBe(true);
    expect(servicesExistingBusiness({ status: 'INACTIVE', licenceExpiry: new Date('2020-01-01') })).toBe(true);
  });

  it('stops only once the insurer is removed', () => {
    expect(servicesExistingBusiness({ status: 'DELETED', licenceExpiry: null })).toBe(false);
  });
});
