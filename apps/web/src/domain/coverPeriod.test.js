import { describe, expect, it } from 'vitest';
import { coverPeriod, coverPeriodLabel } from './coverPeriod';

describe('coverPeriod', () => {
  it('uses the dates already formatted while the customer is choosing', () => {
    const period = coverPeriod({ formattedStart: '10 Sep 2026', formattedEnd: '10 Dec 2026', daysTotal: 91 });
    expect(period).toMatchObject({ start: '10 Sep 2026', end: '10 Dec 2026', days: 91, known: true });
  });

  it('formats the ISO dates the API returns', () => {
    const period = coverPeriod({ startDate: '2026-09-10T00:00:00.000Z', endDate: '2026-12-10T00:00:00.000Z', daysTotal: 91 });
    expect(period.start).toMatch(/2026/);
    expect(period.end).toMatch(/2026/);
    expect(period.known).toBe(true);
  });

  it('says nothing rather than something wrong when the period is not set', () => {
    for (const value of [null, undefined, {}, { daysTotal: 365 }]) {
      const period = coverPeriod(value);
      expect(period).toMatchObject({ start: '—', end: '—', known: false });
      expect(coverPeriodLabel(value)).toBe('—');
    }
  });

  it('joins a known period into one label', () => {
    expect(coverPeriodLabel({ formattedStart: '10 Sep 2026', formattedEnd: '10 Dec 2026' })).toBe('10 Sep 2026 – 10 Dec 2026');
  });
});
