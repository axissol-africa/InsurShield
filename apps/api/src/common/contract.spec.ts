import { toContract, fromContract, CONTRACT_VALUES } from './contract.js';
import {
  ClaimStatus,
  CoverageDuration,
  InspectionStatus,
  InsuranceType,
  NcdStatus,
  PaymentMethod,
  PaymentStatus,
  PolicyStatus,
  QuoteRequestStatus,
} from '../generated/prisma/enums.js';

/**
 * The client branches on these exact strings, so a mapping that silently
 * returns `undefined` for a new enum value would show up as a blank badge
 * rather than an error. Every enum member is checked, which is what makes
 * adding one to the schema without mapping it fail here first.
 */
const members = <T extends Record<string, string>>(enumeration: T) => Object.values(enumeration);

describe('contract vocabulary', () => {
  it.each([
    ['quote request status', members(QuoteRequestStatus), toContract.quoteRequestStatus],
    ['insurance type', members(InsuranceType), toContract.insuranceType],
    ['coverage duration', members(CoverageDuration), toContract.coverageDuration],
    ['policy status', members(PolicyStatus), toContract.policyStatus],
    ['claim status', members(ClaimStatus), toContract.claimStatus],
    ['NCD status', members(NcdStatus), toContract.ncdStatus],
    ['payment status', members(PaymentStatus), toContract.paymentStatus],
    ['payment method', members(PaymentMethod), toContract.paymentMethod],
    ['inspection status', members(InspectionStatus), toContract.inspectionStatus],
  ])('maps every %s the schema defines', (_label, values, map) => {
    for (const value of values) {
      expect(map(value as never), `${value} has no contract value`).toBeTruthy();
    }
  });

  it('speaks the values the client checks for', () => {
    expect(toContract.quoteRequestStatus(QuoteRequestStatus.EXPIRED)).toBe('Expired');
    expect(toContract.insuranceType(InsuranceType.THIRD_PARTY)).toBe('ThirdParty');
    expect(toContract.coverageDuration(CoverageDuration.Q4)).toBe('4q');
    expect(toContract.policyStatus(PolicyStatus.AWAITING_INSURER_CERTIFICATE)).toBe('Awaiting insurer certificate');
    expect(toContract.claimStatus(ClaimStatus.RECEIVED_BY_INSURER)).toBe('Received by insurer');
    expect(toContract.paymentMethod(PaymentMethod.MOBILE_MONEY)).toBe('Mobile money');
  });

  it('reads request bodies back into enums, and rejects anything else', () => {
    expect(fromContract.insuranceType('ThirdParty')).toBe(InsuranceType.THIRD_PARTY);
    expect(fromContract.coverageDuration('2q')).toBe(CoverageDuration.Q2);
    expect(fromContract.paymentMethod('Card')).toBe(PaymentMethod.CARD);

    // Unknown input must not resolve to an enum; the DTO layer refuses it.
    expect(fromContract.insuranceType('THIRD_PARTY')).toBeUndefined();
    expect(fromContract.coverageDuration('quarterly')).toBeUndefined();
    expect(fromContract.paymentMethod('')).toBeUndefined();
  });

  it('offers validation the exact values a DTO may accept', () => {
    expect(CONTRACT_VALUES.insuranceType).toEqual(['Comprehensive', 'ThirdParty']);
    expect(CONTRACT_VALUES.coverageDuration).toEqual(['1q', '2q', '3q', '4q']);
    expect(CONTRACT_VALUES.paymentMethod).toEqual(['Mobile money', 'Card']);
  });
});
