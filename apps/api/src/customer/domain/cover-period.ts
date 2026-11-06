import type { CoverageDuration } from '../../common/domain/enums.js';

export const MS_PER_DAY = 86_400_000;

/** How long a new request stays open for insurers to reply. */
export const REQUEST_VALIDITY_DAYS = 7;

const QUARTERS: Record<CoverageDuration, number> = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 };

export interface CoverPeriod {
  startDate: Date;
  endDate: Date;
  days: number;
}

export const addDays = (from: Date, days: number): Date => new Date(from.getTime() + days * MS_PER_DAY);

/**
 * RTSA alignment deliberately uses the current policy year with the registered
 * anniversary's month and day. This keeps the authoritative RTSA anniversary
 * stable while the policy term remains a current-year insurance decision.
 */
export function rtsaAnniversaryStart(registrationDate: string | Date, now: Date): Date {
  const source = typeof registrationDate === 'string' ? new Date(registrationDate) : registrationDate;
  const year = now.getUTCFullYear();
  const month = source.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(source.getUTCDate(), lastDay)));
}

/**
 * The period the quotes are priced against. The client can choose a start date,
 * but the cover term and end date are always derived on the server so a request
 * cannot be shortened or extended by a stale or manipulated browser calculation.
 */
export function coverPeriod(
  dates: { startDate: string; endDate: string } | undefined,
  duration: CoverageDuration,
  now: Date,
): CoverPeriod {
  const startDate = dates ? new Date(dates.startDate) : now;
  const endDate = addQuarters(startDate, QUARTERS[duration]);
  return {
    startDate,
    endDate,
    days: Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY)),
  };
}

function addQuarters(from: Date, quarters: number): Date {
  const targetMonth = from.getUTCMonth() + quarters * 3;
  const targetYear = from.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalisedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalisedMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalisedMonth,
      Math.min(from.getUTCDate(), lastDay),
      from.getUTCHours(),
      from.getUTCMinutes(),
      from.getUTCSeconds(),
      from.getUTCMilliseconds(),
    ),
  );
}
