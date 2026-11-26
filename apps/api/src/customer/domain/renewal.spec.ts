import { renewalReminderKey } from '../renewal-reminders.js';
import { isRequestOpen } from '../../common/domain/quote-request.js';
import { daysUntil, reminderDue, renewalState, renewalWindow } from './renewal.js';

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
    const lateTonight = new Date('2026-10-24T21:59:00.000Z');
    const earlyTomorrow = new Date(lateTonight.getTime() + 2 * 60_000);

    expect(daysUntil(earlyTomorrow, lateTonight)).toBe(1);
  });
});

describe('renewalWindow with a configured window', () => {
  it('opens when the setting says', () => {
    expect(renewalWindow(45, 30)).toBe('NOT_DUE');
    expect(renewalWindow(30, 30)).toBe('DUE');
  });
});

describe('reminderDue', () => {
  const days = [30, 14, 3];

  it('sends the closest reminder day not yet passed', () => {
    expect(reminderDue(30, days, [])).toEqual({ kind: 'DUE', daysBefore: 30 });
    expect(reminderDue(20, days, [{ kind: 'DUE', daysBefore: 30 }])).toBeNull();
    expect(reminderDue(14, days, [{ kind: 'DUE', daysBefore: 30 }])).toEqual({ kind: 'DUE', daysBefore: 14 });
  });

  it('skips a stale reminder after a missed run, and never repeats one', () => {
    expect(reminderDue(2, days, [])).toEqual({ kind: 'DUE', daysBefore: 3 });
    expect(reminderDue(2, days, [{ kind: 'DUE', daysBefore: 3 }])).toBeNull();
    expect(reminderDue(25, days, [{ kind: 'DUE', daysBefore: 14 }])).toBeNull();
  });

  it('sends nothing before the first reminder day', () => {
    expect(reminderDue(31, days, [])).toBeNull();
  });

  it('tells a lapsed policy once, within a month of its end', () => {
    expect(reminderDue(-1, days, [])).toEqual({ kind: 'LAPSED', daysBefore: 0 });
    expect(reminderDue(-5, days, [{ kind: 'LAPSED', daysBefore: 0 }])).toBeNull();
    expect(reminderDue(-31, days, [])).toBeNull();
  });
});

describe('Lusaka renewal calendar', () => {
  it('keeps cover current until the end of its Lusaka day', () => {
    const end = new Date('2026-10-24T00:00:00.000+02:00');
    expect(renewalState(end, [], new Date('2026-10-24T21:59:59.999Z')).window).toBe('DUE');
    expect(renewalState(end, [], new Date('2026-10-24T22:00:00.000Z')).window).toBe('EXPIRED');
  });

  it('counts across month and year boundaries in Lusaka', () => {
    expect(daysUntil(new Date('2027-01-01T00:00:00.000Z'), new Date('2026-12-31T22:00:00.000Z'))).toBe(0);
    expect(daysUntil(new Date('2026-11-01T00:00:00.000Z'), new Date('2026-10-31T21:59:59.999Z'))).toBe(1);
  });

  it('uses one reminder key for each Lusaka day', () => {
    expect(renewalReminderKey(new Date('2026-12-31T21:59:59.999Z'))).toBe('2026-12-31');
    expect(renewalReminderKey(new Date('2026-12-31T22:00:00.000Z'))).toBe('2027-01-01');
    expect(renewalReminderKey(new Date('2027-01-01T21:59:59.999Z'))).toBe('2027-01-01');
  });
});
