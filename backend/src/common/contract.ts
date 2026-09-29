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
 * Translation between the database enums and the wire values in
 * `frontend/src/api/contracts.js`.
 *
 * The contract is the agreement with the client, and the client branches on
 * these exact strings (`status === 'Expired'`, `insuranceType === 'ThirdParty'`),
 * so every response must speak them. Storage keeps SCREAMING_CASE enums, which
 * is what Prisma and Postgres want. These maps are the only place the two
 * vocabularies meet — nothing else should compare a raw enum to a wire string.
 */

const invert = <T extends string>(map: Record<T, string>): Record<string, T> =>
  Object.fromEntries(Object.entries(map).map(([key, value]) => [value as string, key as T])) as Record<string, T>;

const QUOTE_REQUEST_STATUS: Record<QuoteRequestStatus, string> = {
  SUBMITTED: 'Submitted',
  QUOTED: 'Quoted',
  EXPIRED: 'Expired',
};

const INSURANCE_TYPE: Record<InsuranceType, string> = {
  COMPREHENSIVE: 'Comprehensive',
  THIRD_PARTY: 'ThirdParty',
};

const COVERAGE_DURATION: Record<CoverageDuration, string> = {
  Q1: '1q',
  Q2: '2q',
  Q3: '3q',
  Q4: '4q',
};

const POLICY_STATUS: Record<PolicyStatus, string> = {
  AWAITING_INSURER_CERTIFICATE: 'Awaiting insurer certificate',
  ACTIVE: 'Active',
};

const CLAIM_STATUS: Record<ClaimStatus, string> = {
  NOTIFIED: 'Notified',
  RECEIVED_BY_INSURER: 'Received by insurer',
};

const NCD_STATUS: Record<NcdStatus, string> = {
  SUBMITTED: 'Submitted',
  UNDER_REVIEW: 'Under Review',
  VERIFICATION_REQUIRED: 'Verification Required',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  FAILED: 'Failed',
};

const PAYMENT_METHOD: Record<PaymentMethod, string> = {
  MOBILE_MONEY: 'Mobile money',
  CARD: 'Card',
};

const INSPECTION_STATUS: Record<InspectionStatus, string> = {
  REQUESTED: 'Requested',
  SCHEDULED: 'Scheduled',
  INSPECTOR_ASSIGNED: 'Inspector assigned',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  REPORT_READY: 'Report ready',
  APPROVED: 'Approved',
  FAILED: 'Failed',
};

/** Database enum → the value the client expects. */
export const toContract = {
  quoteRequestStatus: (value: QuoteRequestStatus) => QUOTE_REQUEST_STATUS[value],
  insuranceType: (value: InsuranceType) => INSURANCE_TYPE[value],
  coverageDuration: (value: CoverageDuration) => COVERAGE_DURATION[value],
  policyStatus: (value: PolicyStatus) => POLICY_STATUS[value],
  claimStatus: (value: ClaimStatus) => CLAIM_STATUS[value],
  ncdStatus: (value: NcdStatus) => NCD_STATUS[value],
  paymentStatus: (value: PaymentStatus) => PAYMENT_STATUS[value],
  paymentMethod: (value: PaymentMethod) => PAYMENT_METHOD[value],
  inspectionStatus: (value: InspectionStatus) => INSPECTION_STATUS[value],
};

/**
 * Client value → database enum, for request bodies. Unknown input returns
 * `undefined`; the DTO layer rejects it before it reaches a query.
 */
export const fromContract = {
  insuranceType: (value: string): InsuranceType | undefined => invert(INSURANCE_TYPE)[value],
  coverageDuration: (value: string): CoverageDuration | undefined => invert(COVERAGE_DURATION)[value],
  paymentMethod: (value: string): PaymentMethod | undefined => invert(PAYMENT_METHOD)[value],
};

/** The wire values a DTO may accept, so validation messages list real options. */
export const CONTRACT_VALUES = {
  insuranceType: Object.values(INSURANCE_TYPE),
  coverageDuration: Object.values(COVERAGE_DURATION),
  paymentMethod: Object.values(PAYMENT_METHOD),
};
