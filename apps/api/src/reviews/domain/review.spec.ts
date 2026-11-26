import { describe, expect, it } from 'vitest';
import { nextReviewStatus, withinReviewWindow } from './review.js';

describe('review deadlines', () => {
  const issued = new Date('2026-11-25T22:03:00Z');

  it('uses the issuance date in Lusaka and includes the final local day', () => {
    expect(withinReviewWindow(issued, new Date('2027-02-24T21:59:59Z'), 90)).toBe(true);
    expect(withinReviewWindow(issued, new Date('2027-02-24T22:00:00Z'), 90)).toBe(false);
  });

  it('cannot accept a review before issue', () => {
    expect(withinReviewWindow(issued, new Date('2026-11-25T22:02:59Z'), 90)).toBe(false);
  });
});

describe('moderation', () => {
  it.each([
    ['PENDING', 'PUBLISH', 'PUBLISHED'],
    ['PENDING', 'REJECT', 'REJECTED'],
    ['PUBLISHED', 'REMOVE', 'REMOVED'],
    ['REMOVED', 'REINSTATE', 'PUBLISHED'],
    ['SUPERSEDED', 'PUBLISH', null],
    ['PUBLISHED', 'REJECT', null],
    ['REMOVED', 'PUBLISH', null],
  ] as const)('maps %s and %s to %s', (status, action, expected) => {
    expect(nextReviewStatus(status, action)).toBe(expected);
  });
});
