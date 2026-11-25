import { describe, expect, it } from 'vitest';
import { canAskAbout, canCancel, canComplete, canMove, isOpen, statusAfter } from './serviceRequests';

describe('service request moves', () => {
  it('mirror the server: review, ask, answer, approve, complete', () => {
    expect(statusAfter('REVIEW', 'SUBMITTED')).toBe('IN_REVIEW');
    expect(statusAfter('REQUEST_INFORMATION', 'IN_REVIEW')).toBe('INFORMATION_REQUIRED');
    expect(statusAfter('REPLY', 'INFORMATION_REQUIRED')).toBe('IN_REVIEW');
    expect(statusAfter('COMPLETE', 'APPROVED')).toBe('COMPLETED');
    expect(canMove('APPROVE', 'INFORMATION_REQUIRED')).toBe(false);
    expect(canMove('UPDATE', 'DECLINED')).toBe(false);
    expect(isOpen('APPROVED')).toBe(true);
    expect(isOpen('WITHDRAWN')).toBe(false);
  });

  it('completes a correction in one step, and a cancellation only once approved', () => {
    expect(canComplete({ type: 'DETAILS_CHANGE', status: 'IN_REVIEW' })).toBe(true);
    expect(canComplete({ type: 'CANCELLATION', status: 'IN_REVIEW' })).toBe(false);
    expect(canComplete({ type: 'CANCELLATION', status: 'APPROVED' })).toBe(true);
    expect(canComplete({ type: 'ASSISTANCE', status: 'INFORMATION_REQUIRED' })).toBe(false);
  });

  it('takes requests on cover in force or being issued, and cancels only cover in force', () => {
    expect(canAskAbout({ status: 'Awaiting insurer certificate' })).toBe(true);
    expect(canAskAbout({ status: 'Cancelled' })).toBe(false);
    expect(canCancel({ status: 'Awaiting insurer certificate' })).toBe(false);
    expect(canCancel({ status: 'Active' })).toBe(true);
  });
});
