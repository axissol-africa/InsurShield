import { isRequestOpen } from '../../common/domain/quote-request.js';
import { daysUntil, renewalState, renewalWindow } from './renewal.js';

const DAY_MS = 86_400_000;
const now = new Date('2026-10-24T10:00:00.000Z');
const inDays = (days: number) => new Date(now.getTime() + days * DAY_MS);

describe('renewal', () => {
  it('marks a policy far from expiry as not yet due, but still renewable', () => {
    const state = renewalState(inDays(200), [], now);

    expect(state.window).toBe('NOT_DUE');
    expect(state.daysRemaining).toBe(200);
    expect(state.renewable).toBe(true);
  });

  it('marks a policy inside the window as due', () => {
    const state = renewalState(inDays(30), [], now);

    expect(state.window).toBe('DUE');
    expect(state.daysRemaining).toBe(30);
  });

  it('marks a lapsed policy as expired and still lets it be renewed', () => {
    const state = renewalState(inDays(-9), [], now);

    expect(state.window).toBe('EXPIRED');
    expect(state.daysRemaining).toBe(-9);
    expect(state.renewable).toBe(true);
  });

  it('treats the last day of cover as still in force, not expired', () => {
    const state = renewalState(inDays(0), [], now);

    expect(state.daysRemaining).toBe(0);
    expect(state.window).toBe('DUE');
  });

  it('opens the window exactly sixty days out', () => {
    expect(renewalWindow(61)).toBe('NOT_DUE');
    expect(renewalWindow(60)).toBe('DUE');
    expect(renewalWindow(null)).toBe('NOT_DUE');
  });

  it('knows nothing about the date when a policy has no end date', () => {
    const state = renewalState(null, [], now);

    expect(state).toEqual({ window: 'NOT_DUE', daysRemaining: null, endDate: null, renewable: true, renewalRequestId: null });
  });

  it('reports a renewal already in flight instead of offering another', () => {
    const state = renewalState(inDays(65), [{ id: 'QR-9', status: 'SUBMITTED', expiresAt: inDays(5) }], now);

    expect(state.renewable).toBe(false);
    expect(state.renewalRequestId).toBe('QR-9');
    expect(state.endDate).toBe(inDays(65).toISOString());
  });

  it('offers renewal again once the previous renewal request has lapsed', () => {
    const lapsed = [
      { id: 'QR-9', status: 'EXPIRED' as const, expiresAt: inDays(-1) },
      { id: 'QR-8', status: 'SUBMITTED' as const, expiresAt: inDays(-2) },
    ];
    const state = renewalState(inDays(65), lapsed, now);

    expect(state.renewable).toBe(true);
    expect(state.renewalRequestId).toBeNull();
    expect(lapsed.map((request) => isRequestOpen(request.status, request.expiresAt, now))).toEqual([false, false]);
  });

  it('counts calendar days, not elapsed hours', () => {
    const lateTonight = new Date(now);
    lateTonight.setHours(23, 59, 0, 0);
    const earlyTomorrow = new Date(lateTonight.getTime() + 2 * 60_000);

    expect(daysUntil(earlyTomorrow, lateTonight)).toBe(1);
  });
});
