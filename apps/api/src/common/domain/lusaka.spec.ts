import { describe, expect, it } from 'vitest';
import { currentOn, lusakaDay } from './lusaka.js';

describe('lusakaDay', () => {
  it('is the calendar day in Lusaka, not in UTC', () => {
    // 22:30 UTC on the 10th is already 00:30 on the 11th in Lusaka.
    expect(lusakaDay(new Date('2026-11-10T22:30:00.000Z'))).toBe('2026-11-11');
    expect(lusakaDay(new Date('2026-11-10T21:30:00.000Z'))).toBe('2026-11-10');
    expect(lusakaDay(new Date('2026-11-10T00:00:00.000Z'))).toBe('2026-11-10');
  });
});

describe('currentOn', () => {
  const noon = new Date('2026-11-10T09:00:00.000Z');

  it('holds for the whole of the deadline day in Lusaka', () => {
    expect(currentOn(new Date('2026-11-10T00:00:00.000Z'), noon)).toBe(true);
  });

  it('has passed once Lusaka reaches the next day, two hours before UTC does', () => {
    expect(currentOn(new Date('2026-11-10T00:00:00.000Z'), new Date('2026-11-10T22:00:00.000Z'))).toBe(false);
  });

  it('never passes when nobody set a deadline', () => {
    expect(currentOn(null, noon)).toBe(true);
  });
});
