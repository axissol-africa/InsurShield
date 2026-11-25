import type { QuoteRequestStatus } from '../../common/domain/enums.js';
import { isRequestOpen } from '../../common/domain/quote-request.js';
import { MS_PER_DAY } from './cover-period.js';

/**
 * How early a policy is treated as due for renewal when no setting says
 * otherwise. The window and the reminder days are the `RENEWAL_POLICY`
 * setting; this is its default.
 */
export const RENEWAL_WINDOW_DAYS = 60;

/** A lapsed policy is told once, within this many days of its end; older ones are left alone. */
export const LAPSED_NOTICE_DAYS = 30;

export type RenewalWindow = 'NOT_DUE' | 'DUE' | 'EXPIRED';

export interface RenewalRequest {
  id: string;
  status: QuoteRequestStatus;
  expiresAt: Date;
}

export interface RenewalState {
  window: RenewalWindow;
  daysRemaining: number | null;
  endDate: string | null;
  renewable: boolean;
  renewalRequestId: string | null;
}

const startOfDay = (value: Date) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * Calendar days from today until `date`: 0 on the day cover ends, negative
 * once it has passed. Mirrored in the client's `domain/renewal.js`.
 */
export const daysUntil = (date: Date, now: Date): number =>
  Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / MS_PER_DAY);

/** A renewal request still open blocks starting another for the same policy. */
export const openRenewal = (renewals: RenewalRequest[], now: Date): RenewalRequest | undefined =>
  renewals.find((renewal) => isRequestOpen(renewal.status, renewal.expiresAt, now));

/** Cover is still in force on its last day, so only a negative count has lapsed. */
export function renewalWindow(daysRemaining: number | null, windowDays = RENEWAL_WINDOW_DAYS): RenewalWindow {
  if (daysRemaining === null) return 'NOT_DUE';
  if (daysRemaining < 0) return 'EXPIRED';
  return daysRemaining <= windowDays ? 'DUE' : 'NOT_DUE';
}

export type ReminderDue = { kind: 'DUE'; daysBefore: number } | { kind: 'LAPSED'; daysBefore: 0 };

/**
 * The reminder a policy is owed today, if any: the closest reminder day not
 * yet passed, so a run missed for a few days still sends the right one rather
 * than a stale one, and one lapsed notice in the month after the end.
 * `sent` lists the reminder days already sent for this policy.
 */
export function reminderDue(daysRemaining: number, reminderDays: readonly number[], sent: readonly ReminderDue[]): ReminderDue | null {
  if (daysRemaining < 0) {
    if (daysRemaining < -LAPSED_NOTICE_DAYS || sent.some((reminder) => reminder.kind === 'LAPSED')) return null;
    return { kind: 'LAPSED', daysBefore: 0 };
  }
  const closest = [...reminderDays].sort((a, b) => a - b).find((day) => day >= daysRemaining);
  if (closest === undefined) return null;
  // A later (smaller) reminder already sent makes an earlier one pointless.
  if (sent.some((reminder) => reminder.kind === 'DUE' && reminder.daysBefore <= closest)) return null;
  return { kind: 'DUE', daysBefore: closest };
}

/**
 * Where a policy stands on renewal. `window` is informational, while
 * `renewable` alone decides whether renewing works: it is blocked only by a
 * renewal already in flight, never by the date.
 */
export function renewalState(
  policyEndDate: Date | null,
  renewals: RenewalRequest[],
  now: Date,
  windowDays = RENEWAL_WINDOW_DAYS,
): RenewalState {
  const open = openRenewal(renewals, now);
  const daysRemaining = policyEndDate ? daysUntil(policyEndDate, now) : null;
  return {
    window: renewalWindow(daysRemaining, windowDays),
    daysRemaining,
    endDate: policyEndDate?.toISOString() ?? null,
    renewable: !open,
    renewalRequestId: open?.id ?? null,
  };
}
