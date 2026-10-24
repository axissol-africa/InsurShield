import {
  addDays,
  canDecideNcd,
  ncdDecidedAt,
  ncdPercentage,
  newNcdCode,
} from './portal.js';

describe('quote validity', () => {
  it('adds whole days of 24 hours', () => {
    expect(addDays(new Date('2026-03-28T10:15:30.123Z'), 3).toISOString()).toBe('2026-03-31T10:15:30.123Z');
  });
});

describe('no-claim discount decisions', () => {
  it.each([
    [0, 0],
    [1, 10],
    [3, 30],
    [5, 50],
    [9, 50],
  ])('gives %i claim-free years %i%%', (years, percentage) => {
    expect(ncdPercentage(years)).toBe(percentage);
  });

  it('uses the percentage the insurer chose when there is one', () => {
    expect(ncdPercentage(4, 15)).toBe(15);
    expect(ncdPercentage(4, 0)).toBe(0);
  });

  it('refuses a new decision only once the application is approved', () => {
    expect(canDecideNcd('APPROVED')).toBe(false);
    for (const status of ['SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'REJECTED'] as const) {
      expect(canDecideNcd(status)).toBe(true);
    }
  });

  it('records no decision time while the application is under review', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    expect(ncdDecidedAt('UNDER_REVIEW', now)).toBeNull();
    expect(ncdDecidedAt('REJECTED', now)).toBe(now);
    expect(ncdDecidedAt('APPROVED', now)).toBe(now);
  });

  it('makes codes of five characters from digits and capital letters', () => {
    let next = 0;
    expect(newNcdCode(() => next++)).toBe('NCD-01234');
    expect(newNcdCode((n) => n - 1)).toBe('NCD-ZZZZZ');
  });
});
