import { badgeWindow, qualifies } from './badge.js';

describe('certificate badge evidence', () => {
  it('uses the exact ratio, including the threshold boundary', () => {
    expect(qualifies(30, 27, 30, 9000)).toBe(true);
    expect(qualifies(30, 26, 30, 9000)).toBe(false);
    expect(qualifies(10001, 9000, 30, 9000)).toBe(false);
    expect(qualifies(29, 29, 30, 9000)).toBe(false);
    expect(qualifies(0, 0, 30, 9000)).toBe(false);
  });
  it('freezes the configured rolling window and expiry', () => {
    const now = new Date('2026-11-26T12:00:00Z');
    expect(badgeWindow({ badgeWindowDays: 90, badgeMinimumPolicies: 30, badgeThresholdBps: 9000, badgeValidityHours: 48 }, now))
      .toEqual({ periodStart: new Date('2026-08-28T12:00:00Z'), periodEnd: now, expiresAt: new Date('2026-11-28T12:00:00Z') });
  });
});
