import {
  addDays,
  canDecideNcd,
  ncdDecidedAt,
  newNcdCode,
} from './portal.js';

describe('quote validity', () => {
  it('adds whole days of 24 hours', () => {
    expect(addDays(new Date('2026-03-28T10:15:30.123Z'), 3).toISOString()).toBe('2026-03-31T10:15:30.123Z');
  });
});

describe('no-claim discount decisions', () => {
  it('refuses a new decision once the application is approved or rejected', () => {
    expect(canDecideNcd('APPROVED')).toBe(false);
    expect(canDecideNcd('REJECTED')).toBe(false);
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED'] as const) {
      expect(canDecideNcd(status)).toBe(true);
    }
  });

  it('records no decision time while the application is under review', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    expect(ncdDecidedAt('UNDER_REVIEW', now)).toBeNull();
    expect(ncdDecidedAt('VERIFICATION_REQUIRED', now)).toBeNull();
    expect(ncdDecidedAt('REJECTED', now)).toBe(now);
    expect(ncdDecidedAt('APPROVED', now)).toBe(now);
  });

  it('makes codes of twenty characters from digits and capital letters', () => {
    let next = 0;
    expect(newNcdCode(() => next++)).toBe('NCD-0123456789ABCDEFGHIJ');
    expect(newNcdCode((n) => n - 1)).toBe('NCD-ZZZZZZZZZZZZZZZZZZZZ');
  });
});
