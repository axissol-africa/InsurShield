import { newReference } from './reference.js';

describe('a reference', () => {
  it('is the prefix, the time in base 36 and three characters picked from digits and capitals', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const picks = [0, 10, 35];

    expect(newReference('TXN', now, () => picks.shift() ?? 0)).toBe(
      `TXN-${now.getTime().toString(36).toUpperCase()}0AZ`,
    );
  });
});
