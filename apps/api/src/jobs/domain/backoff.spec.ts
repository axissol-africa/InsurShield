import { BASE_BACKOFF_MS, MAX_BACKOFF_MS, backoffMs, isExhausted, nextRunAfter } from './backoff.js';

describe('backoffMs', () => {
  it('waits the base delay after the first failure', () => {
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS);
  });

  it('doubles with each further attempt', () => {
    expect(backoffMs(2)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(3)).toBe(BASE_BACKOFF_MS * 4);
    expect(backoffMs(4)).toBe(BASE_BACKOFF_MS * 8);
  });

  it('stops doubling at the cap, so a long-lived job keeps retrying at a usable rate', () => {
    expect(backoffMs(99)).toBe(MAX_BACKOFF_MS);
    expect(backoffMs(999)).toBe(MAX_BACKOFF_MS);
  });

  it('treats a nonsensical attempt as the first, rather than returning a delay of nothing', () => {
    expect(backoffMs(0)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(-5)).toBe(BASE_BACKOFF_MS);
  });
});

describe('nextRunAfter', () => {
  it('schedules the retry from the time passed in, not from the clock', () => {
    const now = new Date('2026-11-09T10:00:00.000Z');
    expect(nextRunAfter(1, now)).toEqual(new Date(now.getTime() + BASE_BACKOFF_MS));
  });
});

describe('isExhausted', () => {
  it('is exhausted once the attempt just made was the last allowed', () => {
    expect(isExhausted(5, 5)).toBe(true);
    expect(isExhausted(4, 5)).toBe(false);
  });

  it('is exhausted when attempts somehow ran past the limit, rather than retrying forever', () => {
    expect(isExhausted(6, 5)).toBe(true);
  });
});
