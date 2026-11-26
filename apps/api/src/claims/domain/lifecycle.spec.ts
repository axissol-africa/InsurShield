import { CLAIM_STATUSES, type ClaimStatus } from '../../common/domain/enums.js';
import {
  CLAIM_ACTIONS,
  claimRevision,
  nextClaimStatus,
  type LifecycleAction,
} from './lifecycle.js';

const transitions: [ClaimStatus, LifecycleAction, ClaimStatus][] = [
  ['RECEIVED_BY_INSURER', 'START_REVIEW', 'UNDER_REVIEW'],
  ['UNDER_REVIEW', 'REQUEST_EVIDENCE', 'EVIDENCE_REQUIRED'],
  ['EVIDENCE_REQUIRED', 'SUBMIT_EVIDENCE', 'UNDER_REVIEW'],
  ['UNDER_REVIEW', 'APPROVE', 'APPROVED'],
  ['UNDER_REVIEW', 'DECLINE', 'DECLINED'],
  ['APPROVED', 'CLOSE', 'CLOSED'],
  ['DECLINED', 'CLOSE', 'CLOSED'],
];

describe('claim lifecycle', () => {
  it.each(transitions)('%s + %s becomes %s', (status, action, expected) => {
    expect(nextClaimStatus(status, action)).toBe(expected);
  });
  it('refuses every other transition, including duplicates and terminal commands', () => {
    for (const status of CLAIM_STATUSES) {
      for (const action of [...CLAIM_ACTIONS, 'SUBMIT_EVIDENCE'] as const) {
        if (
          !transitions.some(
            ([from, command]) => from === status && command === action,
          )
        ) {
          expect(nextClaimStatus(status, action)).toBeNull();
        }
      }
    }
  });
});

describe('claim revision', () => {
  it('uses submission, acknowledgement, then the latest persisted event', () => {
    expect(claimRevision('CLM-1', null)).toBe('CLM-1:submitted');
    expect(claimRevision('CLM-1', new Date())).toBe('CLM-1:acknowledged');
    expect(claimRevision('CLM-1', new Date(), 'latest-event')).toBe(
      'latest-event',
    );
    expect(claimRevision('CLM-1', null, 'latest-event')).toBe('latest-event');
  });
});
