// Stored enum values, in the order of their PostgreSQL enum types.

export const QUOTE_REQUEST_STATUSES = ['SUBMITTED', 'QUOTED', 'EXPIRED'] as const;
export type QuoteRequestStatus = (typeof QUOTE_REQUEST_STATUSES)[number];

/**
 * Requests created before product selection remain readable as legacy records.
 * New requests are explicit about carrying a set of selected product versions;
 * the API must never infer that distinction from the presence of a quote.
 */
export const QUOTE_REQUEST_MODELS = ['LEGACY', 'PRODUCT_SELECTION'] as const;
export type QuoteRequestModel = (typeof QUOTE_REQUEST_MODELS)[number];

/**
 * Where one chosen product version stands with its insurer. Each version moves
 * on its own, so a request with two products can be quoted for one and
 * declined for the other. The transitions are in `customer/domain/quote-workflow.ts`.
 */
export const QUOTE_PRODUCT_STATUSES = [
  'SUBMITTED',
  'INSURER_PROCESSING',
  'VERIFICATION_REQUIRED',
  'INSPECTION_REQUIRED',
  'QUOTED',
  'DECLINED',
  'TIMED_OUT',
  'EXPIRED',
  'CANCELLED',
  'MANUAL_REVIEW',
] as const;
export type QuoteProductStatus = (typeof QUOTE_PRODUCT_STATUSES)[number];

/**
 * A final quote stays on record whatever happens to it. Only an ACTIVE one can
 * be chosen or paid; a withdrawn or replaced one is kept as history.
 */
