import { ncdCodeRefusal, ncdVehicleMatches, normaliseNcdCode } from './ncd-code.js';

describe('NCD codes', () => {
  const now = new Date('2026-10-24T10:00:00.000Z');
  const later = new Date('2026-10-25T10:00:00.000Z');

  it('stores codes upper-case without surrounding spaces', () => {
    expect(normaliseNcdCode(' ncd-abc123 ')).toBe('NCD-ABC123');
  });

  it('accepts a code that is neither redeemed nor expired', () => {
    expect(ncdCodeRefusal({ redeemedAt: null, expiresAt: later }, now)).toBeNull();
    expect(ncdCodeRefusal({ redeemedAt: null, expiresAt: null }, now)).toBeNull();
  });

  it('says why a code cannot be used', () => {
    expect(ncdCodeRefusal(undefined, now)).toBe('NOT_FOUND');
    expect(ncdCodeRefusal({ redeemedAt: now, expiresAt: later }, now)).toBe('ALREADY_USED');
    expect(ncdCodeRefusal({ redeemedAt: null, expiresAt: now }, now)).toBe('EXPIRED');
    expect(ncdCodeRefusal({ redeemedAt: null, expiresAt: later, revokedAt: now }, now)).toBe('REVOKED');
  });

  it('matches separate snapshots by plate and chassis while refusing missing or conflicting identity', () => {
    const source = { plateNumber: 'BAA 1234', chassisNumber: 'ABC123', registrationCountry: null };
    expect(ncdVehicleMatches(source, { plateNumber: 'baa1234', chassisNumber: 'abc 123', registrationCountry: 'Zambia' })).toBe(true);
    expect(ncdVehicleMatches(source, { ...source, chassisNumber: '' })).toBe(false);
    expect(ncdVehicleMatches(source, { ...source, plateNumber: 'BAA 2222' })).toBe(false);
    expect(ncdVehicleMatches(source, { ...source, registrationCountry: 'Zimbabwe' })).toBe(false);
  });

  it('reports a redeemed code as used even when it has also expired', () => {
    expect(ncdCodeRefusal({ redeemedAt: now, expiresAt: now }, now)).toBe('ALREADY_USED');
  });
});
