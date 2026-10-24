import { ncdCodeRefusal, normaliseNcdCode } from './ncd-code.js';

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
  });

  it('reports a redeemed code as used even when it has also expired', () => {
    expect(ncdCodeRefusal({ redeemedAt: now, expiresAt: now }, now)).toBe('ALREADY_USED');
  });
});
