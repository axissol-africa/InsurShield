/** The delay before a failed attempt is retried, and when a job stops being retried at all. */

/** First retry after this long; each further attempt doubles it. */
export const BASE_BACKOFF_MS = 30_000;

/** Doubling is capped here, so a long-lived job keeps retrying at a usable rate. */
export const MAX_BACKOFF_MS = 60 * 60_000;

/**
 * `attempt` is the number of attempts already made, so the first failure passes
 * 1 and waits the base delay. Exponential rather than fixed, because the
 * failures this retries are usually an outside system being unavailable, and a
 * fixed interval would hammer it for as long as it stayed down.
 */
export function backoffMs(attempt: number): number {
  const doubled = BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(doubled, MAX_BACKOFF_MS);
}

export function nextRunAfter(attempt: number, now: Date): Date {
  return new Date(now.getTime() + backoffMs(attempt));
}

/** True once the attempt just made was the last one allowed. */
export function isExhausted(attempt: number, maxAttempts: number): boolean {
  return attempt >= maxAttempts;
}
