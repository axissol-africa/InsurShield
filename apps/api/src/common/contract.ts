import {
  INSURER_STATUSES,
  STAFF_ROLES,
  type ClaimStatus,
  type CoverageDuration,
  type InspectionStatus,
  type InsuranceType,
  type InsurerStatus,
  type NcdStatus,
  type PaymentMethod,
  type PaymentStatus,
  type PolicyStatus,
  type QuoteRequestStatus,
  type StaffRole,
} from './domain/enums.js';

/**
 * Translation between the stored enum values and the wire values in
 * `apps/web/src/api/contracts.js`.
 *
 * The contract is the agreement with the client, and the client branches on
 * these exact strings (`status === 'Expired'`, `insuranceType === 'ThirdParty'`),
 * so every response must speak them. Storage keeps the SCREAMING_CASE values of
 * the PostgreSQL enum types. These maps are the only place the two
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

const INSURER_STATUS: Record<InsurerStatus, string> = {
  PENDING: 'Pending approval',
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  INACTIVE: 'Inactive',
  DELETED: 'Deleted',
};

const STAFF_ROLE: Record<StaffRole, string> = {
  SUPER_ADMIN: 'Super administrator',
  ADMIN: 'Administrator',
  INSURER_ADMIN: 'Insurer administrator',
  QUOTE_OFFICER: 'Quote officer',
  CLAIMS_OFFICER: 'Claims and NCD officer',
  SUPPORT: 'Support',
  FINANCE: 'Finance',
  COMPLIANCE_READ_ONLY: 'Compliance, read only',
  INSURER_USER: 'Insurer portal user',
};

/**
 * The only statuses an administrator may set directly. Approval and suspension
 * each carry work beyond the status — an evidence gate, and cancelling the
 * insurer's open requests and quotes — so each gets its own route rather than
 * widening this one. Without this list, adding a status to the enum would
 * silently widen what the status route accepts.
 */
export const INSURER_STATUS_CHANGES = ['INACTIVE', 'DELETED'] as const satisfies readonly InsurerStatus[];
export type InsurerStatusChange = (typeof INSURER_STATUS_CHANGES)[number];

const INSURER_STATUS_CHANGE: Record<InsurerStatusChange, string> = {
  INACTIVE: INSURER_STATUS.INACTIVE,
  DELETED: INSURER_STATUS.DELETED,
};

/** The only NCD statuses an insurer can choose as a decision. */
export const NCD_DECISION_STATUSES = ['UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const satisfies readonly NcdStatus[];
export type NcdDecisionStatus = (typeof NCD_DECISION_STATUSES)[number];

const NCD_DECISION_STATUS: Record<NcdDecisionStatus, string> = {
  UNDER_REVIEW: NCD_STATUS.UNDER_REVIEW,
  APPROVED: NCD_STATUS.APPROVED,
  REJECTED: NCD_STATUS.REJECTED,
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
  insurerStatus: (value: InsurerStatus) => INSURER_STATUS[value],
  staffRole: (value: StaffRole) => STAFF_ROLE[value],
};

const readableOrStored = <T extends string>(map: Record<T, string>, storedValues: readonly T[]) => {
  const readable = invert(map);
  return (value: string): T | undefined =>
    readable[value] ?? (storedValues.includes(value as T) ? (value as T) : undefined);
};

/**
 * Client value → database enum, for request bodies. Unknown input returns
 * `undefined`; the DTO layer rejects it before it reaches a query.
 */
export const fromContract = {
  insuranceType: (value: string): InsuranceType | undefined => invert(INSURANCE_TYPE)[value],
  coverageDuration: (value: string): CoverageDuration | undefined => invert(COVERAGE_DURATION)[value],
  paymentMethod: (value: string): PaymentMethod | undefined => invert(PAYMENT_METHOD)[value],
  insurerStatus: readableOrStored(INSURER_STATUS, INSURER_STATUSES),
  insurerStatusChange: readableOrStored(INSURER_STATUS_CHANGE, INSURER_STATUS_CHANGES),
  staffRole: readableOrStored(STAFF_ROLE, STAFF_ROLES),
  ncdDecision: readableOrStored(NCD_DECISION_STATUS, NCD_DECISION_STATUSES),
};

/** The wire values a DTO may accept, so validation messages list real options. */
export const CONTRACT_VALUES = {
  insuranceType: Object.values(INSURANCE_TYPE),
  coverageDuration: Object.values(COVERAGE_DURATION),
  paymentMethod: Object.values(PAYMENT_METHOD),
  insurerStatus: [...INSURER_STATUSES, ...Object.values(INSURER_STATUS)],
  insurerStatusChange: [...INSURER_STATUS_CHANGES, ...Object.values(INSURER_STATUS_CHANGE)],
  staffRole: [...STAFF_ROLES, ...Object.values(STAFF_ROLE)],
  ncdDecision: [...NCD_DECISION_STATUSES, ...Object.values(NCD_DECISION_STATUS)],
};
