import { describe, expect, it } from 'vitest';
import { ratingAverage, windowStart } from './ratings.js';

describe('verified public star ratings', () => {
  it('withholds the average until the sample threshold and rounds to one decimal', () => {
    expect(ratingAverage(36, 9, 10)).toBeNull();
    expect(ratingAverage(0, 0, 10)).toBeNull();
    expect(ratingAverage(37, 10, 10)).toBe(3.7);
    expect(ratingAverage(81, 20, 10)).toBe(4.1);
    expect(ratingAverage(35, 11, 10)).toBe(3.2);
  });

  it('uses a rolling window across leap days and year boundaries', () => {
    expect(windowStart(new Date('2024-03-01T19:41:00Z'), 365).toISOString()).toBe('2023-03-02T19:41:00.000Z');
  });
});
