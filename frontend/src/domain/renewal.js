/**
 * When a policy is due for renewal.
 *
 * The API returns this on every policy as `policy.renewal`. These rules are
 * the same ones `CustomerService.renewalState` applies on the server, kept
 * here so the page also works against the mock API — if you change the window,
 * change it in both places.
 */
export const RENEWAL_WINDOW_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const startOfDay = (value) => {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
};

/**
 * Calendar days from today until `date`: 0 the day cover ends, negative once
 * it has passed. Counting whole days rather than hours is what stops a policy
 * ending this afternoon from reading as "ends tomorrow".
 */
export const daysUntil = (date, now = new Date()) => {
  const end = new Date(date);
  if (Number.isNaN(end.getTime())) return null;
  return Math.round((startOfDay(end) - startOfDay(now)) / MS_PER_DAY);
};

/**
 * Renewal state for a policy, preferring whatever the server said.
 * `renewable` is what gates the button; `window` only drives presentation.
 */
export function renewalState(policy, now = new Date()) {
  if (policy?.renewal) return policy.renewal;

  const endDate = policy?.policyDates?.endDate || null;
  const daysRemaining = endDate ? daysUntil(endDate, now) : null;

  let window = 'NOT_DUE';
  if (daysRemaining !== null) {
    // Cover is still in force on its last day, so only a negative count has lapsed.
    if (daysRemaining < 0) window = 'EXPIRED';
    else if (daysRemaining <= RENEWAL_WINDOW_DAYS) window = 'DUE';
  }

  return { window, daysRemaining, endDate, renewable: true, renewalRequestId: null };
}

/** Soonest to expire first, so what needs attention is at the top. */
export const byRenewalUrgency = (a, b) => {
  const left = renewalState(a).daysRemaining;
  const right = renewalState(b).daysRemaining;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
};

/** How the page talks about the deadline. */
export function renewalLabel(state) {
  const { window, daysRemaining } = state;
  if (daysRemaining === null) return 'No cover period recorded';
  if (window === 'EXPIRED') {
    const days = Math.abs(daysRemaining);
    return `Cover ended ${days} day${days === 1 ? '' : 's'} ago`;
  }
  if (daysRemaining === 0) return 'Cover ends today';
  if (daysRemaining === 1) return 'Cover ends tomorrow';
  return `Cover ends in ${daysRemaining} days`;
}
