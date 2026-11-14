// Stored enum values, in the order of their PostgreSQL enum types.

export const QUOTE_REQUEST_STATUSES = ['SUBMITTED', 'QUOTED', 'EXPIRED'] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

export const INSURANCE_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY'] as const;
export type InsuranceType = (typeof INSURANCE_TYPES)[number];

/**
 * A product version is never edited after it leaves DRAFT. An insurer submits
 * a complete draft for review; an administrator either approves, rejects, or
 * later withdraws that immutable version. Editing a reviewed version starts a
 * new draft instead, which is what keeps a customer's comparison auditable.
 */
export const PRODUCT_VERSION_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const;
export type ProductVersionStatus = (typeof PRODUCT_VERSION_STATUSES)[number];

export const COVERAGE_DURATIONS = ['Q1', 'Q2', 'Q3', 'Q4'] as const;
export type CoverageDuration = (typeof COVERAGE_DURATIONS)[number];

/**
 * In lifecycle order. PENDING has never been approved to trade; ACTIVE trades;
 * SUSPENDED has been stopped and its open work cancelled; INACTIVE has had its
 * approval withdrawn; DELETED is removed. Only ACTIVE sells.
 */
export const INSURER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'INACTIVE', 'DELETED'] as const;
export type InsurerStatus = (typeof INSURER_STATUSES)[number];

/** The documents an insurer is reviewed on before it may trade. */
export const EVIDENCE_KINDS = ['LICENCE', 'TAX_CLEARANCE', 'INCORPORATION', 'AGREEMENT', 'OTHER'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export const EVIDENCE_REVIEW_STATES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type EvidenceReviewState = (typeof EVIDENCE_REVIEW_STATES)[number];

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

/** Maker/checker actions that must never be completed by one staff member alone. */
export const APPROVAL_ACTIONS = [
  'PIA_FLOOR_CHANGE',
  'INSURER_ACTIVATE',
  'INSURER_DEACTIVATE',
  'INSURER_SUSPEND',
  'INSURER_DELETE',
  'INSURER_RESTORE',
] as const;
export type ApprovalAction = (typeof APPROVAL_ACTIONS)[number];

/** A request reaches EXECUTED only after the business operation commits. */
export const APPROVAL_STATUSES = ['PENDING', 'REJECTED', 'EXPIRED', 'EXECUTED'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * InsurShield's own roles first, then the insurer ones. An InsurShield
 * administrator may grant any of these; an insurer administrator may grant only
 * the insurer ones, which is why the two groups are named separately below.
 *
 * INSURER_USER predates the rest and still carries the whole portal. It is
 * retired when the permission matrix gives each insurer role its own functions:
 * moving the rows onto INSURER_ADMIN cannot happen in the same migration run
 * that adds the value, because this migrator applies every pending migration in
 * one transaction and PostgreSQL refuses an enum value its own transaction added.
 */
export const INSURSHIELD_ROLES = ['SUPER_ADMIN', 'ADMIN'] as const;

export const INSURER_ROLES = [
  'INSURER_ADMIN',
  'QUOTE_OFFICER',
  'CLAIMS_OFFICER',
  'SUPPORT',
  'FINANCE',
  'COMPLIANCE_READ_ONLY',
  'INSURER_USER',
] as const;

export const STAFF_ROLES = [...INSURSHIELD_ROLES, ...INSURER_ROLES] as const;

/** Whether this role acts for an insurer rather than for InsurShield. */
export function isInsurerRole(role: StaffRole): role is InsurerRole {
  return (INSURER_ROLES as readonly StaffRole[]).includes(role);
}
export type InsurShieldRole = (typeof INSURSHIELD_ROLES)[number];
export type InsurerRole = (typeof INSURER_ROLES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];

export const DOCUMENT_KINDS = [
  'QUOTATION',
  'CERTIFICATE',
  'INSPECTION_PHOTO',
  'WHITE_BOOK',
  'CLAIM_ATTACHMENT',
  'INSURER_LOGO',
  'NCD_EVIDENCE',
  'INSURER_EVIDENCE',
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
  'COMPLIANCE_EVIDENCE',
] as const;
export type DocumentRetentionClass = (typeof DOCUMENT_RETENTION_CLASSES)[number];

export const DELIVERY_STATUSES = ['PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/**
 * A delivery and a final quote have different lifecycles, but an insurer
 * suspension can make either unavailable. Keeping the reason separate from
 * delivery and quote statuses preserves their operational history.
 */
export const QUOTE_UNAVAILABILITY_REASONS = ['INSURER_SUSPENDED'] as const;
export type QuoteUnavailabilityReason = (typeof QUOTE_UNAVAILABILITY_REASONS)[number];

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
