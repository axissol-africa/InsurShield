// Stored enum values, in the order of their PostgreSQL enum types.

export const QUOTE_REQUEST_STATUSES = ['SUBMITTED', 'QUOTED', 'EXPIRED'] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

export const INSURANCE_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY'] as const;
export type InsuranceType = (typeof INSURANCE_TYPES)[number];

export const COVERAGE_DURATIONS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
export type CoverageDuration = (typeof COVERAGE_DURATIONS)[number];

export const INSURER_STATUSES = ['ACTIVE', 'INACTIVE', 'DELETED'] as const;
export type InsurerStatus = (typeof INSURER_STATUSES)[number];

export const POLICY_STATUSES = ['AWAITING_INSURER_CERTIFICATE', 'ACTIVE'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['MOBILE_MONEY', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CLAIM_STATUSES = ['NOTIFIED', 'RECEIVED_BY_INSURER'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const NCD_STATUSES = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'VERIFICATION_REQUIRED',
  'APPROVED',
  'REJECTED',
] as const;
export type NcdStatus = (typeof NCD_STATUSES)[number];

export const INSPECTION_STATUSES = [
  'REQUESTED',
  'SCHEDULED',
  'INSPECTOR_ASSIGNED',
  'IN_PROGRESS',
  'COMPLETED',
  'REPORT_READY',
  'APPROVED',
  'FAILED',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export const INSPECTION_RULES = ['NOT_REQUIRED', 'OPTIONAL', 'REQUIRED'] as const;
export type InspectionRule = (typeof INSPECTION_RULES)[number];

export const INSPECTION_TIMINGS = ['BEFORE_QUOTATION', 'BEFORE_PAYMENT', 'AFTER_PAYMENT'] as const;
export type InspectionTiming = (typeof INSPECTION_TIMINGS)[number];

export const INSPECTION_METHODS = ['SELF_CAPTURE', 'PHYSICAL'] as const;
export type InspectionMethod = (typeof INSPECTION_METHODS)[number];

export const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'INSURER_USER'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const DOCUMENT_KINDS = [
  'QUOTATION',
  'CERTIFICATE',
  'INSPECTION_PHOTO',
  'WHITE_BOOK',
  'CLAIM_ATTACHMENT',
  'INSURER_LOGO',
  'NCD_EVIDENCE',
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * `UNSCANNED` exists for documents stored before scanning was introduced. The
 * API stores a new document only once a scanner has answered `CLEAN`, so an
 * infected file never reaches this enum at all.
 */
export const DOCUMENT_SCAN_STATUSES = ['UNSCANNED', 'CLEAN'] as const;
export type DocumentScanStatus = (typeof DOCUMENT_SCAN_STATUSES)[number];

/** How long a document is kept. The durations are settings, not code. */
export const DOCUMENT_RETENTION_CLASSES = [
  'UNDERWRITING_EVIDENCE',
  'POLICY_EVIDENCE',
  'CLAIM_EVIDENCE',
  'BRAND_ASSET',
] as const;
export type DocumentRetentionClass = (typeof DOCUMENT_RETENTION_CLASSES)[number];

export const DELIVERY_STATUSES = ['PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export const DELIVERY_KINDS = ['QUOTE_REQUEST', 'PAID_POLICY', 'CLAIM_NOTIFICATION'] as const;
export type DeliveryKind = (typeof DELIVERY_KINDS)[number];

export const ACTOR_TYPES = ['CUSTOMER', 'STAFF', 'INSURER', 'SYSTEM'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

/**
 * `RUNNING` means a runner holds a lease on the row, not that work is certainly
 * in progress: a runner that dies leaves the row `RUNNING` until its lease
 * expires, which is what makes the work claimable again rather than stuck.
 */
export const JOB_STATUSES = ['PENDING', 'RUNNING', 'DONE', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Decision 16 settles the MVP at these two; the column exists so a later batch adds one. */
export const NOTIFICATION_CHANNELS = ['IN_APP', 'EMAIL'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/**
 * An IN_APP notification is delivered by existing; only a channel that leaves
 * the platform has a delivery to succeed or fail, so those rows stay PENDING
 * until the runner has an answer from the provider.
 */
export const NOTIFICATION_DELIVERY_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationDeliveryStatus = (typeof NOTIFICATION_DELIVERY_STATUSES)[number];

/**
 * What a message is about, which is the grain a customer may switch off at.
 * Per event would be finer than any requirement asks for and would turn every
 * new template into a preference migration.
 */
export const NOTIFICATION_CATEGORIES = [
  'QUOTE',
  'PAYMENT',
  'POLICY',
  'CLAIM',
  'NCD',
  'INSPECTION',
  'ACCOUNT',
  'MARKETING',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];
