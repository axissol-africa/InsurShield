import { nextStatus } from './privacy-review.js';
describe('controlled privacy review', () => {
  it('requires verification then decision before completion', () => {
    expect(nextStatus('SUBMITTED', 'COMPLETED')).toBeNull();
    expect(nextStatus('SUBMITTED', 'DECIDED')).toBeNull();
    expect(nextStatus('SUBMITTED', 'VERIFIED')).toBe('VERIFIED');
    expect(nextStatus('VERIFIED', 'DECIDED')).toBe('DECIDED');
    expect(nextStatus('DECIDED', 'COMPLETED')).toBe('COMPLETED');
  });
  it('allows reassignment without regressing state and refuses closed case edits', () => {
    expect(nextStatus('DECIDED', 'ASSIGNED')).toBe('DECIDED');
    expect(nextStatus('DECIDED', 'VERIFIED')).toBeNull();
    expect(nextStatus('COMPLETED', 'ASSIGNED')).toBeNull();
    expect(nextStatus('COMPLETED', 'COMPLETED')).toBeNull();
  });
});
