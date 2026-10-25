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
 * The period the quotes are priced against. The client's dates win when it sent
 * them; otherwise cover starts now and runs the duration's quarters.
 */
export function coverPeriod(
  dates: { startDate: string; endDate: string } | undefined,
  duration: CoverageDuration,
  now: Date,
): CoverPeriod {
  const startDate = dates ? new Date(dates.startDate) : now;
  const endDate = dates ? new Date(dates.endDate) : addQuarters(startDate, QUARTERS[duration]);
  return {
    startDate,
    endDate,
    days: Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / MS_PER_DAY)),
  };
}

function addQuarters(from: Date, quarters: number): Date {
  const end = new Date(from);
  end.setMonth(end.getMonth() + quarters * 3);
  return end;
}
