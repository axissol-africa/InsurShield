import { toContract, fromContract, CONTRACT_VALUES } from './contract.js';
import {
  CLAIM_STATUSES,
  COVERAGE_DURATIONS,
  INSPECTION_STATUSES,
  INSURANCE_TYPES,
  NCD_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  POLICY_STATUSES,
  QUOTE_REQUEST_STATUSES,
} from './domain/enums.js';

/**
 * The client branches on these exact strings, so a mapping that silently
 * returns `undefined` for a new enum value would show up as a blank badge
 * rather than an error. Every enum member is checked, which is what makes
 * adding one to the schema without mapping it fail here first.
 */
describe('contract vocabulary', () => {
  it.each([
    ['quote request status', QUOTE_REQUEST_STATUSES, toContract.quoteRequestStatus],
    ['insurance type', INSURANCE_TYPES, toContract.insuranceType],
    ['coverage duration', COVERAGE_DURATIONS, toContract.coverageDuration],
    ['policy status', POLICY_STATUSES, toContract.policyStatus],
    ['claim status', CLAIM_STATUSES, toContract.claimStatus],
    ['NCD status', NCD_STATUSES, toContract.ncdStatus],
    ['payment status', PAYMENT_STATUSES, toContract.paymentStatus],
    ['payment method', PAYMENT_METHODS, toContract.paymentMethod],
    ['inspection status', INSPECTION_STATUSES, toContract.inspectionStatus],
  ])('maps every %s the schema defines', (_label, values, map) => {
    for (const value of values) {
      expect(map(value as never), `${value} has no contract value`).toBeTruthy();
    }
  });

  it.each([
    ['quote request status', toContract.quoteRequestStatus, { SUBMITTED: 'Submitted', QUOTED: 'Quoted', EXPIRED: 'Expired' }],
    ['insurance type', toContract.insuranceType, { COMPREHENSIVE: 'Comprehensive', THIRD_PARTY: 'ThirdParty' }],
    ['coverage duration', toContract.coverageDuration, { Q1: '1q', Q2: '2q', Q3: '3q', Q4: '4q' }],
    [
      'policy status',
      toContract.policyStatus,
      { AWAITING_INSURER_CERTIFICATE: 'Awaiting insurer certificate', ACTIVE: 'Active' },
    ],
    ['claim status', toContract.claimStatus, { NOTIFIED: 'Notified', RECEIVED_BY_INSURER: 'Received by insurer' }],
    [
      'NCD status',
      toContract.ncdStatus,
      {
        SUBMITTED: 'Submitted',
        UNDER_REVIEW: 'Under Review',
        VERIFICATION_REQUIRED: 'Verification Required',
        APPROVED: 'Approved',
        REJECTED: 'Rejected',
      },
    ],
    ['payment status', toContract.paymentStatus, { PENDING: 'Pending', CONFIRMED: 'Confirmed', FAILED: 'Failed' }],
    ['payment method', toContract.paymentMethod, { MOBILE_MONEY: 'Mobile money', CARD: 'Card' }],
    [
      'inspection status',
      toContract.inspectionStatus,
      {
        REQUESTED: 'Requested',
        SCHEDULED: 'Scheduled',
        INSPECTOR_ASSIGNED: 'Inspector assigned',
        IN_PROGRESS: 'In progress',
        COMPLETED: 'Completed',
        REPORT_READY: 'Report ready',
        APPROVED: 'Approved',
        FAILED: 'Failed',
      },
    ],
  ] as const)('sends each %s as its exact wire string', (_label, map, pairs) => {
    for (const [stored, wire] of Object.entries(pairs)) {
      expect(map(stored as never), stored).toBe(wire);
    }
  });

  it.each([
    ['insurance type', fromContract.insuranceType, { Comprehensive: 'COMPREHENSIVE', ThirdParty: 'THIRD_PARTY' }],
    ['coverage duration', fromContract.coverageDuration, { '1q': 'Q1', '2q': 'Q2', '3q': 'Q3', '4q': 'Q4' }],
    ['payment method', fromContract.paymentMethod, { 'Mobile money': 'MOBILE_MONEY', Card: 'CARD' }],
  ] as const)('reads each %s wire string as its stored value', (_label, map, pairs) => {
    for (const [wire, stored] of Object.entries(pairs)) {
      expect(map(wire), wire).toBe(stored);
    }
  });

  it('speaks the values the client checks for', () => {
    expect(toContract.quoteRequestStatus('EXPIRED')).toBe('Expired');
    expect(toContract.insuranceType('THIRD_PARTY')).toBe('ThirdParty');
    expect(toContract.coverageDuration('Q4')).toBe('4q');
    expect(toContract.policyStatus('AWAITING_INSURER_CERTIFICATE')).toBe('Awaiting insurer certificate');
    expect(toContract.claimStatus('RECEIVED_BY_INSURER')).toBe('Received by insurer');
    expect(toContract.paymentMethod('MOBILE_MONEY')).toBe('Mobile money');
  });

  it('reads request bodies back into enums, and rejects anything else', () => {
    expect(fromContract.insuranceType('ThirdParty')).toBe('THIRD_PARTY');
    expect(fromContract.coverageDuration('2q')).toBe('Q2');
    expect(fromContract.paymentMethod('Card')).toBe('CARD');

    // Unknown input must not resolve to an enum; the DTO layer refuses it.
    expect(fromContract.insuranceType('THIRD_PARTY')).toBeUndefined();
    expect(fromContract.coverageDuration('quarterly')).toBeUndefined();
    expect(fromContract.paymentMethod('')).toBeUndefined();
  });

  it.each([
    ['insurance type', INSURANCE_TYPES, toContract.insuranceType, fromContract.insuranceType],
    ['coverage duration', COVERAGE_DURATIONS, toContract.coverageDuration, fromContract.coverageDuration],
    ['payment method', PAYMENT_METHODS, toContract.paymentMethod, fromContract.paymentMethod],
  ])('reads every %s back from its wire value', (_label, values, to, from) => {
    for (const value of values) {
      expect(from(to(value as never))).toBe(value);
    }
  });

  it.each([
    ['quote request status', QUOTE_REQUEST_STATUSES, toContract.quoteRequestStatus],
    ['NCD status', NCD_STATUSES, toContract.ncdStatus],
    ['payment status', PAYMENT_STATUSES, toContract.paymentStatus],
    ['inspection status', INSPECTION_STATUSES, toContract.inspectionStatus],
  ])('gives every %s its own wire value', (_label, values, map) => {
    const wire = values.map((value) => map(value as never));
    expect(new Set(wire).size).toBe(values.length);
  });

  it('offers validation the exact values a DTO may accept', () => {
    expect(CONTRACT_VALUES.insuranceType).toEqual(['Comprehensive', 'ThirdParty']);
    expect(CONTRACT_VALUES.coverageDuration).toEqual(['1q', '2q', '3q', '4q']);
    expect(CONTRACT_VALUES.paymentMethod).toEqual(['Mobile money', 'Card']);
  });
});
