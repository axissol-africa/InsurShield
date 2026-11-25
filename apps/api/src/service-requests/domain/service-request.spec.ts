import { cancellationDateProblem, canMove, isOpen, policyProblem, refundTooLarge, statusAfter } from './service-request.js';

describe('the service request state model', () => {
  it('moves through review, a question and its answer, approval and completion', () => {
    expect(statusAfter('REVIEW', 'SUBMITTED')).toBe('IN_REVIEW');
    expect(statusAfter('REQUEST_INFORMATION', 'IN_REVIEW')).toBe('INFORMATION_REQUIRED');
    expect(statusAfter('REPLY', 'INFORMATION_REQUIRED')).toBe('IN_REVIEW');
    expect(statusAfter('APPROVE', 'IN_REVIEW')).toBe('APPROVED');
    expect(statusAfter('COMPLETE', 'APPROVED')).toBe('COMPLETED');
  });

  it('refuses what the table does not list', () => {
    expect(canMove('COMPLETE', 'IN_REVIEW')).toBe(false);
    expect(canMove('APPROVE', 'INFORMATION_REQUIRED')).toBe(false);
    expect(canMove('REPLY', 'IN_REVIEW')).toBe(false);
    expect(canMove('DECLINE', 'APPROVED')).toBe(false);
  });

  it('lets nothing happen to a final request, not even a message', () => {
    for (const status of ['COMPLETED', 'DECLINED', 'WITHDRAWN'] as const) {
      expect(isOpen(status)).toBe(false);
      for (const action of ['REVIEW', 'REQUEST_INFORMATION', 'REPLY', 'APPROVE', 'DECLINE', 'COMPLETE', 'WITHDRAW', 'UPDATE'] as const) {
        expect(canMove(action, status)).toBe(false);
      }
    }
  });

  it('lets the customer withdraw until it is done, and a message leaves the status alone', () => {
    for (const status of ['SUBMITTED', 'IN_REVIEW', 'INFORMATION_REQUIRED', 'APPROVED'] as const) {
      expect(canMove('WITHDRAW', status)).toBe(true);
      expect(statusAfter('UPDATE', status)).toBe(status);
    }
  });
});

describe('policyProblem', () => {
  it('takes requests about cover in force or being issued, and cancels only cover in force', () => {
    expect(policyProblem('DETAILS_CHANGE', 'AWAITING_INSURER_CERTIFICATE')).toBeNull();
    expect(policyProblem('CANCELLATION', 'ACTIVE')).toBeNull();
    expect(policyProblem('CANCELLATION', 'AWAITING_INSURER_CERTIFICATE')).toBe('POLICY_NOT_ACTIVE');
    expect(policyProblem('ASSISTANCE', 'CANCELLED')).toBe('POLICY_NOT_SERVICEABLE');
    expect(policyProblem('ASSISTANCE', 'ISSUANCE_FAILED')).toBe('POLICY_NOT_SERVICEABLE');
  });
});

describe('cancellationDateProblem', () => {
  it('accepts today and the last day of cover, and nothing outside them', () => {
    expect(cancellationDateProblem('2026-11-25', '2026-11-25', '2027-01-31')).toBeNull();
    expect(cancellationDateProblem('2027-01-31', '2026-11-25', '2027-01-31')).toBeNull();
    expect(cancellationDateProblem('2026-11-24', '2026-11-25', '2027-01-31')).toBe('DATE_IN_PAST');
    expect(cancellationDateProblem('2027-02-01', '2026-11-25', '2027-01-31')).toBe('DATE_AFTER_COVER');
  });
});

describe('refundTooLarge', () => {
  it('allows up to what is left of the payment, zero included', () => {
    expect(refundTooLarge(0, 100_00, 0)).toBe(false);
    expect(refundTooLarge(60_00, 100_00, 40_00)).toBe(false);
    expect(refundTooLarge(60_01, 100_00, 40_00)).toBe(true);
  });
});
