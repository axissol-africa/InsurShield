/**
 * Business days are Lusaka's, as the root AGENTS.md says and as
 * `admin.repository.ts` reads its calendar months. A licence and a piece of
 * compliance evidence both lapse at the end of their day here, so the rule for
 * "which day is it" lives in one pure place that any domain function can use.
 */
const LUSAKA = 'Africa/Lusaka';
const PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: LUSAKA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The Lusaka calendar day a moment falls in, as `YYYY-MM-DD`, which plain comparison orders correctly. */
export function lusakaDay(moment: Date): string {
  const parts = PARTS.formatToParts(moment);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((found) => found.type === type)?.value;
  const [year, month, day] = [part('year'), part('month'), part('day')];
  if (!year || !month || !day) throw new Error(`Could not read a ${LUSAKA} date from ${moment.toISOString()}`);
  return `${year}-${month}-${day}`;
}

/** Whether a date-only deadline has not yet passed in Lusaka. A deadline nobody set never passes. */
export function currentOn(deadline: Date | null, now: Date): boolean {
  return deadline === null || lusakaDay(deadline) >= lusakaDay(now);
}

export { LUSAKA };
