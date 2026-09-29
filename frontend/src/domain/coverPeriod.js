import { formatDate } from './premiumEngine';

/**
 * The cover period of a request or policy, ready to display.
 *
 * `policyDates` reaches the app two ways: calculated on the device while the
 * customer is still choosing (already formatted for the screen), or returned
 * by the API as ISO dates. Pages should not have to know which they are
 * holding, so every one of them asks here.
 *
 * @param {Object|null|undefined} policyDates
 * @returns {{ start: string, end: string, days: number|null, known: boolean }}
 */
export function coverPeriod(policyDates) {
  const start = policyDates?.formattedStart ?? (policyDates?.startDate ? formatDate(policyDates.startDate) : null);
  const end = policyDates?.formattedEnd ?? (policyDates?.endDate ? formatDate(policyDates.endDate) : null);

  return {
    start: start ?? '—',
    end: end ?? '—',
    days: policyDates?.daysTotal ?? null,
    known: Boolean(start && end),
  };
}

/** "10 Sep 2026 – 10 Dec 2026", or a dash when the period is not set yet. */
export const coverPeriodLabel = (policyDates) => {
  const period = coverPeriod(policyDates);
  return period.known ? `${period.start} – ${period.end}` : '—';
};
