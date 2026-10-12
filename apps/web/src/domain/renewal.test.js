import { describe, expect, it } from 'vitest';
import { byRenewalUrgency, daysUntil, renewalLabel, renewalState } from './renewal';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-09-25T09:00:00.000Z');
const inDays = (days) => new Date(NOW.getTime() + days * DAY_MS).toISOString();

const policy = (days) => ({ policyDates: { endDate: inDays(days) } });

describe('renewal state', () => {
  it('counts calendar days, so cover ending later today reads as zero days left', () => {
    expect(daysUntil(inDays(0), NOW)).toBe(0);
    expect(daysUntil(inDays(30), NOW)).toBe(30);
    expect(daysUntil(inDays(-1), NOW)).toBe(-1);
  });

  it('treats the last day of cover as still in force', () => {
    expect(renewalState(policy(0), NOW).window).toBe('DUE');
    expect(renewalState(policy(-1), NOW).window).toBe('EXPIRED');
  });

  it('classifies a policy well inside its term as not due', () => {
    expect(renewalState(policy(200), NOW).window).toBe('NOT_DUE');
  });

  it('classifies a policy inside the window as due', () => {
    expect(renewalState(policy(30), NOW).window).toBe('DUE');
  });

  it('classifies a lapsed policy as expired', () => {
    expect(renewalState(policy(-5), NOW).window).toBe('EXPIRED');
  });

  it('prefers the state the API supplied over recomputing it', () => {
    const fromApi = { window: 'DUE', daysRemaining: 3, renewable: false, renewalRequestId: 'QR-9' };
    expect(renewalState({ ...policy(200), renewal: fromApi }, NOW)).toBe(fromApi);
  });

  it('treats a policy with no recorded cover period as not due rather than expired', () => {
    const state = renewalState({ policyDates: null }, NOW);
    expect(state.window).toBe('NOT_DUE');
    expect(state.daysRemaining).toBeNull();
  });

  it('sorts the soonest to expire first and undated policies last', () => {
    const undated = { policyDates: null };
    const sorted = [policy(90), undated, policy(-2), policy(10)].sort(byRenewalUrgency);
    expect(sorted.map((p) => renewalState(p, NOW).daysRemaining)).toEqual([-2, 10, 90, null]);
  });

  it('describes the deadline the way the page shows it', () => {
    expect(renewalLabel(renewalState(policy(-3), NOW))).toBe('Cover ended 3 days ago');
    expect(renewalLabel(renewalState(policy(0), NOW))).toBe('Cover ends today');
    expect(renewalLabel(renewalState(policy(1), NOW))).toBe('Cover ends tomorrow');
    expect(renewalLabel(renewalState({ policyDates: null }, NOW))).toBe('No cover period recorded');
  });
});
