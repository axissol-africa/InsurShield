import { isRequestOpen } from './quote-request.js';

describe('an open quote request', () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  const later = new Date(now.getTime() + 1);

  it('is open before its expiry instant', () => {
    expect(isRequestOpen('SUBMITTED', later, now)).toBe(true);
    expect(isRequestOpen('QUOTED', later, now)).toBe(true);
  });

  it('is closed at its expiry instant', () => {
    expect(isRequestOpen('SUBMITTED', new Date(now), now)).toBe(false);
  });

  it('is closed once marked expired, whatever its expiry', () => {
    expect(isRequestOpen('EXPIRED', later, now)).toBe(false);
  });
});
