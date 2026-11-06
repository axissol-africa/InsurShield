import { addDays, coverPeriod, rtsaAnniversaryStart } from './cover-period.js';

describe('coverPeriod', () => {
  const now = new Date('2026-10-24T10:00:00.000Z');

  it('uses the requested start date but derives the end date from the chosen cover duration', () => {
    const period = coverPeriod({ startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-05-01T00:00:00.000Z' }, 'Q4', now);

    expect(period.startDate.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(period.endDate.toISOString()).toBe('2027-11-01T00:00:00.000Z');
    expect(period.days).toBe(365);
  });

  it('starts now and runs the duration’s quarters when the client sent no dates', () => {
    const period = coverPeriod(undefined, 'Q1', now);

    expect(period.startDate).toEqual(now);
    expect(period.endDate.getTime()).toBeGreaterThan(now.getTime());
    expect(period.days).toBeGreaterThanOrEqual(89);
    expect(period.days).toBeLessThanOrEqual(92);
  });

  it('runs four quarters for a year of cover', () => {
    const period = coverPeriod(undefined, 'Q4', now);

    expect(period.days).toBeGreaterThanOrEqual(365);
    expect(period.days).toBeLessThanOrEqual(366);
  });

  it('does not let a same-day client end date shorten cover', () => {
    const period = coverPeriod({ startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-01T00:00:00.000Z' }, 'Q1', now);

    expect(period.endDate.toISOString()).toBe('2027-02-01T00:00:00.000Z');
    expect(period.days).toBe(92);
  });

  it('adds whole days', () => {
    expect(addDays(now, 7).toISOString()).toBe('2026-10-31T10:00:00.000Z');
  });

  it('uses this year’s RTSA anniversary day and month for an aligned policy', () => {
    const anniversary = rtsaAnniversaryStart('2023-10-31T00:00:00.000Z', now);
    const period = coverPeriod({ startDate: anniversary.toISOString(), endDate: '2099-01-01T00:00:00.000Z' }, 'Q1', now);

    expect(anniversary.toISOString()).toBe('2026-10-31T00:00:00.000Z');
    expect(period.endDate.toISOString()).toBe('2027-01-31T00:00:00.000Z');
    expect(period.days).toBe(92);
  });

  it('clamps a leap-day RTSA anniversary in a non-leap policy year', () => {
    expect(rtsaAnniversaryStart('2024-02-29T00:00:00.000Z', now).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });
});
