import type { QuoteRequestStatus } from '../../common/domain/enums.js';
import { isRequestOpen } from '../../common/domain/quote-request.js';
import { MS_PER_DAY } from './cover-period.js';

/**
 * How early a policy is treated as due for renewal. The customer is reminded
 * 30 days out; the window opens earlier so acting on the reminder is never the
 * first moment renewal becomes possible.
 */
export const RENEWAL_WINDOW_DAYS = 60;

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
export function renewalWindow(daysRemaining: number | null): RenewalWindow {
  if (daysRemaining === null) return 'NOT_DUE';
  if (daysRemaining < 0) return 'EXPIRED';
  return daysRemaining <= RENEWAL_WINDOW_DAYS ? 'DUE' : 'NOT_DUE';
}

/**
 * Where a policy stands on renewal. `window` is informational, while
 * `renewable` alone decides whether renewing works: it is blocked only by a
 * renewal already in flight, never by the date.
 */
export function renewalState(policyEndDate: Date | null, renewals: RenewalRequest[], now: Date): RenewalState {
  const open = openRenewal(renewals, now);
  const daysRemaining = policyEndDate ? daysUntil(policyEndDate, now) : null;
  return {
    window: renewalWindow(daysRemaining),
    daysRemaining,
    endDate: policyEndDate?.toISOString() ?? null,
    renewable: !open,
    renewalRequestId: open?.id ?? null,
  };
}