export const QUOTE_STATUSES = ['ACTIVE', 'WITHDRAWN', 'SUPERSEDED'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** How urgently an insurer's team should work on a chosen product. */
export const QUOTE_PRIORITIES = ['NORMAL', 'HIGH'] as const;
export type QuotePriority = (typeof QUOTE_PRIORITIES)[number];

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

/**
 * Platform rules have typed payloads in `settings/domain/rules.ts`; this enum
 * keeps their durable identity stable without making every configuration value
 * an unstructured database column.
 */
export const RULE_SETTING_KEYS = [
  'PIA_FLOOR',
  'QUOTE_REPLY_DEADLINE',
  'NCD_POLICY',
  'DRIVER_QUESTIONS',
  'RISK_QUESTIONS',
  'ADD_ON_CATALOGUE',
  'USAGE_LOADINGS',
  'DOCUMENT_RETENTION',
  'QUOTE_DECLINE_REASONS',
  'QUOTE_SLA_WARNING',
  'PAYMENT_CHARGES',
  'PAYMENT_PENDING_TIMEOUT',
  'ISSUANCE_DEADLINE',
  'COMMISSION_RULE',
  'SETTLEMENT_PERIOD',
  'RENEWAL_POLICY',
  'ACCOUNT_RETENTION',
  'CLAIM_REPORTING',
] as const;
export type RuleSettingKey = (typeof RULE_SETTING_KEYS)[number];

/** A value may guide a non-production journey before compliance confirms it. */
export const RULE_SETTING_STATES = ['PROVISIONAL', 'CONFIRMED'] as const;
export type RuleSettingState = (typeof RULE_SETTING_STATES)[number];

/** The fixed vocabulary customers use to compare terms across insurers. */
export const COMPARISON_TAXONOMY_CATEGORIES = ['COVERAGE', 'EXCLUSION', 'LIMIT', 'EXCESS', 'ADD_ON'] as const;
export type ComparisonTaxonomyCategory = (typeof COMPARISON_TAXONOMY_CATEGORIES)[number];

export const COMPARISON_TAXONOMY_STATUSES = ['ACTIVE', 'DISABLED'] as const;
export type ComparisonTaxonomyStatus = (typeof COMPARISON_TAXONOMY_STATUSES)[number];

/** How a canonical comparison value is validated and presented. */
export const COMPARISON_VALUE_TYPES = ['TEXT', 'NUMBER', 'BOOLEAN', 'CURRENCY', 'LIST'] as const;
export type ComparisonValueType = (typeof COMPARISON_VALUE_TYPES)[number];

/** The customer comparison can either reserve a row or show it only when supplied. */
export const COMPARISON_DISPLAY_RULES = ['ALWAYS_SHOW', 'SHOW_WHEN_PROVIDED'] as const;
export type ComparisonDisplayRule = (typeof COMPARISON_DISPLAY_RULES)[number];

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

/** Payment alone never makes a policy active (DEC-019); only the insurer's certificate does. */
export const POLICY_STATUSES = ['AWAITING_INSURER_CERTIFICATE', 'ACTIVE', 'ISSUANCE_FAILED', 'CANCELLED'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

/**
 * INITIATED is written before the provider is called, PENDING once it has the
 * instruction. Only a verified provider callback or status check moves an
 * attempt on from there.
 */
export const PAYMENT_STATUSES = ['PENDING', 'CONFIRMED', 'FAILED', 'INITIATED', 'CANCELLED', 'EXPIRED', 'REVERSED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** The attempts still waiting on the provider. */
export const OPEN_PAYMENT_STATUSES = ['INITIATED', 'PENDING'] as const satisfies readonly PaymentStatus[];

/** Real provider names arrive with their adapters once DEC-008 names them. */
export const PAYMENT_PROVIDER_NAMES = ['STAND_IN'] as const;
export type PaymentProviderName = (typeof PAYMENT_PROVIDER_NAMES)[number];

/**
 * A customer's request to an insurer about a policy they hold. APPROVED is the
 * insurer's recorded decision; COMPLETED is when the change is done.
 */
export const SERVICE_REQUEST_STATUSES = [
  'SUBMITTED',
  'IN_REVIEW',
  'INFORMATION_REQUIRED',
  'APPROVED',
  'COMPLETED',
  'DECLINED',
  'WITHDRAWN',
] as const;
export type ServiceRequestStatus = (typeof SERVICE_REQUEST_STATUSES)[number];

export const FINAL_SERVICE_REQUEST_STATUSES = ['COMPLETED', 'DECLINED', 'WITHDRAWN'] as const satisfies readonly ServiceRequestStatus[];
export const OPEN_SERVICE_REQUEST_STATUSES = ['SUBMITTED', 'IN_REVIEW', 'INFORMATION_REQUIRED', 'APPROVED'] as const satisfies readonly ServiceRequestStatus[];

/** Only a cancellation changes the policy, and only when it is completed. */
export const SERVICE_REQUEST_TYPES = ['DETAILS_CHANGE', 'DOCUMENT_REPLACEMENT', 'CANCELLATION', 'ASSISTANCE'] as const;
export type ServiceRequestType = (typeof SERVICE_REQUEST_TYPES)[number];

/** Who wrote an entry on a service request. Staff identities stay with InsurShield and the insurer. */
export const SERVICE_REQUEST_AUTHORS = ['CUSTOMER', 'INSURER', 'SYSTEM'] as const;
export type ServiceRequestAuthor = (typeof SERVICE_REQUEST_AUTHORS)[number];

/** Something about money that a person has to look at and close. */
export const RECONCILIATION_KINDS = [
  'REFUND_REQUIRED',
  'AMOUNT_MISMATCH',
  'REVERSAL',
  'UNMATCHED_PROVIDER_EVENT',
  'STATE_CONFLICT',
  'ISSUANCE_FAILED',
  'ISSUANCE_OVERDUE',
  'PENDING_TOO_LONG',
  'STATEMENT_UNMATCHED',
  'MISSING_FROM_STATEMENT',
  'DUPLICATE',
] as const;
export type ReconciliationKind = (typeof RECONCILIATION_KINDS)[number];

export const RECONCILIATION_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export const RECONCILIATION_OUTCOMES = ['REFUNDED', 'ADJUSTED', 'ISSUED', 'NO_ACTION', 'WRITTEN_OFF'] as const;
export type ReconciliationOutcome = (typeof RECONCILIATION_OUTCOMES)[number];

/** A refund is proposed by one administrator and approved by another before any money moves. */
export const REFUND_STATUSES = ['PROPOSED', 'APPROVED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'FAILED'] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];
/** Still able to move money; at most one per payment at a time. */
export const OPEN_REFUND_STATUSES = ['PROPOSED', 'APPROVED', 'SUBMITTED'] as const satisfies readonly RefundStatus[];

export const REFUND_REASONS = ['ISSUANCE_FAILED', 'INSURER_UNAVAILABLE', 'DUPLICATE_PAYMENT', 'AMOUNT_MISMATCH', 'CUSTOMER_REQUEST', 'OTHER'] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** One line of a provider's statement, in the provider-neutral CSV. */
export const STATEMENT_LINE_TYPES = ['CHARGE', 'REFUND', 'REVERSAL'] as const;
export type StatementLineType = (typeof STATEMENT_LINE_TYPES)[number];
export const STATEMENT_LINE_STATUSES = ['MATCHED', 'UNMATCHED', 'MISMATCH', 'DUPLICATE'] as const;
export type StatementLineStatus = (typeof STATEMENT_LINE_STATUSES)[number];

/** A settlement is drafted, sent for a second administrator's approval, and then frozen. */
export const SETTLEMENT_STATUSES = ['DRAFT', 'PROPOSED', 'FINALISED'] as const;
export type SettlementStatus = (typeof SETTLEMENT_STATUSES)[number];
export const SETTLEMENT_LINE_KINDS = ['PAYMENT', 'REFUND', 'ADJUSTMENT'] as const;
export type SettlementLineKind = (typeof SETTLEMENT_LINE_KINDS)[number];
/** Why money is moved in or out of an insurer's next settlement outside a payment or refund. */
export const ADJUSTMENT_KINDS = ['SETTLEMENT_CORRECTION', 'REVERSAL_RECOVERY', 'FEE_CORRECTION', 'OTHER'] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const PAYMENT_METHODS = ['MOBILE_MONEY', 'CARD'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const CLAIM_STATUSES = [
  'NOTIFIED', 'RECEIVED_BY_INSURER', 'UNDER_REVIEW', 'EVIDENCE_REQUIRED', 'APPROVED', 'DECLINED', 'CLOSED',
] as const;
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
  'CANCELLED',
  'NO_SHOW',
] as const;
export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

/** A customer-requested appointment, or one an insurer's product needs before it quotes or is paid. */
export const INSPECTION_PURPOSES = ['GENERAL', 'UNDERWRITING'] as const;
export type InspectionPurpose = (typeof INSPECTION_PURPOSES)[number];

export const INSPECTION_RESULTS = ['PASSED', 'FAILED'] as const;
export type InspectionResult = (typeof INSPECTION_RESULTS)[number];

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
  'PAYMENT_REFUND',
  'MONEY_ADJUSTMENT',
  'SETTLEMENT_FINALISE',
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
  'SERVICE_REQUEST_DOCUMENT',
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

/**
 * `FAILED` is the exception queue: automation has exhausted its permitted
 * attempts and needs an authorised person to complete the hand-off. The
 * failure stays visible until `MANUAL_FALLBACK` records that outcome.
 */
export const DELIVERY_STATUSES = ['PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED', 'MANUAL_FALLBACK'] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** The system an integration delivery is headed to, rather than its business event. */
export const INTEGRATION_TARGET_KINDS = ['INSURER_API', 'RTSA', 'PAYMENT_GATEWAY'] as const;
export type IntegrationTargetKind = (typeof INTEGRATION_TARGET_KINDS)[number];

/**
 * A delivery and a final quote have different lifecycles, but an insurer
 * suspension can make either unavailable. Keeping the reason separate from
 * delivery and quote statuses preserves their operational history.
 */
/** Why a chosen product stopped being quotable: its insurer was suspended, or the customer closed their account. */
export const QUOTE_UNAVAILABILITY_REASONS = ['INSURER_SUSPENDED', 'ACCOUNT_CLOSED'] as const;
export type QuoteUnavailabilityReason = (typeof QUOTE_UNAVAILABILITY_REASONS)[number];

export const DELIVERY_KINDS = [
  'QUOTE_REQUEST',
  'PAID_POLICY',
  'CLAIM_NOTIFICATION',
  'VEHICLE_LOOKUP',
  'PAYMENT_CONFIRMATION',
  'POLICY_ISSUED',
] as const;
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

/** Why an insurer could not issue a paid policy. The customer is told in the insurer's own words. */
export const ISSUANCE_FAILURE_REASONS = ['RISK_NOT_ACCEPTED', 'VEHICLE_DETAILS_WRONG', 'DOCUMENTS_MISSING', 'DUPLICATE_COVER', 'OTHER'] as const;
export type IssuanceFailureReason = (typeof ISSUANCE_FAILURE_REASONS)[number];
