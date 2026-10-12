import { describe, expect, it } from 'vitest';
import { timeAgo } from './time';

describe('timeAgo', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const at = (ms) => new Date(now - ms).toISOString();

  it('rounds down to the largest whole unit', () => {
    expect(timeAgo(at(30_000), now)).toBe('just now');
    expect(timeAgo(at(5 * 60_000), now)).toBe('5m ago');
    expect(timeAgo(at(3 * 3_600_000 + 59 * 60_000), now)).toBe('3h ago');
    expect(timeAgo(at(2 * 86_400_000), now)).toBe('2d ago');
  });

  it('is empty for a missing timestamp', () => {
    expect(timeAgo(null)).toBe('');
    expect(timeAgo(undefined)).toBe('');
  });
});
