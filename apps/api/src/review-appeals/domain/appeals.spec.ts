import { describe, expect, it } from 'vitest';
import { appealAllowed, deadline, inverse } from './appeals.js';

describe('appeal rules', () => {
  it('uses the Lusaka receipt day across UTC midnight and month/year boundaries', () => {
    expect(deadline(new Date('2035-12-31T22:01:00Z'), 14)).toBe('2036-01-15');
    expect(deadline(new Date('2036-02-28T22:01:00Z'), 1)).toBe('2036-03-01');
  });
  it('allows only the affected party and content type', () => {
    for (const action of ['PUBLISH', 'REINSTATE', 'REJECT', 'REMOVE'] as const) {
      const adverse = ['REJECT', 'REMOVE'].includes(action);
      expect(appealAllowed('CUSTOMER', 'REVIEW', action)).toBe(adverse);
      expect(appealAllowed('CUSTOMER', 'RESPONSE', action)).toBe(false);
      expect(appealAllowed('INSURER', 'REVIEW', action)).toBe(!adverse);
      expect(appealAllowed('INSURER', 'RESPONSE', action)).toBe(adverse);
      expect(inverse(action)).toBe(adverse ? 'REINSTATE' : 'REMOVE');
    }
  });
});
