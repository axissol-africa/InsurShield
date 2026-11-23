import { describe, expect, it } from 'vitest';
import { QUOTE_PRODUCT_STATUSES, type QuoteProductStatus } from '../../common/domain/enums.js';
import {
  CUSTOMER_STATUS_LABELS,
  initialStatus,
  isOpenStatus,
  nextStatus,
  resumedReplyDueAt,
  slaState,
  type QuoteProductEvent,
} from './quote-workflow.js';

const allowed: Record<QuoteProductEvent, Partial<Record<QuoteProductStatus, QuoteProductStatus>>> = {
  CLAIM: { SUBMITTED: 'INSURER_PROCESSING' },
  REQUEST_INFORMATION: { SUBMITTED: 'VERIFICATION_REQUIRED', INSURER_PROCESSING: 'VERIFICATION_REQUIRED' },
  CUSTOMER_ANSWERED: { VERIFICATION_REQUIRED: 'INSURER_PROCESSING' },
  QUOTE: { SUBMITTED: 'QUOTED', INSURER_PROCESSING: 'QUOTED', VERIFICATION_REQUIRED: 'QUOTED' },
  DECLINE: {
    SUBMITTED: 'DECLINED',
    INSURER_PROCESSING: 'DECLINED',
    VERIFICATION_REQUIRED: 'DECLINED',
    INSPECTION_REQUIRED: 'DECLINED',
  },
  TIME_OUT: {
    SUBMITTED: 'TIMED_OUT',
    INSURER_PROCESSING: 'TIMED_OUT',
    VERIFICATION_REQUIRED: 'TIMED_OUT',
    INSPECTION_REQUIRED: 'TIMED_OUT',
  },
  EXPIRE: { QUOTED: 'EXPIRED' },
  CANCEL: {
    SUBMITTED: 'CANCELLED',
    INSURER_PROCESSING: 'CANCELLED',
    VERIFICATION_REQUIRED: 'CANCELLED',
    INSPECTION_REQUIRED: 'CANCELLED',
    MANUAL_REVIEW: 'CANCELLED',
    QUOTED: 'CANCELLED',
  },
};

describe('nextStatus', () => {
  const rows = (Object.keys(allowed) as QuoteProductEvent[]).flatMap((event) =>
    QUOTE_PRODUCT_STATUSES.map((from) => [event, from, allowed[event][from] ?? null] as const),
  );

  it.each(rows)('%s from %s gives %s', (event, from, to) => {
    expect(nextStatus(from, event)).toBe(to);
  });

  it('never leaves a closed state', () => {
    for (const closed of ['DECLINED', 'TIMED_OUT', 'EXPIRED', 'CANCELLED'] as const) {
      for (const event of Object.keys(allowed) as QuoteProductEvent[]) {
        expect(nextStatus(closed, event)).toBeNull();
      }
    }
  });
});

describe('initialStatus', () => {
  it('holds a version whose rule needs an inspection before quotation', () => {
    expect(initialStatus('REQUIRED', 'BEFORE_QUOTATION')).toBe('INSPECTION_REQUIRED');
  });

  it.each([
    ['REQUIRED', 'BEFORE_PAYMENT'],
    ['REQUIRED', 'AFTER_PAYMENT'],
    ['OPTIONAL', 'BEFORE_QUOTATION'],
    ['NOT_REQUIRED', null],
  ] as const)('starts %s %s as submitted', (rule, timing) => {
    expect(initialStatus(rule, timing)).toBe('SUBMITTED');
  });
});

describe('resumedReplyDueAt', () => {
  it('moves the due date on by the time spent waiting for the customer', () => {
    const due = new Date('2026-11-30T10:00:00Z');
    const paused = new Date('2026-11-25T10:00:00Z');
    const resumed = new Date('2026-11-27T16:00:00Z');
    expect(resumedReplyDueAt(due, paused, resumed).toISOString()).toBe('2026-12-02T16:00:00.000Z');
  });

  it('never moves the due date backwards', () => {
    const due = new Date('2026-11-30T10:00:00Z');
    expect(resumedReplyDueAt(due, new Date('2026-11-25T10:00:00Z'), new Date('2026-11-24T10:00:00Z'))).toEqual(due);
  });
});

describe('labels', () => {
  it('names every state for the customer', () => {
    for (const status of QUOTE_PRODUCT_STATUSES) expect(CUSTOMER_STATUS_LABELS[status]).toMatch(/\w/);
  });

  it('counts only the states that can still end in a quote as open', () => {
    expect(QUOTE_PRODUCT_STATUSES.filter(isOpenStatus)).toEqual([
      'SUBMITTED',
      'INSURER_PROCESSING',
      'VERIFICATION_REQUIRED',
      'INSPECTION_REQUIRED',
      'MANUAL_REVIEW',
    ]);
  });
});

describe('slaState', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const due = (hours: number) => new Date(now.getTime() + hours * 3_600_000);

  it.each([
    [{ status: 'SUBMITTED', replyDueAt: due(48), pausedAt: null }, 'ON_TRACK'],
    [{ status: 'INSURER_PROCESSING', replyDueAt: due(24), pausedAt: null }, 'DUE_SOON'],
    [{ status: 'SUBMITTED', replyDueAt: due(-1), pausedAt: null }, 'BREACHED'],
    [{ status: 'VERIFICATION_REQUIRED', replyDueAt: due(-1), pausedAt: now }, 'PAUSED'],
    [{ status: 'SUBMITTED', replyDueAt: null, pausedAt: null }, 'ON_TRACK'],
    [{ status: 'QUOTED', replyDueAt: due(-1), pausedAt: null }, null],
    [{ status: 'DECLINED', replyDueAt: due(1), pausedAt: null }, null],
  ] as const)('%o is %s', (version, expected) => {
    expect(slaState(version, 24, now)).toBe(expected);
  });
});
