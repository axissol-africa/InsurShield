import { addDays, coverPeriod } from './cover-period.js';

describe('coverPeriod', () => {
  const now = new Date('2026-10-24T10:00:00.000Z');

  it('takes the dates the client sent and counts the days between them', () => {
    const period = coverPeriod({ startDate: '2026-11-01T00:00:00.000Z', endDate: '2027-05-01T00:00:00.000Z' }, 'Q4', now);

    expect(period.startDate.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect(period.endDate.toISOString()).toBe('2027-05-01T00:00:00.000Z');
    expect(period.days).toBe(181);
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

  it('never reports fewer than one day', () => {
    const period = coverPeriod({ startDate: '2026-11-01T00:00:00.000Z', endDate: '2026-11-01T00:00:00.000Z' }, 'Q1', now);

    expect(period.days).toBe(1);
  });

  it('adds whole days', () => {
    expect(addDays(now, 7).toISOString()).toBe('2026-10-31T10:00:00.000Z');
  });
});
