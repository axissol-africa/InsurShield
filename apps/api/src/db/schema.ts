import { randomUUID } from 'node:crypto';
import { sql, type SQL } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
  type UpdateDeleteAction,
} from 'drizzle-orm/pg-core';
import {
  ACTOR_TYPES,
  APPROVAL_ACTIONS,
  APPROVAL_STATUSES,
  CLAIM_STATUSES,
  COVERAGE_DURATIONS,
  DELIVERY_KINDS,
  DELIVERY_STATUSES,
  DOCUMENT_KINDS,
  DOCUMENT_RETENTION_CLASSES,
  DOCUMENT_SCAN_STATUSES,
  EVIDENCE_KINDS,
  EVIDENCE_REVIEW_STATES,
  INSPECTION_METHODS,
  INSPECTION_PURPOSES,
  INSPECTION_RESULTS,
  INSPECTION_RULES,
  INSPECTION_STATUSES,
  INSPECTION_TIMINGS,
  INTEGRATION_TARGET_KINDS,
  INSURANCE_TYPES,
  INSURER_STATUSES,
  NCD_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_PROVIDER_NAMES,
  ADJUSTMENT_KINDS,
  STATEMENT_LINE_STATUSES,
  STATEMENT_LINE_TYPES,
  REFUND_REASONS,
  REFUND_STATUSES,
  SETTLEMENT_LINE_KINDS,
  SETTLEMENT_STATUSES,
  PAYMENT_STATUSES,
  RECONCILIATION_KINDS,
  RECONCILIATION_OUTCOMES,
  RECONCILIATION_STATUSES,
  POLICY_STATUSES,
  PRODUCT_VERSION_STATUSES,
  RULE_SETTING_KEYS,
  RULE_SETTING_STATES,
  COMPARISON_TAXONOMY_CATEGORIES,
  COMPARISON_TAXONOMY_STATUSES,
  COMPARISON_VALUE_TYPES,
  COMPARISON_DISPLAY_RULES,
  QUOTE_UNAVAILABILITY_REASONS,
  QUOTE_PRODUCT_STATUSES,
  QUOTE_PRIORITIES,
  QUOTE_STATUSES,
  QUOTE_REQUEST_MODELS,
  QUOTE_REQUEST_STATUSES,
  STAFF_ROLES,
  JOB_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_CATEGORIES,
} from '../common/domain/enums.js';
import { MAX_NGWEE, MAX_RATE_BPS, MIN_NGWEE, MIN_RATE_BPS } from '../common/domain/money-limits.js';

export type QuoteComponent = { code: string; label: string; amountMinor: number };
export type QuoteAddOn = { code: string; label: string; priceMinor: number; included: boolean; terms: string | null };
export type QuoteCondition = { code: string; text: string; purchaseCritical: boolean };
/** One line of what a customer pays: the premium, a chosen add-on, or an approved charge. */
export type PaymentLine = { kind: 'PREMIUM' | 'ADD_ON' | 'CHARGE'; code: string; label: string; amountMinor: number };

// Physical names are the ones Prisma created; only the money and rate columns were renamed.

export const quoteRequestStatus = pgEnum('QuoteRequestStatus', QUOTE_REQUEST_STATUSES);
export const quoteRequestModel = pgEnum('QuoteRequestModel', QUOTE_REQUEST_MODELS);
export const quoteProductStatus = pgEnum('QuoteProductStatus', QUOTE_PRODUCT_STATUSES);
export const quotePriority = pgEnum('QuotePriority', QUOTE_PRIORITIES);
export const quoteStatus = pgEnum('QuoteStatus', QUOTE_STATUSES);
export const insuranceType = pgEnum('InsuranceType', INSURANCE_TYPES);
export const coverageDuration = pgEnum('CoverageDuration', COVERAGE_DURATIONS);
export const insurerStatus = pgEnum('InsurerStatus', INSURER_STATUSES);
export const evidenceKind = pgEnum('EvidenceKind', EVIDENCE_KINDS);
export const evidenceReviewState = pgEnum('EvidenceReviewState', EVIDENCE_REVIEW_STATES);
export const policyStatus = pgEnum('PolicyStatus', POLICY_STATUSES);
export const productVersionStatus = pgEnum('ProductVersionStatus', PRODUCT_VERSION_STATUSES);
export const ruleSettingKey = pgEnum('RuleSettingKey', RULE_SETTING_KEYS);
export const ruleSettingState = pgEnum('RuleSettingState', RULE_SETTING_STATES);
export const comparisonTaxonomyCategory = pgEnum('ComparisonTaxonomyCategory', COMPARISON_TAXONOMY_CATEGORIES);
export const comparisonTaxonomyStatus = pgEnum('ComparisonTaxonomyStatus', COMPARISON_TAXONOMY_STATUSES);
export const comparisonValueType = pgEnum('ComparisonValueType', COMPARISON_VALUE_TYPES);
export const comparisonDisplayRule = pgEnum('ComparisonDisplayRule', COMPARISON_DISPLAY_RULES);
export const paymentStatus = pgEnum('PaymentStatus', PAYMENT_STATUSES);
export const paymentMethod = pgEnum('PaymentMethod', PAYMENT_METHODS);
export const paymentProviderName = pgEnum('PaymentProviderName', PAYMENT_PROVIDER_NAMES);
export const reconciliationKind = pgEnum('ReconciliationKind', RECONCILIATION_KINDS);
export const reconciliationStatus = pgEnum('ReconciliationStatus', RECONCILIATION_STATUSES);
export const reconciliationOutcome = pgEnum('ReconciliationOutcome', RECONCILIATION_OUTCOMES);
export const claimStatus = pgEnum('ClaimStatus', CLAIM_STATUSES);
export const ncdStatus = pgEnum('NcdStatus', NCD_STATUSES);
export const inspectionStatus = pgEnum('InspectionStatus', INSPECTION_STATUSES);
export const inspectionRule = pgEnum('InspectionRule', INSPECTION_RULES);
export const inspectionTiming = pgEnum('InspectionTiming', INSPECTION_TIMINGS);
export const inspectionMethod = pgEnum('InspectionMethod', INSPECTION_METHODS);
export const inspectionPurpose = pgEnum('InspectionPurpose', INSPECTION_PURPOSES);
export const inspectionResult = pgEnum('InspectionResult', INSPECTION_RESULTS);
export const staffRole = pgEnum('StaffRole', STAFF_ROLES);
export const documentKind = pgEnum('DocumentKind', DOCUMENT_KINDS);
export const documentScanStatus = pgEnum('DocumentScanStatus', DOCUMENT_SCAN_STATUSES);
export const documentRetentionClass = pgEnum('DocumentRetentionClass', DOCUMENT_RETENTION_CLASSES);
export const deliveryStatus = pgEnum('DeliveryStatus', DELIVERY_STATUSES);
export const quoteUnavailabilityReason = pgEnum('QuoteUnavailabilityReason', QUOTE_UNAVAILABILITY_REASONS);
export const deliveryKind = pgEnum('DeliveryKind', DELIVERY_KINDS);
export const integrationTargetKind = pgEnum('IntegrationTargetKind', INTEGRATION_TARGET_KINDS);
export const actorType = pgEnum('ActorType', ACTOR_TYPES);
export const jobStatus = pgEnum('JobStatus', JOB_STATUSES);
export const notificationChannel = pgEnum('NotificationChannel', NOTIFICATION_CHANNELS);
export const notificationCategory = pgEnum('NotificationCategory', NOTIFICATION_CATEGORIES);
export const notificationDeliveryStatus = pgEnum('NotificationDeliveryStatus', NOTIFICATION_DELIVERY_STATUSES);
export const approvalAction = pgEnum('ApprovalAction', APPROVAL_ACTIONS);
export const approvalStatus = pgEnum('ApprovalStatus', APPROVAL_STATUSES);

const timestamptz = (name: string) =>
  timestamp(name, { withTimezone: true, precision: 3, mode: 'date' });

const createdAt = (name = 'createdAt') =>
  timestamptz(name).notNull().default(sql`CURRENT_TIMESTAMP`);

// Prisma set "updatedAt" in the client, so the column has no database default.
const updatedAt = () =>
  timestamptz('updatedAt')
    .notNull()
    .$defaultFn(() => new Date())
    .$onUpdate(() => new Date());

const id = () => uuid('id').primaryKey().$defaultFn(randomUUID);

const ngwee = (name: string) => bigint(name, { mode: 'number' });
/** Money that can go either way, such as an adjustment or a net payable. */
const signedNgwee = ngwee;

function fk(
  name: string,
  columns: [AnyPgColumn, ...AnyPgColumn[]],
  foreignColumns: [AnyPgColumn, ...AnyPgColumn[]],
  onDelete: UpdateDeleteAction,
) {
  return foreignKey({ name, columns, foreignColumns }).onUpdate('cascade').onDelete(onDelete);
}

function withinBounds(column: AnyPgColumn, min: bigint | number, max: bigint | number): SQL {
  return sql`${column} >= ${sql.raw(String(min))} AND ${column} <= ${sql.raw(String(max))}`;
}

const moneyCheck = (table: string, column: AnyPgColumn) =>
  check(`${table}_${column.name}_check`, withinBounds(column, MIN_NGWEE, MAX_NGWEE));

const rateCheck = (table: string, column: AnyPgColumn) =>
  check(`${table}_${column.name}_check`, withinBounds(column, MIN_RATE_BPS, MAX_RATE_BPS));

// Better Auth's models, with exactly the fields it declares for the configured options.

export const authUsers = pgTable(
  'auth_users',
  {
    id: id(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('emailVerified').notNull().default(false),
    /** Enabled only for provisioned staff; customer sign-in remains password based. */
    twoFactorEnabled: boolean('twoFactorEnabled').default(false),
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('auth_users_email_key').on(t.email),
    check('auth_users_email_check', sql`${t.email} = lower(${t.email})`),
  ],
);

/**
 * Better Auth's 2FA model. Staff use the email-code route only; the required
 * non-null secret and backup fields are deliberately opaque because this
 * platform never exposes TOTP or backup-code enrolment.
 */
export const authTwoFactors = pgTable(
  'auth_two_factors',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backupCodes').notNull(),
    userId: uuid('userId').notNull(),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failedVerificationCount').default(0),
    lockedUntil: timestamptz('lockedUntil'),
  },
  (t) => [
    index('auth_two_factors_secret_idx').on(t.secret),
    index('auth_two_factors_userId_idx').on(t.userId),
    index('auth_two_factors_lockedUntil_idx').on(t.lockedUntil),
    fk('auth_two_factors_userId_fkey', [t.userId], [authUsers.id], 'cascade'),
  ],
);

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: id(),
    expiresAt: timestamptz('expiresAt').notNull(),
    token: text('token').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: uuid('userId').notNull(),
  },
  (t) => [
    uniqueIndex('auth_sessions_token_key').on(t.token),
    index('auth_sessions_userId_idx').on(t.userId),
    fk('auth_sessions_userId_fkey', [t.userId], [authUsers.id], 'cascade'),
  ],
);

export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: id(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: uuid('userId').notNull(),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: timestamptz('accessTokenExpiresAt'),
    refreshTokenExpiresAt: timestamptz('refreshTokenExpiresAt'),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('auth_accounts_providerId_accountId_key').on(t.providerId, t.accountId),
    index('auth_accounts_userId_idx').on(t.userId),
    fk('auth_accounts_userId_fkey', [t.userId], [authUsers.id], 'cascade'),
  ],
);

export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamptz('expiresAt').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_verifications_identifier_idx').on(t.identifier)],
);

export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    id: id(),
    key: text('key').notNull(),
    count: integer('count').notNull(),
    lastRequest: bigint('lastRequest', { mode: 'number' }).notNull(),
  },
  (t) => [uniqueIndex('auth_rate_limits_key_key').on(t.key)],
);

// Not a Better Auth model: Better Auth prunes auth_rate_limits rows after its longest window.
export const authSignInFailures = pgTable(
  'auth_sign_in_failures',
  {
    emailKey: varchar('emailKey', { length: 254 }).primaryKey(),
    attempts: integer('attempts').notNull(),
    windowStartedAt: timestamptz('windowStartedAt').notNull(),
    lockedUntil: timestamptz('lockedUntil'),
  },
  (t) => [
    index('auth_sign_in_failures_windowStartedAt_idx').on(t.windowStartedAt),
    check('auth_sign_in_failures_emailKey_check', sql`${t.emailKey} = lower(${t.emailKey})`),
  ],
);

export const customers = pgTable(
  'customers',
  {
    id: id(),
    fullName: text('fullName').notNull(),
    email: text('email').notNull(),
    phone: text('phone').notNull(),
    emailVerifiedAt: timestamptz('emailVerifiedAt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deletedAt'),
    userId: uuid('userId'),
  },
  (t) => [
    uniqueIndex('customers_email_key').on(t.email),
    uniqueIndex('customers_phone_key').on(t.phone),
    uniqueIndex('customers_userId_key').on(t.userId),
    index('customers_deletedAt_idx').on(t.deletedAt),
    fk('customers_userId_fkey', [t.userId], [authUsers.id], 'restrict'),
  ],
);

export const consentRecords = pgTable(
  'consent_records',
  {
    id: id(),
    customerId: uuid('customerId').notNull(),
    privacyVersion: text('privacyVersion').notNull(),
    termsVersion: text('termsVersion').notNull(),
    acceptedAt: createdAt('acceptedAt'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
  },
  (t) => [
    index('consent_records_customerId_acceptedAt_idx').on(t.customerId, t.acceptedAt),
    fk('consent_records_customerId_fkey', [t.customerId], [customers.id], 'cascade'),
  ],
);

/** A team belongs to one insurer; roles, not teams, decide permissions. */
export const staffTeams = pgTable(
  'staff_teams',
  {
    id: id(),
    insurerId: uuid('insurerId').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('staff_teams_insurerId_name_key').on(t.insurerId, t.name),
    index('staff_teams_insurerId_idx').on(t.insurerId),
    fk('staff_teams_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
  ],
);

export const staffUsers = pgTable(
  'staff_users',
  {
    id: id(),
    email: text('email').notNull(),
    fullName: text('fullName').notNull(),
    role: staffRole('role').notNull(),
    insurerId: uuid('insurerId'),
    isActive: boolean('isActive').notNull().default(true),
    teamId: uuid('teamId'),
    lastLoginAt: timestamptz('lastLoginAt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    userId: uuid('userId'),
  },
  (t) => [
    uniqueIndex('staff_users_email_key').on(t.email),
    uniqueIndex('staff_users_userId_key').on(t.userId),
    index('staff_users_insurerId_idx').on(t.insurerId),
    index('staff_users_teamId_idx').on(t.teamId),
    fk('staff_users_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('staff_users_teamId_fkey', [t.teamId], [staffTeams.id], 'restrict'),
    fk('staff_users_userId_fkey', [t.userId], [authUsers.id], 'restrict'),
  ],
);

/**
 * One immutable support-reset request per delivery attempt. It records only
 * operational metadata: the reset secret itself stays in Better Auth's
 * verification table and is never available to a staff browser or audit read.
 */
export const supportPasswordResetAttempts = pgTable(
  'support_password_reset_attempts',
  {
    id: id(),
    customerId: uuid('customerId').notNull(),
    requestedByStaffId: uuid('requestedByStaffId').notNull(),
    deliveryChannel: text('deliveryChannel').notNull().default('EMAIL'),
    reason: text('reason').notNull(),
    deliveryStatus: deliveryStatus('deliveryStatus').notNull().default('PENDING'),
    deliveryProvider: text('deliveryProvider'),
    deliveryReference: text('deliveryReference'),
    deliveredAt: timestamptz('deliveredAt'),
    failedAt: timestamptz('failedAt'),
    createdAt: createdAt(),
  },
  (t) => [
    index('support_password_reset_attempts_customerId_createdAt_idx').on(t.customerId, t.createdAt),
    index('support_password_reset_attempts_requestedByStaffId_createdAt_idx').on(t.requestedByStaffId, t.createdAt),
    check('support_password_reset_attempts_deliveryChannel_check', sql`${t.deliveryChannel} = 'EMAIL'`),
    check('support_password_reset_attempts_reason_check', sql`length(btrim(${t.reason})) >= 10`),
    fk('support_password_reset_attempts_customerId_fkey', [t.customerId], [customers.id], 'restrict'),
    fk('support_password_reset_attempts_requestedByStaffId_fkey', [t.requestedByStaffId], [staffUsers.id], 'restrict'),
  ],
);

export const insurers = pgTable(
  'insurers',
  {
    id: id(),
    name: text('name').notNull(),
    tradingName: text('tradingName'),
    status: insurerStatus('status').notNull().default('ACTIVE'),
    rateBps: integer('rateBps').notNull(),
    quoteValidityDays: integer('quoteValidityDays').notNull(),
    coverage: text('coverage').notNull(),
    plan: text('plan'),
    licenceNumber: text('licenceNumber'),
    licenceExpiry: timestamptz('licenceExpiry'),
    // What activation recorded: US-ADM-002 asks for the dates, the approver and
    // any conditions, so a decision to let an insurer trade can be read back.
    effectiveFrom: date('effectiveFrom', { mode: 'date' }),
    renewalDate: date('renewalDate', { mode: 'date' }),
    approvedBy: uuid('approvedBy'),
    approvedAt: timestamptz('approvedAt'),
    activationConditions: text('activationConditions'),
    logoUrl: text('logoUrl'),
    ncdAccepted: boolean('ncdAccepted').notNull().default(true),
    inspectionRule: inspectionRule('inspectionRule').notNull().default('OPTIONAL'),
    inspectionTiming: inspectionTiming('inspectionTiming').notNull().default('BEFORE_PAYMENT'),
    inspectionMethod: inspectionMethod('inspectionMethod').notNull().default('SELF_CAPTURE'),
    icon: text('icon'),
    isBestValue: boolean('isBestValue').notNull().default(false),
    benefits: text('benefits').array(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: timestamptz('deletedAt'),
    registrationNumber: text('registrationNumber'),
    tpin: text('tpin'),
    website: text('website'),
  },
  (t) => [
    uniqueIndex('insurers_name_key').on(t.name),
    index('insurers_status_idx').on(t.status),
    rateCheck('insurers', t.rateBps),
  ],
);

export const insurerContacts = pgTable(
  'insurer_contacts',
  {
    insurerId: uuid('insurerId').primaryKey(),
    tagline: text('tagline'),
    contactPerson: text('contactPerson').notNull(),
    role: text('role').notNull(),
    phone: text('phone').notNull(),
    mobile: text('mobile'),
    whatsapp: text('whatsapp'),
    email: text('email').notNull(),
    address: text('address'),
    hours: text('hours'),
  },
  (t) => [fk('insurer_contacts_insurerId_fkey', [t.insurerId], [insurers.id], 'cascade')],
);

export const insurerIntegrations = pgTable(
  'insurer_integrations',
  {
    insurerId: uuid('insurerId').primaryKey(),
    apiBaseUrl: text('apiBaseUrl').notNull(),
    publicSigningKey: text('publicSigningKey').notNull(),
    quoteCallbackUrl: text('quoteCallbackUrl'),
    claimsCallbackUrl: text('claimsCallbackUrl'),
    policyCallbackUrl: text('policyCallbackUrl'),
    clientId: text('clientId').notNull(),
    // Captured when an insurer integration is actually built, which needs a
    // decision about where the key lives; onboarding records the rest without it.
    clientSecretEncrypted: text('clientSecretEncrypted'),
    sandboxMode: boolean('sandboxMode').notNull().default(true),
    activatedAt: timestamptz('activatedAt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('insurer_integrations_clientId_key').on(t.clientId),
    fk('insurer_integrations_insurerId_fkey', [t.insurerId], [insurers.id], 'cascade'),
  ],
);

/** Licence, compliance and agreement documents an insurer is reviewed on. */
export const insurerEvidence = pgTable(
  'insurer_evidence',
  {
    id: id(),
    insurerId: uuid('insurerId').notNull(),
    kind: evidenceKind('kind').notNull(),
    /**
     * The scanned document, under the same rules as every other upload.
     *
     * Null only for a licence grandfathered in: the API requires a document to
     * capture evidence, so an absent one is itself the mark of a record nobody
     * has produced papers for yet.
     */
    documentId: uuid('documentId'),
    /** The issuer's own reference, as printed on the document. */
    reference: text('reference'),
    expiresAt: date('expiresAt', { mode: 'date' }),
    state: evidenceReviewState('state').notNull().default('PENDING'),
    reviewedBy: uuid('reviewedBy'),
    reviewedAt: timestamptz('reviewedAt'),
    note: text('note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('insurer_evidence_insurerId_kind_idx').on(t.insurerId, t.kind),
    fk('insurer_evidence_insurerId_fkey', [t.insurerId], [insurers.id], 'cascade'),
    fk('insurer_evidence_documentId_fkey', [t.documentId], [documents.id], 'restrict'),
    fk('insurer_evidence_reviewedBy_fkey', [t.reviewedBy], [staffUsers.id], 'restrict'),
  ],
);

/**
 * The durable identity of an insurer's product. The code is stable within the
 * insurer; every customer-facing term belongs to an immutable version below.
 */
export const insurerProducts = pgTable(
  'insurer_products',
  {
    id: id(),
    insurerId: uuid('insurerId').notNull(),
    code: varchar('code', { length: 80 }).notNull(),
    // Cover type belongs to the durable product identity. A correction can
    // revise its terms, but cannot turn a comprehensive product into a
    // different third-party product under the same code and history.
    coverType: insuranceType('coverType').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('insurer_products_insurerId_code_key').on(t.insurerId, t.code),
    index('insurer_products_insurerId_idx').on(t.insurerId),
    fk('insurer_products_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
  ],
);

/**
 * A point-in-time set of product terms. Versions are updated only while they
 * are drafts; submitted and reviewed versions remain immutable evidence of
 * what customers could compare and what administrators approved.
 */
export const insurerProductVersions = pgTable(
  'insurer_product_versions',
  {
    id: id(),
    productId: uuid('productId').notNull(),
    versionNumber: integer('versionNumber').notNull(),
    status: productVersionStatus('status').notNull().default('DRAFT'),
    name: text('name').notNull(),
    coverType: insuranceType('coverType').notNull(),
    coverGuide: jsonb('coverGuide').$type<Record<string, unknown>>().notNull(),
    inspectionRule: inspectionRule('inspectionRule').notNull(),
    inspectionTiming: inspectionTiming('inspectionTiming'),
    inspectionMethod: inspectionMethod('inspectionMethod'),
    /** Batch 13: whether a failed inspection may be repeated instead of declining the product. */
    reinspectionAllowed: boolean('reinspectionAllowed').notNull().default(false),
    /** Rate and visibility are reviewed with every immutable product version. */
    rateBps: integer('rateBps').notNull(),
    showEstimate: boolean('showEstimate').notNull().default(false),
    /** A product can choose any approved subset of the four platform terms. */
    allowedDurations: coverageDuration('allowedDurations').array().notNull().default(sql`ARRAY['Q1', 'Q2', 'Q3', 'Q4']::"CoverageDuration"[]`),
    effectiveFrom: date('effectiveFrom', { mode: 'date' }).notNull(),
    effectiveUntil: date('effectiveUntil', { mode: 'date' }),
    createdByStaffId: uuid('createdByStaffId').notNull(),
    submittedByStaffId: uuid('submittedByStaffId'),
    submittedAt: timestamptz('submittedAt'),
    reviewedByStaffId: uuid('reviewedByStaffId'),
    reviewedAt: timestamptz('reviewedAt'),
    reviewComment: text('reviewComment'),
    withdrawnByStaffId: uuid('withdrawnByStaffId'),
    withdrawnAt: timestamptz('withdrawnAt'),
    withdrawalReason: text('withdrawalReason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('insurer_product_versions_productId_versionNumber_key').on(t.productId, t.versionNumber),
    index('insurer_product_versions_status_effectiveFrom_idx').on(t.status, t.effectiveFrom),
    index('insurer_product_versions_productId_status_idx').on(t.productId, t.status),
    fk('insurer_product_versions_productId_fkey', [t.productId], [insurerProducts.id], 'restrict'),
    fk('insurer_product_versions_createdByStaffId_fkey', [t.createdByStaffId], [staffUsers.id], 'restrict'),
    fk('insurer_product_versions_submittedByStaffId_fkey', [t.submittedByStaffId], [staffUsers.id], 'restrict'),
    fk('insurer_product_versions_reviewedByStaffId_fkey', [t.reviewedByStaffId], [staffUsers.id], 'restrict'),
    fk('insurer_product_versions_withdrawnByStaffId_fkey', [t.withdrawnByStaffId], [staffUsers.id], 'restrict'),
    check(
      'insurer_product_versions_effective_window_check',
      sql`${t.effectiveUntil} IS NULL OR ${t.effectiveUntil} >= ${t.effectiveFrom}`,
    ),
    check(
      'insurer_product_versions_inspection_rule_check',
      sql`(${t.inspectionRule} = 'NOT_REQUIRED' AND ${t.inspectionTiming} IS NULL AND ${t.inspectionMethod} IS NULL)
        OR (${t.inspectionRule} <> 'NOT_REQUIRED' AND ${t.inspectionTiming} IS NOT NULL AND ${t.inspectionMethod} IS NOT NULL)`,
    ),
    rateCheck('insurer_product_versions', t.rateBps),
  ],
);

/**
 * Configuration values vary by key, but their identity, timeframe and review
 * state are relational. The domain validates the JSON payload per typed key.
 */
export const platformRuleVersions = pgTable(
  'platform_rule_versions',
  {
    id: id(),
    key: ruleSettingKey('key').notNull(),
    versionNumber: integer('versionNumber').notNull(),
    state: ruleSettingState('state').notNull().default('PROVISIONAL'),
    value: jsonb('value').$type<Record<string, unknown>>().notNull(),
    effectiveFrom: date('effectiveFrom', { mode: 'date' }).notNull(),
    effectiveUntil: date('effectiveUntil', { mode: 'date' }),
    createdByStaffId: uuid('createdByStaffId').notNull(),
    confirmedByStaffId: uuid('confirmedByStaffId'),
    confirmedAt: timestamptz('confirmedAt'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('platform_rule_versions_key_versionNumber_key').on(t.key, t.versionNumber),
    index('platform_rule_versions_key_effectiveFrom_idx').on(t.key, t.effectiveFrom),
    index('platform_rule_versions_state_effectiveFrom_idx').on(t.state, t.effectiveFrom),
    fk('platform_rule_versions_createdByStaffId_fkey', [t.createdByStaffId], [staffUsers.id], 'restrict'),
    fk('platform_rule_versions_confirmedByStaffId_fkey', [t.confirmedByStaffId], [staffUsers.id], 'restrict'),
    check(
      'platform_rule_versions_effective_window_check',
      sql`${t.effectiveUntil} IS NULL OR ${t.effectiveUntil} >= ${t.effectiveFrom}`,
    ),
  ],
);

/** Platform-owned comparison vocabulary. Disabling preserves historic mappings. */
export const comparisonTaxonomyItems = pgTable(
  'comparison_taxonomy_items',
  {
    id: id(),
    code: varchar('code', { length: 80 }).notNull(),
    label: text('label').notNull(),
    description: text('description'),
    category: comparisonTaxonomyCategory('category').notNull(),
    versionNumber: integer('versionNumber').notNull().default(1),
    dataType: comparisonValueType('dataType').notNull().default('TEXT'),
    unit: varchar('unit', { length: 80 }),
    allowedValues: jsonb('allowedValues').$type<string[]>().notNull().default([]),
    displayRule: comparisonDisplayRule('displayRule').notNull().default('SHOW_WHEN_PROVIDED'),
    status: comparisonTaxonomyStatus('status').notNull().default('ACTIVE'),
    displayOrder: integer('displayOrder').notNull().default(0),
    createdByStaffId: uuid('createdByStaffId').notNull(),
    updatedByStaffId: uuid('updatedByStaffId'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('comparison_taxonomy_items_code_key').on(t.code),
    index('comparison_taxonomy_items_status_order_idx').on(t.status, t.displayOrder),
    fk('comparison_taxonomy_items_createdByStaffId_fkey', [t.createdByStaffId], [staffUsers.id], 'restrict'),
    fk('comparison_taxonomy_items_updatedByStaffId_fkey', [t.updatedByStaffId], [staffUsers.id], 'restrict'),
  ],
);

/**
 * A product version records the exact mapped comparison values its insurer
 * submitted.  Editing a draft replaces its mappings; approved mappings are
 * immutable with the rest of the version.
 */
export const productVersionComparisonItems = pgTable(
  'product_version_comparison_items',
  {
    id: id(),
    productVersionId: uuid('productVersionId').notNull(),
    taxonomyItemId: uuid('taxonomyItemId').notNull(),
    taxonomyVersion: integer('taxonomyVersion').notNull(),
    taxonomyCode: varchar('taxonomyCode', { length: 80 }).notNull(),
    taxonomyLabel: text('taxonomyLabel').notNull(),
    taxonomyDescription: text('taxonomyDescription'),
    taxonomyCategory: comparisonTaxonomyCategory('taxonomyCategory').notNull(),
    taxonomyDataType: comparisonValueType('taxonomyDataType').notNull(),
    taxonomyUnit: varchar('taxonomyUnit', { length: 80 }),
    taxonomyAllowedValues: jsonb('taxonomyAllowedValues').$type<string[]>().notNull().default([]),
    taxonomyDisplayRule: comparisonDisplayRule('taxonomyDisplayRule').notNull(),
    included: boolean('included').notNull().default(true),
    valueText: text('valueText'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('product_version_comparison_items_version_taxonomy_key').on(t.productVersionId, t.taxonomyItemId),
    index('product_version_comparison_items_productVersionId_idx').on(t.productVersionId),
    fk('product_version_comparison_items_productVersionId_fkey', [t.productVersionId], [insurerProductVersions.id], 'cascade'),
    fk('product_version_comparison_items_taxonomyItemId_fkey', [t.taxonomyItemId], [comparisonTaxonomyItems.id], 'restrict'),
  ],
);

/**
 * Typed customer inputs an insurer has attached to one immutable product
 * version.  A version can be edited only while it is a draft; after review the
 * requirement metadata remains the terms a customer actually selected.
 */
export const productVersionRequirements = pgTable(
  'product_version_requirements',
  {
    id: id(),
    productVersionId: uuid('productVersionId').notNull(),
    key: varchar('key', { length: 80 }).notNull(),
    kind: varchar('kind', { length: 20 }).notNull(),
    label: text('label').notNull(),
    helpText: text('helpText'),
    required: boolean('required').notNull().default(true),
    /** Typed by kind in the product domain; never interpreted from coverGuide. */
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    displayOrder: integer('displayOrder').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('product_version_requirements_version_key').on(t.productVersionId, t.key),
    index('product_version_requirements_version_order_idx').on(t.productVersionId, t.displayOrder),
    fk('product_version_requirements_productVersionId_fkey', [t.productVersionId], [insurerProductVersions.id], 'cascade'),
    check('product_version_requirements_display_order_check', sql`${t.displayOrder} >= 0`),
    check('product_version_requirements_kind_check', sql`${t.kind} IN ('QUESTION', 'DOCUMENT', 'DECLARATION')`),
    check('product_version_requirements_config_object_check', sql`jsonb_typeof(${t.config}) = 'object'`),
  ],
);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    kind: documentKind('kind').notNull(),
    fileName: text('fileName').notNull(),
    mimeType: text('mimeType').notNull(),
    sizeBytes: integer('sizeBytes').notNull(),
    storageKey: text('storageKey').notNull(),
    checksumSha256: text('checksumSha256'),
    // Documents stored before scanning existed stay UNSCANNED, and unreadable.
    scanStatus: documentScanStatus('scanStatus').notNull().default('UNSCANNED'),
    scannedAt: timestamptz('scannedAt'),
    scannerName: text('scannerName'),
    retentionClass: documentRetentionClass('retentionClass').notNull(),
    uploadedAt: createdAt('uploadedAt'),
    uploadedByCustomerId: uuid('uploadedByCustomerId'),
    uploadedByStaffId: uuid('uploadedByStaffId'),
  },
  (t) => [
    uniqueIndex('documents_storageKey_key').on(t.storageKey),
    index('documents_kind_idx').on(t.kind),
    index('documents_scanStatus_idx').on(t.scanStatus),
    fk('documents_uploadedByCustomerId_fkey', [t.uploadedByCustomerId], [customers.id], 'set null'),
    fk('documents_uploadedByStaffId_fkey', [t.uploadedByStaffId], [staffUsers.id], 'set null'),
  ],
);

/**
 * An authenticated customer's unfinished product-selection journey. Drafts
 * keep only pre-submission answers and references: no insurer receives them
 * and no vehicle, request, recipient or payment record exists until submit.
 */
export const quoteRequestDrafts = pgTable(
  'quote_request_drafts',
  {
    id: id(),
    customerId: uuid('customerId').notNull(),
    commonAnswers: jsonb('commonAnswers').$type<Record<string, unknown>>().notNull().default({}),
    selectedProductVersionIds: uuid('selectedProductVersionIds').array().notNull().default(sql`'{}'::uuid[]`),
    configurableAnswers: jsonb('configurableAnswers').$type<Record<string, unknown>>().notNull().default({}),
    expiresAt: timestamptz('expiresAt').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('quote_request_drafts_customerId_updatedAt_idx').on(t.customerId, t.updatedAt),
    index('quote_request_drafts_expiresAt_idx').on(t.expiresAt),
    fk('quote_request_drafts_customerId_fkey', [t.customerId], [customers.id], 'cascade'),
    check('quote_request_drafts_selected_products_limit_check', sql`cardinality(${t.selectedProductVersionIds}) <= 5`),
  ],
);

/**
 * Document references are relational rather than opaque JSON. They disappear
 * with a draft, while the uploaded object remains customer-owned and can be
 * attached to a submitted request only after that workflow's own checks.
 */
export const quoteRequestDraftDocuments = pgTable(
  'quote_request_draft_documents',
  {
    id: id(),
    quoteRequestDraftId: uuid('quoteRequestDraftId').notNull(),
    slot: varchar('slot', { length: 80 }).notNull(),
    kind: documentKind('kind').notNull(),
    documentId: uuid('documentId').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('quote_request_draft_documents_draft_slot_key').on(t.quoteRequestDraftId, t.slot),
    uniqueIndex('quote_request_draft_documents_draft_document_key').on(t.quoteRequestDraftId, t.documentId),
    index('quote_request_draft_documents_documentId_idx').on(t.documentId),
    fk(
      'quote_request_draft_documents_quoteRequestDraftId_fkey',
      [t.quoteRequestDraftId],
      [quoteRequestDrafts.id],
      'cascade',
    ),
    fk('quote_request_draft_documents_documentId_fkey', [t.documentId], [documents.id], 'restrict'),
  ],
);

export const vehicles = pgTable(
  'vehicles',
  {
    id: id(),
    plateNumber: text('plateNumber').notNull(),
    make: text('make').notNull(),
    model: text('model').notNull(),
    year: text('year').notNull(),
    color: text('color'),
    chassisNumber: text('chassisNumber'),
    engineNumber: text('engineNumber'),
    registrationDate: timestamptz('registrationDate'),
    rtsaAnniversaryDate: timestamptz('rtsaAnniversaryDate'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    registrationCountry: text('registrationCountry'),
  },
  (t) => [index('vehicles_plateNumber_idx').on(t.plateNumber)],
);

export const quoteRequests = pgTable(
  'quote_requests',
  {
    id: text('id').primaryKey(),
    /** Legacy records have no selected product-version rows by design. */
    model: quoteRequestModel('model').notNull().default('LEGACY'),
    status: quoteRequestStatus('status').notNull().default('SUBMITTED'),
    submittedAt: createdAt('submittedAt'),
    expiresAt: timestamptz('expiresAt').notNull(),
    customerId: uuid('customerId').notNull(),
    vehicleId: uuid('vehicleId').notNull(),
    vehicleValueMinor: ngwee('vehicleValueMinor').notNull(),
    vehicleUsage: text('vehicleUsage').notNull(),
    insuranceType: insuranceType('insuranceType').notNull(),
    coverageDuration: coverageDuration('coverageDuration').notNull(),
    matchRtsaAnniversary: boolean('matchRtsaAnniversary').notNull().default(false),
    rtsaRegistrationDate: timestamptz('rtsaRegistrationDate'),
    policyStartDate: timestamptz('policyStartDate'),
    policyEndDate: timestamptz('policyEndDate'),
    coverageDays: integer('coverageDays'),
    whiteBookDocumentId: uuid('whiteBookDocumentId'),
    ncdCode: text('ncdCode'),
    ncdPercentage: integer('ncdPercentage'),
    photosCapturedAt: timestamptz('photosCapturedAt'),
    requotedFromId: text('requotedFromId'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    renewalOfPolicyNumber: text('renewalOfPolicyNumber'),
  },
  // quote_requests and policies reference each other; the annotation breaks the type cycle.
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex('quote_requests_requotedFromId_key').on(t.requotedFromId),
    index('quote_requests_customerId_submittedAt_idx').on(t.customerId, t.submittedAt),
    index('quote_requests_status_expiresAt_idx').on(t.status, t.expiresAt),
    index('quote_requests_renewalOfPolicyNumber_idx').on(t.renewalOfPolicyNumber),
    fk('quote_requests_customerId_fkey', [t.customerId], [customers.id], 'restrict'),
    fk('quote_requests_vehicleId_fkey', [t.vehicleId], [vehicles.id], 'restrict'),
    fk('quote_requests_whiteBookDocumentId_fkey', [t.whiteBookDocumentId], [documents.id], 'restrict'),
    fk('quote_requests_requotedFromId_fkey', [t.requotedFromId], [t.id], 'set null'),
    fk(
      'quote_requests_renewalOfPolicyNumber_fkey',
      [t.renewalOfPolicyNumber],
      [policies.policyNumber],
      'set null',
    ),
    moneyCheck('quote_requests', t.vehicleValueMinor),
  ],
);

export const quoteRequestRecipients = pgTable(
  'quote_request_recipients',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    insurerId: uuid('insurerId').notNull(),
    status: deliveryStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    deliveredAt: timestamptz('deliveredAt'),
    acknowledgedAt: timestamptz('acknowledgedAt'),
    lastError: text('lastError'),
    // Delivery status remains the delivery record. A suspension is a separate
    // business mark so operations can still see whether it was delivered.
    cancelledAt: timestamptz('cancelledAt'),
    cancelledReason: quoteUnavailabilityReason('cancelledReason'),
  },
  (t) => [
    index('quote_request_recipients_insurerId_status_idx').on(t.insurerId, t.status),
    index('quote_request_recipients_insurerId_cancelledAt_idx').on(t.insurerId, t.cancelledAt),
    uniqueIndex('quote_request_recipients_quoteRequestId_insurerId_key').on(
      t.quoteRequestId,
      t.insurerId,
    ),
    fk(
      'quote_request_recipients_quoteRequestId_fkey',
      [t.quoteRequestId],
      [quoteRequests.id],
      'cascade',
    ),
    fk('quote_request_recipients_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    check(
      'quote_request_recipients_cancellation_mark_check',
      sql`(${t.cancelledAt} IS NULL) = (${t.cancelledReason} IS NULL)`,
    ),
  ],
);

/**
 * The immutable product-version choices a customer made for a request.  The
 * insurer is deliberately derived through the version's product, which keeps
 * the selection tied to the exact approved terms the customer compared.
 *
 * Legacy requests predate product selection and therefore have no rows here;
 * they remain readable through the nullable productVersionId on insurerQuotes.
 */
export const quoteRequestProductVersions = pgTable(
  'quote_request_product_versions',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    productVersionId: uuid('productVersionId').notNull(),
    insurerId: uuid('insurerId').notNull(),
    // These form the customer-readable immutable selection record. The linked
    // product version remains the source of truth for insurer operations, but
    // it must not rewrite what a customer actually compared and selected.
    productCode: varchar('productCode', { length: 80 }).notNull(),
    productVersionNumber: integer('productVersionNumber').notNull(),
    productName: text('productName').notNull(),
    coverType: insuranceType('coverType').notNull(),
    coverGuide: jsonb('coverGuide').$type<Record<string, unknown>>().notNull(),
    inspectionRule: inspectionRule('inspectionRule').notNull(),
    inspectionTiming: inspectionTiming('inspectionTiming'),
    inspectionMethod: inspectionMethod('inspectionMethod'),
    selectedAt: createdAt('selectedAt'),
    // Decision 24 is a business cancellation, not a change to the historical
    // selection or to the delivery record's operational state.
    cancelledAt: timestamptz('cancelledAt'),
    cancelledReason: quoteUnavailabilityReason('cancelledReason'),
    // Batch 13: where this version stands with its insurer. Only the
    // transitions in customer/domain/quote-workflow.ts write it.
    status: quoteProductStatus('status').notNull().default('SUBMITTED'),
    statusChangedAt: createdAt('statusChangedAt'),
    /** When the insurer must answer by. Waiting for the customer moves it on (see pausedAt). */
    replyDueAt: timestamptz('replyDueAt'),
    /** Set while the customer is being waited for, so the reply clock is stopped. */
    pausedAt: timestamptz('pausedAt'),
    /** A code from the QUOTE_DECLINE_REASONS rule in force when the insurer declined. */
    declineReasonCode: varchar('declineReasonCode', { length: 80 }),
    /** Shown to the customer under the reason's customer wording. */
    declineCustomerNote: text('declineCustomerNote'),
    // Batch 13 part 2: who at the insurer owns this product, and how urgent it is.
    assignedStaffId: uuid('assignedStaffId'),
    assignedAt: timestamptz('assignedAt'),
    priority: quotePriority('priority').notNull().default('NORMAL'),
    /** Set once the owner has been warned that the reply due date is near, so they are warned once. */
    slaWarnedAt: timestamptz('slaWarnedAt'),
  },
  (t) => [
    // This is a referenced key, so it is a constraint rather than only a
    // unique index. PostgreSQL can then create the dependent requirement
    // foreign keys when drizzle-kit pushes a fresh schema.
    unique('quote_request_product_versions_request_version_key').on(t.quoteRequestId, t.productVersionId),
    index('quote_request_product_versions_productVersionId_idx').on(t.productVersionId),
    index('quote_request_product_versions_insurerId_cancelledAt_idx').on(t.insurerId, t.cancelledAt),
    fk('quote_request_product_versions_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    fk(
      'quote_request_product_versions_productVersionId_fkey',
      [t.productVersionId],
      [insurerProductVersions.id],
      'restrict',
    ),
    fk('quote_request_product_versions_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    check(
      'quote_request_product_versions_inspection_rule_check',
      sql`(${t.inspectionRule} = 'NOT_REQUIRED' AND ${t.inspectionTiming} IS NULL AND ${t.inspectionMethod} IS NULL)
        OR (${t.inspectionRule} <> 'NOT_REQUIRED' AND ${t.inspectionTiming} IS NOT NULL AND ${t.inspectionMethod} IS NOT NULL)`,
    ),
    check(
      'quote_request_product_versions_cancellation_mark_check',
      sql`(${t.cancelledAt} IS NULL) = (${t.cancelledReason} IS NULL)`,
    ),
    // The reply-deadline job reads open versions by due date.
    index('quote_request_product_versions_status_replyDueAt_idx').on(t.status, t.replyDueAt),
    index('quote_request_product_versions_assignedStaffId_idx').on(t.assignedStaffId),
    fk('quote_request_product_versions_assignedStaffId_fkey', [t.assignedStaffId], [staffUsers.id], 'set null'),
    check(
      'quote_request_product_versions_assignment_check',
      sql`(${t.assignedStaffId} IS NULL) = (${t.assignedAt} IS NULL)`,
    ),
    check(
      'quote_request_product_versions_decline_check',
      sql`(${t.status} = 'DECLINED') = (${t.declineReasonCode} IS NOT NULL)
        AND (${t.declineCustomerNote} IS NULL OR ${t.declineReasonCode} IS NOT NULL)`,
    ),
    check(
      'quote_request_product_versions_cancelled_check',
      sql`${t.status} <> 'CANCELLED' OR ${t.cancelledAt} IS NOT NULL`,
    ),
    check(
      'quote_request_product_versions_paused_check',
      sql`${t.pausedAt} IS NULL OR ${t.status} IN ('VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED')`,
    ),
  ],
);

/**
 * An insurer's question to the customer about one chosen version. While it is
 * open the version waits in VERIFICATION_REQUIRED with its reply clock
 * stopped. It closes when the customer answers, or when the version moves on
 * without an answer (quoted, declined, cancelled or timed out).
 */
export const quoteInformationRequests = pgTable(
  'quote_information_requests',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    productVersionId: uuid('productVersionId').notNull(),
    insurerId: uuid('insurerId').notNull(),
    requestedByStaffId: uuid('requestedByStaffId'),
    /** Shown to the customer as written. */
    message: text('message').notNull(),
    dueAt: timestamptz('dueAt').notNull(),
    createdAt: createdAt(),
    answeredAt: timestamptz('answeredAt'),
    answerText: text('answerText'),
    closedAt: timestamptz('closedAt'),
  },
  (t) => [
    // At most one open question per chosen version.
    uniqueIndex('quote_information_requests_open_key')
      .on(t.quoteRequestId, t.productVersionId)
      .where(sql`${t.closedAt} IS NULL`),
    index('quote_information_requests_insurerId_createdAt_idx').on(t.insurerId, t.createdAt),
    foreignKey({
      name: 'quote_information_requests_selection_fkey',
      columns: [t.quoteRequestId, t.productVersionId],
      foreignColumns: [quoteRequestProductVersions.quoteRequestId, quoteRequestProductVersions.productVersionId],
    }).onDelete('cascade'),
    fk('quote_information_requests_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('quote_information_requests_requestedByStaffId_fkey', [t.requestedByStaffId], [staffUsers.id], 'set null'),
    check(
      'quote_information_requests_answer_check',
      sql`(${t.answeredAt} IS NULL) = (${t.answerText} IS NULL)
        AND (${t.answeredAt} IS NULL OR ${t.closedAt} IS NOT NULL)`,
    ),
    check('quote_information_requests_message_check', sql`char_length(${t.message}) BETWEEN 1 AND 2000`),
  ],
);

/**
 * The insurer's own notes on a chosen version. They are append-only (a
 * trigger refuses UPDATE and DELETE, as for audit_logs) and never reach a
 * customer response, a notification or an audit summary.
 */
export const quoteInternalNotes = pgTable(
  'quote_internal_notes',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    productVersionId: uuid('productVersionId').notNull(),
    insurerId: uuid('insurerId').notNull(),
    authorStaffId: uuid('authorStaffId'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('quote_internal_notes_selection_createdAt_idx').on(t.quoteRequestId, t.productVersionId, t.createdAt),
    foreignKey({
      name: 'quote_internal_notes_selection_fkey',
      columns: [t.quoteRequestId, t.productVersionId],
      foreignColumns: [quoteRequestProductVersions.quoteRequestId, quoteRequestProductVersions.productVersionId],
    }).onDelete('restrict'),
    fk('quote_internal_notes_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('quote_internal_notes_authorStaffId_fkey', [t.authorStaffId], [staffUsers.id], 'set null'),
    check('quote_internal_notes_body_check', sql`char_length(${t.body}) BETWEEN 1 AND 4000`),
  ],
);

/**
 * A customer answer is stored against the selected product version rather
 * than in a request-wide JSON blob.  The composite foreign key prevents an
 * answer being attached to an unselected product.
 */
export const quoteRequestProductRequirementAnswers = pgTable(
  'quote_request_product_requirement_answers',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    productVersionId: uuid('productVersionId').notNull(),
    requirementKey: varchar('requirementKey', { length: 80 }).notNull(),
    value: jsonb('value').$type<string | number | boolean>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('quote_request_requirement_answers_request_version_key').on(t.quoteRequestId, t.productVersionId, t.requirementKey),
    index('quote_request_requirement_answers_request_idx').on(t.quoteRequestId),
    fk('quote_request_requirement_answers_request_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    foreignKey({
      name: 'quote_request_requirement_answers_selection_fkey',
      columns: [t.quoteRequestId, t.productVersionId],
      foreignColumns: [quoteRequestProductVersions.quoteRequestId, quoteRequestProductVersions.productVersionId],
    }).onDelete('cascade'),
  ],
);

/** A declaration is an affirmative record, retained with the selected terms. */
export const quoteRequestProductRequirementDeclarations = pgTable(
  'quote_request_product_requirement_declarations',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    productVersionId: uuid('productVersionId').notNull(),
    requirementKey: varchar('requirementKey', { length: 80 }).notNull(),
    acceptedAt: createdAt('acceptedAt'),
  },
  (t) => [
    uniqueIndex('quote_request_requirement_declarations_request_version_key').on(t.quoteRequestId, t.productVersionId, t.requirementKey),
    index('quote_request_requirement_declarations_request_idx').on(t.quoteRequestId),
    fk('quote_request_requirement_declarations_request_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    foreignKey({
      name: 'quote_request_requirement_declarations_selection_fkey',
      columns: [t.quoteRequestId, t.productVersionId],
      foreignColumns: [quoteRequestProductVersions.quoteRequestId, quoteRequestProductVersions.productVersionId],
    }).onDelete('cascade'),
  ],
);

/** Evidence is similarly scoped to the selected product that required it. */
export const quoteRequestProductRequirementDocuments = pgTable(
  'quote_request_product_requirement_documents',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    productVersionId: uuid('productVersionId').notNull(),
    requirementKey: varchar('requirementKey', { length: 80 }).notNull(),
    documentId: uuid('documentId').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('quote_request_requirement_documents_request_version_key').on(t.quoteRequestId, t.productVersionId, t.requirementKey),
    index('quote_request_requirement_documents_request_idx').on(t.quoteRequestId),
    index('quote_request_requirement_documents_document_idx').on(t.documentId),
    fk('quote_request_requirement_documents_request_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    fk('quote_request_requirement_documents_document_fkey', [t.documentId], [documents.id], 'restrict'),
    foreignKey({
      name: 'quote_request_requirement_documents_selection_fkey',
      columns: [t.quoteRequestId, t.productVersionId],
      foreignColumns: [quoteRequestProductVersions.quoteRequestId, quoteRequestProductVersions.productVersionId],
    }).onDelete('cascade'),
  ],
);

export const insurerQuotes = pgTable(
  'insurer_quotes',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    insurerId: uuid('insurerId').notNull(),
    // Legacy quotes have no selected product version.  New quote responses
    // bind to exactly one immutable version so multiple products from one
    // insurer can be compared and paid independently.
    productVersionId: uuid('productVersionId'),
    premiumMinor: ngwee('premiumMinor').notNull(),
    notes: text('notes'),
    insurerReference: text('insurerReference'),
    validityDays: integer('validityDays').notNull(),
    sentAt: createdAt('sentAt'),
    validUntil: timestamptz('validUntil').notNull(),
    extendedAt: timestamptz('extendedAt'),
    documentId: uuid('documentId').notNull(),
    // A suspension does not rewrite the quote or its expiry. It marks the
    // otherwise historical quote as no longer payable.
    unpayableAt: timestamptz('unpayableAt'),
    unpayableReason: quoteUnavailabilityReason('unpayableReason'),
    // Batch 13: a quote is withdrawn or replaced, never edited.
    status: quoteStatus('status').notNull().default('ACTIVE'),
    withdrawnAt: timestamptz('withdrawnAt'),
    withdrawnReason: text('withdrawnReason'),
    supersededById: uuid('supersededById'),
    /** How the premium is made up: `{ code, label, amountMinor }`, summing to the premium when given. */
    componentsMinor: jsonb('componentsMinor').$type<QuoteComponent[]>().notNull().default(sql`'[]'::jsonb`),
    excessMinor: ngwee('excessMinor'),
    /** Add-ons the insurer offers with this quote: `{ code, label, priceMinor, included, terms }`. */
    addOns: jsonb('addOns').$type<QuoteAddOn[]>().notNull().default(sql`'[]'::jsonb`),
    /** Conditions of the quote. A purchase-critical one must be accepted before payment. */
    conditions: jsonb('conditions').$type<QuoteCondition[]>().notNull().default(sql`'[]'::jsonb`),
  },
  (t) => [
    uniqueIndex('insurer_quotes_documentId_key').on(t.documentId),
    index('insurer_quotes_validUntil_idx').on(t.validUntil),
    index('insurer_quotes_insurerId_unpayableAt_idx').on(t.insurerId, t.unpayableAt),
    index('insurer_quotes_productVersionId_idx').on(t.productVersionId),
    // Keep the pre-Batch-12 one-quote-per-insurer rule for historical rows.
    // New rows are unique per selected version instead, including two
    // versions belonging to the same insurer.
    uniqueIndex('insurer_quotes_legacy_request_insurer_key')
      .on(t.quoteRequestId, t.insurerId)
      .where(sql`${t.productVersionId} IS NULL`),
    // One current quote per chosen version; withdrawn and replaced ones stay as history.
    uniqueIndex('insurer_quotes_request_product_version_key')
      .on(t.quoteRequestId, t.productVersionId)
      .where(sql`${t.productVersionId} IS NOT NULL AND ${t.status} = 'ACTIVE'`),
    fk('insurer_quotes_supersededById_fkey', [t.supersededById], [t.id], 'set null'),
    check('insurer_quotes_withdrawn_check', sql`(${t.status} = 'WITHDRAWN') = (${t.withdrawnAt} IS NOT NULL)`),
    check('insurer_quotes_superseded_check', sql`${t.status} <> 'SUPERSEDED' OR ${t.supersededById} IS NOT NULL`),
    moneyCheck('insurer_quotes', t.excessMinor),
    // An insurer may deliberately use one reference while quoting several
    // selected products.  Retain the former rule only for legacy rows.
    uniqueIndex('insurer_quotes_quoteRequestId_insurerReference_key')
      .on(t.quoteRequestId, t.insurerReference)
      .where(sql`${t.productVersionId} IS NULL`),
    fk('insurer_quotes_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    fk('insurer_quotes_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('insurer_quotes_productVersionId_fkey', [t.productVersionId], [insurerProductVersions.id], 'restrict'),
    fk('insurer_quotes_documentId_fkey', [t.documentId], [documents.id], 'restrict'),
    moneyCheck('insurer_quotes', t.premiumMinor),
    check(
      'insurer_quotes_unpayable_mark_check',
      sql`(${t.unpayableAt} IS NULL) = (${t.unpayableReason} IS NULL)`,
    ),
  ],
);

export const inspectionShots = pgTable(
  'inspection_shots',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    shotKey: text('shotKey').notNull(),
    documentId: uuid('documentId').notNull(),
    capturedAt: createdAt('capturedAt'),
  },
  (t) => [
    uniqueIndex('inspection_shots_quoteRequestId_shotKey_key').on(t.quoteRequestId, t.shotKey),
    fk('inspection_shots_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    fk('inspection_shots_documentId_fkey', [t.documentId], [documents.id], 'restrict'),
  ],
);

/**
 * The quote a customer has chosen for a request, with the conditions they
 * accepted. One per request: choosing again replaces it, and the audit trail
 * keeps the history. Payment of a quote with purchase-critical conditions
 * needs this row to name that quote.
 */
export const quoteSelections = pgTable(
  'quote_selections',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    insurerQuoteId: uuid('insurerQuoteId').notNull(),
    customerId: uuid('customerId').notNull(),
    acceptedConditionCodes: text('acceptedConditionCodes').array().notNull().default(sql`'{}'::text[]`),
    /** Optional add-ons the customer chose; included ones need no choice. */
    selectedAddOnCodes: text('selectedAddOnCodes').array().notNull().default(sql`'{}'::text[]`),
    selectedAt: timestamptz('selectedAt').notNull(),
  },
  (t) => [
    uniqueIndex('quote_selections_quoteRequestId_key').on(t.quoteRequestId),
    index('quote_selections_insurerQuoteId_idx').on(t.insurerQuoteId),
    fk('quote_selections_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    fk('quote_selections_insurerQuoteId_fkey', [t.insurerQuoteId], [insurerQuotes.id], 'restrict'),
    fk('quote_selections_customerId_fkey', [t.customerId], [customers.id], 'cascade'),
  ],
);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    transactionId: text('transactionId').notNull(),
    status: paymentStatus('status').notNull().default('PENDING'),
    method: paymentMethod('method').notNull(),
    amountMinor: ngwee('amountMinor').notNull(),
    rtsaAnniversaryFeeMinor: ngwee('rtsaAnniversaryFeeMinor').notNull().default(0),
    currency: text('currency').notNull().default('ZMW'),
    confirmedAt: timestamptz('confirmedAt'),
    failureReason: text('failureReason'),
    providerReference: text('providerReference'),
    idempotencyKey: text('idempotencyKey').notNull(),
    customerId: uuid('customerId').notNull(),
    quoteRequestId: text('quoteRequestId').notNull(),
    insurerQuoteId: uuid('insurerQuoteId').notNull(),
    provider: paymentProviderName('provider').notNull().default('STAND_IN'),
    /** The provider's own id, known once it accepted the instruction. */
    providerPaymentId: varchar('providerPaymentId', { length: 200 }),
    /** Card checkout only. Short-lived, and never written to a log or an audit entry. */
    checkoutUrl: text('checkoutUrl'),
    payerMsisdnMasked: varchar('payerMsisdnMasked', { length: 24 }),
    amountBreakdown: jsonb('amountBreakdown').$type<PaymentLine[]>().notNull().default(sql`'[]'::jsonb`),
    selectionId: uuid('selectionId'),
    initiatedAt: timestamptz('initiatedAt'),
    /** The price is held until then; a confirmation after it is not honoured. */
    pendingUntil: timestamptz('pendingUntil'),
    failureCode: varchar('failureCode', { length: 60 }),
    reversedAt: timestamptz('reversedAt'),
    reversalReference: varchar('reversalReference', { length: 200 }),
    lastStatusCheckAt: timestamptz('lastStatusCheckAt'),
    /** The finalised settlement that paid this to the insurer; set once, so nothing is settled twice. */
    settlementId: uuid('settlementId'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_transactionId_key').on(t.transactionId),
    uniqueIndex('payments_idempotencyKey_key').on(t.idempotencyKey),
    uniqueIndex('payments_provider_providerPaymentId_key').on(t.provider, t.providerPaymentId),
    uniqueIndex('payments_quoteRequestId_open_key')
      .on(t.quoteRequestId)
      .where(sql`${t.status} IN ('INITIATED', 'PENDING')`),
    uniqueIndex('payments_quoteRequestId_confirmed_key')
      .on(t.quoteRequestId)
      .where(sql`${t.status} = 'CONFIRMED'`),
    index('payments_selectionId_idx').on(t.selectionId),
    fk('payments_selectionId_fkey', [t.selectionId], [quoteSelections.id], 'set null'),
    index('payments_customerId_createdAt_idx').on(t.customerId, t.createdAt),
    index('payments_status_idx').on(t.status),
    fk('payments_customerId_fkey', [t.customerId], [customers.id], 'restrict'),
    fk('payments_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'restrict'),
    fk('payments_insurerQuoteId_fkey', [t.insurerQuoteId], [insurerQuotes.id], 'restrict'),
    moneyCheck('payments', t.amountMinor),
    moneyCheck('payments', t.rtsaAnniversaryFeeMinor),
  ],
);

export const policies = pgTable(
  'policies',
  {
    policyNumber: text('policyNumber').primaryKey(),
    insurerPolicyNumber: text('insurerPolicyNumber'),
    status: policyStatus('status').notNull().default('AWAITING_INSURER_CERTIFICATE'),
    insurerId: uuid('insurerId').notNull(),
    customerId: uuid('customerId').notNull(),
    vehicleId: uuid('vehicleId').notNull(),
    coverage: text('coverage').notNull(),
    plan: text('plan'),
    premiumMinor: ngwee('premiumMinor').notNull(),
    policyStartDate: timestamptz('policyStartDate'),
    policyEndDate: timestamptz('policyEndDate'),
    quoteRequestId: text('quoteRequestId'),
    insurerQuoteId: uuid('insurerQuoteId'),
    insurerQuoteReference: text('insurerQuoteReference'),
    quoteDocumentId: uuid('quoteDocumentId'),
    certificateDocumentId: uuid('certificateDocumentId'),
    paymentId: uuid('paymentId').notNull(),
    receivedAt: createdAt('receivedAt'),
    issuedAt: timestamptz('issuedAt'),
    /** The product version quoted; null for policies from before product selection. */
    productVersionId: uuid('productVersionId'),
    issuanceDueAt: timestamptz('issuanceDueAt'),
    issuanceAcceptedAt: timestamptz('issuanceAcceptedAt'),
    issuanceFailedAt: timestamptz('issuanceFailedAt'),
    issuanceFailureReason: text('issuanceFailureReason'),
    cancelledAt: timestamptz('cancelledAt'),
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex('policies_paymentId_key').on(t.paymentId),
    index('policies_status_issuanceDueAt_idx').on(t.status, t.issuanceDueAt),
    fk('policies_productVersionId_fkey', [t.productVersionId], [insurerProductVersions.id], 'restrict'),
    index('policies_customerId_receivedAt_idx').on(t.customerId, t.receivedAt),
    index('policies_insurerId_status_idx').on(t.insurerId, t.status),
    uniqueIndex('policies_quoteRequestId_insurerPolicyNumber_key').on(
      t.quoteRequestId,
      t.insurerPolicyNumber,
    ),
    fk('policies_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('policies_customerId_fkey', [t.customerId], [customers.id], 'restrict'),
    fk('policies_vehicleId_fkey', [t.vehicleId], [vehicles.id], 'restrict'),
    fk('policies_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'set null'),
    fk('policies_insurerQuoteId_fkey', [t.insurerQuoteId], [insurerQuotes.id], 'set null'),
    fk('policies_quoteDocumentId_fkey', [t.quoteDocumentId], [documents.id], 'set null'),
    fk('policies_certificateDocumentId_fkey', [t.certificateDocumentId], [documents.id], 'set null'),
    fk('policies_paymentId_fkey', [t.paymentId], [payments.id], 'restrict'),
    moneyCheck('policies', t.premiumMinor),
  ],
);

/**
 * Each provider event once. The pair (provider, eventId) is the replay key; the
 * envelope hash tells a true replay from the same id reused for other content.
 * The body itself is not kept.
 */
export const paymentCallbacks = pgTable(
  'payment_callbacks',
  {
    id: id(),
    provider: paymentProviderName('provider').notNull(),
    eventId: varchar('eventId', { length: 200 }).notNull(),
    eventType: varchar('eventType', { length: 60 }).notNull(),
    envelopeHash: varchar('envelopeHash', { length: 64 }).notNull(),
    paymentId: uuid('paymentId'),
    receivedAt: createdAt('receivedAt'),
    processedAt: timestamptz('processedAt'),
    /** What applying it did, so a replay answers the same. */
    outcome: varchar('outcome', { length: 60 }),
  },
  (t) => [
    uniqueIndex('payment_callbacks_provider_eventId_key').on(t.provider, t.eventId),
    index('payment_callbacks_paymentId_idx').on(t.paymentId),
    fk('payment_callbacks_paymentId_fkey', [t.paymentId], [payments.id], 'restrict'),
  ],
);

/**
 * Money that needs a person: a refund owed, an amount that did not match, a
 * reversal, an event nobody could place. Opened by the system, closed by an
 * InsurShield administrator; nothing here moves money by itself.
 */
export const reconciliationItems = pgTable(
  'reconciliation_items',
  {
    id: id(),
    kind: reconciliationKind('kind').notNull(),
    status: reconciliationStatus('status').notNull().default('OPEN'),
    outcome: reconciliationOutcome('outcome'),
    paymentId: uuid('paymentId'),
    paymentCallbackId: uuid('paymentCallbackId'),
    /** The provider statement line that raised it, for the kinds a statement import opens. */
    statementLineId: uuid('statementLineId'),
    policyNumber: text('policyNumber'),
    insurerId: uuid('insurerId'),
    amountMinor: ngwee('amountMinor'),
    ownerStaffId: uuid('ownerStaffId'),
    reason: text('reason').notNull(),
    evidenceDocumentIds: uuid('evidenceDocumentIds').array().notNull().default(sql`'{}'::uuid[]`),
    resolutionNote: text('resolutionNote'),
    openedAt: createdAt('openedAt'),
    resolvedAt: timestamptz('resolvedAt'),
    resolvedByStaffId: uuid('resolvedByStaffId'),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One open item of a kind per payment: a repeated trigger finds the item already there.
    uniqueIndex('reconciliation_items_kind_paymentId_open_key')
      .on(t.kind, t.paymentId)
      .where(sql`${t.paymentId} IS NOT NULL AND ${t.status} <> 'RESOLVED'`),
    uniqueIndex('reconciliation_items_kind_paymentCallbackId_key')
      .on(t.kind, t.paymentCallbackId)
      .where(sql`${t.paymentCallbackId} IS NOT NULL`),
    uniqueIndex('reconciliation_items_kind_statementLineId_key')
      .on(t.kind, t.statementLineId)
      .where(sql`${t.statementLineId} IS NOT NULL`),
    index('reconciliation_items_status_openedAt_idx').on(t.status, t.openedAt),
    index('reconciliation_items_insurerId_idx').on(t.insurerId),
    fk('reconciliation_items_paymentId_fkey', [t.paymentId], [payments.id], 'restrict'),
    fk('reconciliation_items_paymentCallbackId_fkey', [t.paymentCallbackId], [paymentCallbacks.id], 'restrict'),
    fk('reconciliation_items_policyNumber_fkey', [t.policyNumber], [policies.policyNumber], 'restrict'),
    fk('reconciliation_items_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('reconciliation_items_ownerStaffId_fkey', [t.ownerStaffId], [staffUsers.id], 'set null'),
    fk('reconciliation_items_resolvedByStaffId_fkey', [t.resolvedByStaffId], [staffUsers.id], 'restrict'),
    check(
      'reconciliation_items_resolution_check',
      sql`(${t.status} = 'RESOLVED') = (${t.resolvedAt} IS NOT NULL AND ${t.outcome} IS NOT NULL)`,
    ),
  ],
);

export const refundStatus = pgEnum('RefundStatus', REFUND_STATUSES);
export const refundReason = pgEnum('RefundReason', REFUND_REASONS);

/**
 * Money going back to a customer. Proposed by one administrator, approved by
 * another, then sent to the provider. A payment has at most one refund that
 * can still move money, so two can never together exceed what was paid.
 */
export const paymentRefunds = pgTable(
  'payment_refunds',
  {
    id: id(),
    paymentId: uuid('paymentId').notNull(),
    amountMinor: ngwee('amountMinor').notNull(),
    reasonCode: refundReason('reasonCode').notNull(),
    reason: text('reason').notNull(),
    status: refundStatus('status').notNull().default('PROPOSED'),
    approvalRequestId: uuid('approvalRequestId'),
    reconciliationItemId: uuid('reconciliationItemId'),
    provider: paymentProviderName('provider').notNull(),
    providerRefundId: varchar('providerRefundId', { length: 200 }),
    proposedByStaffId: uuid('proposedByStaffId').notNull(),
    approvedAt: timestamptz('approvedAt'),
    submittedAt: timestamptz('submittedAt'),
    completedAt: timestamptz('completedAt'),
    failureReason: text('failureReason'),
    /** The finalised settlement this refund was taken from, set once. */
    settlementId: uuid('settlementId'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payment_refunds_paymentId_open_key')
      .on(t.paymentId)
      .where(sql`${t.status} IN ('PROPOSED', 'APPROVED', 'SUBMITTED')`),
    uniqueIndex('payment_refunds_provider_providerRefundId_key').on(t.provider, t.providerRefundId),
    index('payment_refunds_status_idx').on(t.status, t.updatedAt),
    fk('payment_refunds_paymentId_fkey', [t.paymentId], [payments.id], 'restrict'),
    fk('payment_refunds_reconciliationItemId_fkey', [t.reconciliationItemId], [reconciliationItems.id], 'restrict'),
    fk('payment_refunds_proposedByStaffId_fkey', [t.proposedByStaffId], [staffUsers.id], 'restrict'),
    check('payment_refunds_amount_check', sql`${t.amountMinor} > 0`),
  ],
);

export const settlementStatus = pgEnum('SettlementStatus', SETTLEMENT_STATUSES);
export const settlementLineKind = pgEnum('SettlementLineKind', SETTLEMENT_LINE_KINDS);
export const adjustmentKind = pgEnum('AdjustmentKind', ADJUSTMENT_KINDS);

/**
 * What InsurShield owes one insurer for one period. A draft can be redrawn;
 * once a second administrator approves it, it and its lines never change, and
 * a later correction is an adjustment in a later settlement.
 */
export const settlements = pgTable(
  'settlements',
  {
    id: id(),
    reference: text('reference').notNull(),
    insurerId: uuid('insurerId').notNull(),
    period: varchar('period', { length: 7 }).notNull(),
    periodStart: timestamptz('periodStart').notNull(),
    periodEnd: timestamptz('periodEnd').notNull(),
    status: settlementStatus('status').notNull().default('DRAFT'),
    grossPremiumMinor: ngwee('grossPremiumMinor').notNull(),
    feesMinor: ngwee('feesMinor').notNull(),
    refundsMinor: ngwee('refundsMinor').notNull(),
    adjustmentsMinor: signedNgwee('adjustmentsMinor').notNull(),
    commissionMinor: ngwee('commissionMinor').notNull(),
    netPayableMinor: signedNgwee('netPayableMinor').notNull(),
    commissionBps: integer('commissionBps').notNull(),
    ruleVersions: jsonb('ruleVersions').$type<Record<string, number | null>>().notNull(),
    approvalRequestId: uuid('approvalRequestId'),
    draftedByStaffId: uuid('draftedByStaffId').notNull(),
    finalisedAt: timestamptz('finalisedAt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('settlements_insurerId_period_key').on(t.insurerId, t.period),
    uniqueIndex('settlements_reference_key').on(t.reference),
    fk('settlements_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('settlements_draftedByStaffId_fkey', [t.draftedByStaffId], [staffUsers.id], 'restrict'),
    check('settlements_finalised_check', sql`(${t.status} = 'FINALISED') = (${t.finalisedAt} IS NOT NULL)`),
  ],
);

export const settlementLines = pgTable(
  'settlement_lines',
  {
    id: id(),
    settlementId: uuid('settlementId').notNull(),
    kind: settlementLineKind('kind').notNull(),
    paymentId: uuid('paymentId'),
    refundId: uuid('refundId'),
    adjustmentId: uuid('adjustmentId'),
    /** The insurer's money on the line: premium, a refund (negative) or an adjustment (signed). */
    amountMinor: signedNgwee('amountMinor').notNull(),
    feeMinor: ngwee('feeMinor').notNull().default(0),
    reference: text('reference').notNull(),
    occurredAt: timestamptz('occurredAt').notNull(),
  },
  (t) => [
    index('settlement_lines_settlementId_idx').on(t.settlementId),
    fk('settlement_lines_settlementId_fkey', [t.settlementId], [settlements.id], 'cascade'),
    fk('settlement_lines_paymentId_fkey', [t.paymentId], [payments.id], 'restrict'),
    fk('settlement_lines_refundId_fkey', [t.refundId], [paymentRefunds.id], 'restrict'),
    check(
      'settlement_lines_source_check',
      sql`num_nonnulls(${t.paymentId}, ${t.refundId}, ${t.adjustmentId}) = 1`,
    ),
  ],
);

/**
 * Money moved into or out of an insurer's next settlement that is not a
 * payment or a refund. Written only once a second administrator approves it,
 * and never changed afterwards except to record the settlement that took it.
 */
export const moneyAdjustments = pgTable(
  'money_adjustments',
  {
    id: id(),
    insurerId: uuid('insurerId').notNull(),
    kind: adjustmentKind('kind').notNull(),
    amountMinor: signedNgwee('amountMinor').notNull(),
    reason: text('reason').notNull(),
    reconciliationItemId: uuid('reconciliationItemId'),
    approvalRequestId: uuid('approvalRequestId').notNull(),
    proposedByStaffId: uuid('proposedByStaffId').notNull(),
    approvedByStaffId: uuid('approvedByStaffId').notNull(),
    settlementId: uuid('settlementId'),
    createdAt: createdAt(),
  },
  (t) => [
    index('money_adjustments_insurerId_settlementId_idx').on(t.insurerId, t.settlementId),
    uniqueIndex('money_adjustments_approvalRequestId_key').on(t.approvalRequestId),
    fk('money_adjustments_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('money_adjustments_reconciliationItemId_fkey', [t.reconciliationItemId], [reconciliationItems.id], 'restrict'),
    fk('money_adjustments_settlementId_fkey', [t.settlementId], [settlements.id], 'restrict'),
    check('money_adjustments_amount_check', sql`${t.amountMinor} <> 0`),
  ],
);

export const statementLineType = pgEnum('StatementLineType', STATEMENT_LINE_TYPES);
export const statementLineStatus = pgEnum('StatementLineStatus', STATEMENT_LINE_STATUSES);

/** A provider statement as imported; the same file twice is the same import. */
export const providerStatementImports = pgTable(
  'provider_statement_imports',
  {
    id: id(),
    provider: paymentProviderName('provider').notNull(),
    fileName: text('fileName').notNull(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    periodStart: timestamptz('periodStart').notNull(),
    periodEnd: timestamptz('periodEnd').notNull(),
    lineCount: integer('lineCount').notNull(),
    newLines: integer('newLines').notNull(),
    matched: integer('matched').notNull(),
    itemsOpened: integer('itemsOpened').notNull(),
    importedByStaffId: uuid('importedByStaffId').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('provider_statement_imports_provider_checksum_key').on(t.provider, t.checksum),
    fk('provider_statement_imports_importedByStaffId_fkey', [t.importedByStaffId], [staffUsers.id], 'restrict'),
  ],
);

/**
 * Each statement line once, whichever file it came in: an overlapping
 * statement adds only the lines InsurShield has not seen.
 */
export const providerStatementLines = pgTable(
  'provider_statement_lines',
  {
    id: id(),
    importId: uuid('importId').notNull(),
    provider: paymentProviderName('provider').notNull(),
    lineKey: varchar('lineKey', { length: 64 }).notNull(),
    type: statementLineType('type').notNull(),
    providerPaymentId: varchar('providerPaymentId', { length: 200 }).notNull(),
    providerRefundId: varchar('providerRefundId', { length: 200 }),
    amountMinor: ngwee('amountMinor').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    occurredAt: timestamptz('occurredAt').notNull(),
    status: statementLineStatus('status').notNull(),
    paymentId: uuid('paymentId'),
    refundId: uuid('refundId'),
  },
  (t) => [
    uniqueIndex('provider_statement_lines_provider_lineKey_key').on(t.provider, t.lineKey),
    index('provider_statement_lines_paymentId_idx').on(t.paymentId),
    fk('provider_statement_lines_importId_fkey', [t.importId], [providerStatementImports.id], 'restrict'),
    fk('provider_statement_lines_paymentId_fkey', [t.paymentId], [payments.id], 'restrict'),
    fk('provider_statement_lines_refundId_fkey', [t.refundId], [paymentRefunds.id], 'restrict'),
  ],
);

/** Each renewal reminder a policy was sent, so a job that runs twice sends it once. */
export const renewalReminders = pgTable(
  'renewal_reminders',
  {
    id: id(),
    policyNumber: text('policyNumber').notNull(),
    kind: varchar('kind', { length: 10 }).$type<'DUE' | 'LAPSED'>().notNull(),
    daysBefore: integer('daysBefore').notNull(),
    sentAt: createdAt('sentAt'),
  },
  (t) => [
    uniqueIndex('renewal_reminders_policyNumber_kind_daysBefore_key').on(t.policyNumber, t.kind, t.daysBefore),
    fk('renewal_reminders_policyNumber_fkey', [t.policyNumber], [policies.policyNumber], 'cascade'),
    check('renewal_reminders_kind_check', sql`${t.kind} IN ('DUE', 'LAPSED')`),
  ],
);

export const claimNotifications = pgTable(
  'claim_notifications',
  {
    claimNumber: text('claimNumber').primaryKey(),
    status: claimStatus('status').notNull().default('NOTIFIED'),
    insurerId: uuid('insurerId').notNull(),
    customerId: uuid('customerId'),
    policyNumber: text('policyNumber'),
    fullName: text('fullName').notNull(),
    phone: text('phone').notNull(),
    email: text('email'),
    plate: text('plate').notNull(),
    vehicleLabel: text('vehicleLabel').notNull(),
    type: text('type').notNull(),
    incidentDate: timestamptz('incidentDate').notNull(),
    location: text('location').notNull(),
    description: text('description').notNull(),
    estimatedLossMinor: ngwee('estimatedLossMinor'),
    policeReport: boolean('policeReport').notNull().default(false),
    policeReportNumber: text('policeReportNumber'),
    lateReason: text('lateReason'),
    submittedAt: createdAt('submittedAt'),
    receivedAt: timestamptz('receivedAt'),
    insurerClaimReference: text('insurerClaimReference'),
  },
  (t) => [
    index('claim_notifications_customerId_submittedAt_idx').on(t.customerId, t.submittedAt),
    index('claim_notifications_insurerId_status_idx').on(t.insurerId, t.status),
    fk('claim_notifications_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('claim_notifications_customerId_fkey', [t.customerId], [customers.id], 'set null'),
    fk('claim_notifications_policyNumber_fkey', [t.policyNumber], [policies.policyNumber], 'set null'),
    moneyCheck('claim_notifications', t.estimatedLossMinor),
  ],
);

export const claimAttachments = pgTable(
  'claim_attachments',
  {
    id: id(),
    claimNumber: text('claimNumber').notNull(),
    documentId: uuid('documentId').notNull(),
  },
  (t) => [
    uniqueIndex('claim_attachments_documentId_key').on(t.documentId),
    fk(
      'claim_attachments_claimNumber_fkey',
      [t.claimNumber],
      [claimNotifications.claimNumber],
      'cascade',
    ),
    fk('claim_attachments_documentId_fkey', [t.documentId], [documents.id], 'restrict'),
  ],
);

export const ncdApplications = pgTable(
  'ncd_applications',
  {
    id: id(),
    applicationNumber: text('applicationNumber').notNull(),
    insurerId: uuid('insurerId').notNull(),
    customerId: uuid('customerId'),
    policyNumber: text('policyNumber').notNull(),
    fullName: text('fullName').notNull(),
    phone: text('phone').notNull(),
    yearsClaimFree: integer('yearsClaimFree').notNull(),
    status: ncdStatus('status').notNull().default('SUBMITTED'),
    approvedCodeId: text('approvedCodeId'),
    submittedAt: createdAt('submittedAt'),
    decidedAt: timestamptz('decidedAt'),
  },
  (t) => [
    uniqueIndex('ncd_applications_applicationNumber_key').on(t.applicationNumber),
    uniqueIndex('ncd_applications_approvedCodeId_key').on(t.approvedCodeId),
    index('ncd_applications_insurerId_status_idx').on(t.insurerId, t.status),
    fk('ncd_applications_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('ncd_applications_customerId_fkey', [t.customerId], [customers.id], 'set null'),
    fk('ncd_applications_approvedCodeId_fkey', [t.approvedCodeId], [ncdCodes.code], 'set null'),
  ],
);

export const ncdCodes = pgTable(
  'ncd_codes',
  {
    code: text('code').primaryKey(),
    insurerId: uuid('insurerId').notNull(),
    percentage: integer('percentage').notNull(),
    yearsClaimFree: integer('yearsClaimFree').notNull(),
    issuedAt: createdAt('issuedAt'),
    expiresAt: timestamptz('expiresAt'),
    redeemedAt: timestamptz('redeemedAt'),
  },
  (t) => [fk('ncd_codes_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict')],
);

export const inspections = pgTable(
  'inspections',
  {
    id: text('id').primaryKey(),
    status: inspectionStatus('status').notNull().default('REQUESTED'),
    customerId: uuid('customerId').notNull(),
    insurerId: uuid('insurerId'),
    vehiclePlate: text('vehiclePlate').notNull(),
    vehicleLabel: text('vehicleLabel').notNull(),
    preferredDate: timestamptz('preferredDate'),
    preferredTime: text('preferredTime'),
    preferredLocation: text('preferredLocation'),
    scheduledDate: timestamptz('scheduledDate'),
    inspectorName: text('inspectorName'),
    inspectorPhone: text('inspectorPhone'),
    location: text('location'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Batch 13: an inspection a chosen product needs before it is quoted or paid.
    purpose: inspectionPurpose('purpose').notNull().default('GENERAL'),
    quoteRequestId: text('quoteRequestId'),
    method: inspectionMethod('method'),
    stage: inspectionTiming('stage'),
    /** The inspection this one repeats, after a fail, a missed appointment or a cancellation. */
    predecessorId: text('predecessorId'),
    result: inspectionResult('result'),
    /** Why it failed or was cancelled; shown to the customer. */
    resultReason: text('resultReason'),
    decidedByStaffId: uuid('decidedByStaffId'),
    decidedAt: timestamptz('decidedAt'),
  },
  (t) => [
    index('inspections_customerId_createdAt_idx').on(t.customerId, t.createdAt),
    index('inspections_status_idx').on(t.status),
    index('inspections_insurerId_status_idx').on(t.insurerId, t.status),
    index('inspections_quoteRequestId_idx').on(t.quoteRequestId),
    fk('inspections_customerId_fkey', [t.customerId], [customers.id], 'restrict'),
    fk('inspections_insurerId_fkey', [t.insurerId], [insurers.id], 'set null'),
    fk('inspections_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'set null'),
    fk('inspections_predecessorId_fkey', [t.predecessorId], [t.id], 'set null'),
    fk('inspections_decidedByStaffId_fkey', [t.decidedByStaffId], [staffUsers.id], 'set null'),
    check(
      'inspections_underwriting_check',
      sql`${t.purpose} <> 'UNDERWRITING' OR (${t.quoteRequestId} IS NOT NULL AND ${t.method} IS NOT NULL AND ${t.stage} IS NOT NULL)`,
    ),
    check('inspections_result_check', sql`(${t.result} IS NULL) = (${t.decidedAt} IS NULL)`),
  ],
);

/**
 * The chosen products an underwriting inspection serves. A product has at
 * most one open inspection per stage; every result is kept on the inspection.
 */
export const inspectionRequestProducts = pgTable(
  'inspection_request_products',
  {
    id: id(),
    inspectionId: text('inspectionId').notNull(),
    quoteRequestId: text('quoteRequestId').notNull(),
    productVersionId: uuid('productVersionId').notNull(),
    stage: inspectionTiming('stage').notNull(),
    isOpen: boolean('isOpen').notNull().default(true),
    /** Set when an approved inspection satisfied this product's rule. */
    passed: boolean('passed').notNull().default(false),
  },
  (t) => [
    uniqueIndex('inspection_request_products_inspection_version_key').on(t.inspectionId, t.productVersionId),
    uniqueIndex('inspection_request_products_open_key')
      .on(t.quoteRequestId, t.productVersionId, t.stage)
      .where(sql`${t.isOpen}`),
    index('inspection_request_products_selection_idx').on(t.quoteRequestId, t.productVersionId),
    fk('inspection_request_products_inspectionId_fkey', [t.inspectionId], [inspections.id], 'cascade'),
    foreignKey({
      name: 'inspection_request_products_selection_fkey',
      columns: [t.quoteRequestId, t.productVersionId],
      foreignColumns: [quoteRequestProductVersions.quoteRequestId, quoteRequestProductVersions.productVersionId],
    }).onDelete('cascade'),
    check('inspection_request_products_passed_check', sql`NOT (${t.passed} AND ${t.isOpen})`),
  ],
);

export const inspectionPhotos = pgTable(
  'inspection_photos',
  {
    id: id(),
    inspectionId: text('inspectionId').notNull(),
    slot: text('slot').notNull(),
    documentId: uuid('documentId').notNull(),
  },
  (t) => [
    uniqueIndex('inspection_photos_documentId_key').on(t.documentId),
    uniqueIndex('inspection_photos_inspectionId_slot_key').on(t.inspectionId, t.slot),
    fk('inspection_photos_inspectionId_fkey', [t.inspectionId], [inspections.id], 'cascade'),
    fk('inspection_photos_documentId_fkey', [t.documentId], [documents.id], 'restrict'),
  ],
);

export const piaConfig = pgTable(
  'pia_config',
  {
    id: text('id').primaryKey().default('current'),
    piaRateBps: integer('piaRateBps').notNull(),
    updatedByStaffId: uuid('updatedByStaffId'),
    updatedAt: updatedAt(),
  },
  (t) => [
    fk('pia_config_updatedByStaffId_fkey', [t.updatedByStaffId], [staffUsers.id], 'set null'),
    rateCheck('pia_config', t.piaRateBps),
  ],
);

export const idempotencyRecords = pgTable(
  'idempotency_records',
  {
    callerId: text('callerId').notNull(),
    key: text('key').notNull(),
    endpoint: text('endpoint').notNull(),
    requestHash: text('requestHash').notNull(),
    responseStatus: integer('responseStatus'),
    responseBody: jsonb('responseBody'),
    createdAt: createdAt(),
    expiresAt: timestamptz('expiresAt').notNull(),
  },
  (t) => [
    uniqueIndex('idempotency_records_callerId_endpoint_key_key').on(t.callerId, t.endpoint, t.key),
    index('idempotency_records_expiresAt_idx').on(t.expiresAt),
  ],
);

/**
 * Work the platform owes after a request has committed: an outbox row and a
 * scheduled task are the same thing with different kinds.
 *
 * `(kind, key)` is unique, so a fact enqueued twice is one row. That is what
 * lets delivery be at-least-once without a consumer having to recognise a
 * repeat, which is the guarantee US-CUS-019 asks for.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: id(),
    kind: text('kind').notNull(),
    /** Stable for the fact this job is about, so re-enqueueing is a no-op. */
    key: text('key').notNull(),
    /** Identifiers the consumer reads the record with. Never a copy of it. */
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    status: jobStatus('status').notNull().default('PENDING'),
    runAfter: timestamptz('runAfter').notNull().default(sql`CURRENT_TIMESTAMP`),
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('maxAttempts').notNull().default(5),
    /** While in the future and the row is RUNNING, another runner leaves it alone. */
    leaseUntil: timestamptz('leaseUntil'),
    lastError: text('lastError'),
    createdAt: createdAt(),
    completedAt: timestamptz('completedAt'),
  },
  (t) => [
    uniqueIndex('jobs_kind_key_key').on(t.kind, t.key),
    // The claim query orders by runAfter within the rows a runner may take.
    index('jobs_status_runAfter_idx').on(t.status, t.runAfter),
  ],
);

/**
 * The wording a notification is rendered from, kept by version.
 *
 * A message records the version it used, so editing a template cannot rewrite
 * what somebody was already told. `mandatory` is the operational-versus-
 * marketing line: a mandatory notice ignores a contact preference, and EN-005
 * wants that decision recorded rather than implied by the template's name.
 */
export const notificationTemplates = pgTable(
  'notification_templates',
  {
    id: id(),
    key: text('key').notNull(),
    channel: notificationChannel('channel').notNull(),
    /** What the message is about, and so which preference governs it. */
    category: notificationCategory('category').notNull(),
    version: integer('version').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    mandatory: boolean('mandatory').notNull().default(true),
    /** Null means not yet in use; the active version is the latest that has passed. */
    activeFrom: timestamptz('activeFrom'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notification_templates_key_channel_version_key').on(t.key, t.channel, t.version),
    index('notification_templates_key_channel_activeFrom_idx').on(t.key, t.channel, t.activeFrom),
  ],
);

/**
 * One row per message per channel: the IN_APP rows are the notification centre,
 * and the EMAIL rows carry what the provider said about delivery.
 *
 * The row holds the wording that was sent and a link to the record, never the
 * protected content behind it — US-CUS-019 asks that a notification show
 * nothing sensitive on an unverified device, and the simplest way to keep that
 * promise is to have nothing sensitive to show.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    customerId: uuid('customerId').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    templateKey: text('templateKey').notNull(),
    templateVersion: integer('templateVersion').notNull(),
    channel: notificationChannel('channel').notNull(),
    category: notificationCategory('category').notNull(),
    /**
     * Whether this was sent despite a preference. Recorded rather than
     * inferred from the category, so why a customer received a message
     * they had switched off can be answered from the row itself.
     */
    mandatory: boolean('mandatory').notNull(),
    /** The record this is about, so the centre can link to it. */
    entityType: text('entityType').notNull(),
    entityId: text('entityId').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    readAt: timestamptz('readAt'),
    deliveryStatus: notificationDeliveryStatus('deliveryStatus').notNull().default('PENDING'),
    /** The provider's own reference, for tracing a message that did not arrive. */
    providerReference: text('providerReference'),
    deliveredAt: timestamptz('deliveredAt'),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_customerId_createdAt_idx').on(t.customerId, t.createdAt),
    index('notifications_customerId_readAt_idx').on(t.customerId, t.readAt),
  ],
);

/**
 * Which optional messages a customer wants, per category and channel.
 *
 * Absence means the default, which is on: a customer who has never visited the
 * preference screen still hears about their quote. Only a row saying `false`
 * silences anything, and only for a category whose template is not mandatory.
 */
export const contactPreferences = pgTable(
  'contact_preferences',
  {
    id: id(),
    customerId: uuid('customerId').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    channel: notificationChannel('channel').notNull(),
    enabled: boolean('enabled').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('contact_preferences_customerId_category_channel_key').on(t.customerId, t.category, t.channel)],
);

/**
 * Marketing consent, as consent rather than as a switch.
 *
 * Append-only like `consent_records`: a withdrawal is a new row, so what was
 * agreed and when can be answered later. US-CUS-003 wants the version and the
 * purpose kept, which a boolean on the customer could not carry.
 */
export const marketingConsents = pgTable(
  'marketing_consents',
  {
    id: id(),
    customerId: uuid('customerId').notNull().references(() => customers.id, { onDelete: 'cascade' }),
    granted: boolean('granted').notNull(),
    /** The wording the customer was shown when they answered. */
    noticeVersion: text('noticeVersion').notNull(),
    purpose: text('purpose').notNull(),
    recordedAt: createdAt('recordedAt'),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
  },
  (t) => [index('marketing_consents_customerId_recordedAt_idx').on(t.customerId, t.recordedAt)],
);

export const integrationDeliveries = pgTable(
  'integration_deliveries',
  {
    id: id(),
    /** Insurer deliveries own an insurer; RTSA and payment deliveries do not. */
    insurerId: uuid('insurerId'),
    targetKind: integrationTargetKind('targetKind').notNull(),
    kind: deliveryKind('kind').notNull(),
    referenceId: text('referenceId').notNull(),
    /** Stable per business fact, including its target identity; retries reuse it. */
    idempotencyKey: varchar('idempotencyKey', { length: 200 }).notNull(),
    /** Detects an accidental attempt to reuse a business fact with new data. */
    requestHash: varchar('requestHash', { length: 64 }).notNull(),
    correlationId: text('correlationId'),
    endpoint: text('endpoint').notNull(),
    /** External attempts, not page refreshes or job claims. */
    attempt: integer('attempt').notNull().default(0),
    maxAttempts: integer('maxAttempts').notNull().default(5),
    status: deliveryStatus('status').notNull().default('PENDING'),
    requestPayload: jsonb('requestPayload').notNull(),
    responseStatus: integer('responseStatus'),
    /** Allowlisted acknowledgement facts only; never a raw provider response. */
    responseBody: jsonb('responseBody'),
    error: text('error'),
    lastAttemptAt: timestamptz('lastAttemptAt'),
    deliveredAt: timestamptz('deliveredAt'),
    acknowledgedAt: timestamptz('acknowledgedAt'),
    resolvedAt: timestamptz('resolvedAt'),
    resolvedByStaffId: uuid('resolvedByStaffId'),
    resolutionNote: text('resolutionNote'),
    createdAt: createdAt(),
  },
  (t) => [
    index('integration_deliveries_insurerId_kind_referenceId_idx').on(
      t.insurerId,
      t.kind,
      t.referenceId,
    ),
    uniqueIndex('integration_deliveries_idempotencyKey_key').on(t.idempotencyKey),
    index('integration_deliveries_status_createdAt_idx').on(t.status, t.createdAt),
    index('integration_deliveries_targetKind_status_createdAt_idx').on(t.targetKind, t.status, t.createdAt),
    fk('integration_deliveries_insurerId_fkey', [t.insurerId], [insurers.id], 'cascade'),
    fk('integration_deliveries_resolvedByStaffId_fkey', [t.resolvedByStaffId], [staffUsers.id], 'restrict'),
  ],
);

/**
 * A verified callback is recorded without retaining its potentially sensitive
 * body. Future event-specific handlers use this receipt for replay protection.
 */
export const integrationCallbacks = pgTable(
  'integration_callbacks',
  {
    id: id(),
    insurerId: uuid('insurerId').notNull(),
    eventId: varchar('eventId', { length: 200 }).notNull(),
    eventType: varchar('eventType', { length: 120 }).notNull(),
    bodyHash: varchar('bodyHash', { length: 64 }).notNull(),
    correlationId: text('correlationId'),
    receivedAt: createdAt('receivedAt'),
  },
  (t) => [
    uniqueIndex('integration_callbacks_insurerId_eventId_key').on(t.insurerId, t.eventId),
    index('integration_callbacks_insurerId_receivedAt_idx').on(t.insurerId, t.receivedAt),
    fk('integration_callbacks_insurerId_fkey', [t.insurerId], [insurers.id], 'cascade'),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    actorType: actorType('actorType').notNull(),
    actorId: text('actorId'),
    action: text('action').notNull(),
    entityType: text('entityType').notNull(),
    entityId: text('entityId').notNull(),
    before: jsonb('before'),
    after: jsonb('after'),
    note: text('note'),
    correlationId: text('correlationId'),
    ipAddress: text('ipAddress'),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_logs_entityType_entityId_createdAt_idx').on(t.entityType, t.entityId, t.createdAt),
    index('audit_logs_actorType_actorId_createdAt_idx').on(t.actorType, t.actorId, t.createdAt),
    index('audit_logs_createdAt_id_idx').on(t.createdAt, t.id),
    index('audit_logs_action_createdAt_idx').on(t.action, t.createdAt),
  ],
);

/**
 * The operational status journey for every workflow entity. The entity is
 * deliberately polymorphic: a single, consistently indexed history reader is
 * safer than five nearly-identical tables with different access behaviour.
 */
export const stateHistory = pgTable(
  'state_history',
  {
    id: id(),
    entityType: text('entityType').notNull(),
    entityId: text('entityId').notNull(),
    fromStatus: text('fromStatus'),
    toStatus: text('toStatus').notNull(),
    actorType: actorType('actorType').notNull(),
    actorId: text('actorId'),
    note: text('note'),
    correlationId: text('correlationId'),
    createdAt: createdAt(),
  },
  (t) => [
    index('state_history_entityType_entityId_createdAt_idx').on(t.entityType, t.entityId, t.createdAt),
    index('state_history_actorType_actorId_createdAt_idx').on(t.actorType, t.actorId, t.createdAt),
  ],
);

/**
 * A PIA floor remains quick to read from `pia_config`, while this append-only
 * table preserves each value that was in force before a later Batch 10 turns
 * platform settings into fully versioned configuration.
 */
export const piaConfigHistory = pgTable(
  'pia_config_history',
  {
    id: id(),
    piaRateBps: integer('piaRateBps').notNull(),
    previousRateBps: integer('previousRateBps'),
    changedByStaffId: uuid('changedByStaffId'),
    note: text('note'),
    changedAt: createdAt('changedAt'),
  },
  (t) => [
    index('pia_config_history_changedAt_idx').on(t.changedAt),
    fk('pia_config_history_changedByStaffId_fkey', [t.changedByStaffId], [staffUsers.id], 'set null'),
    rateCheck('pia_config_history', t.piaRateBps),
    check(
      'pia_config_history_previousRateBps_check',
      sql`${t.previousRateBps} IS NULL OR (${t.previousRateBps} >= ${sql.raw(String(MIN_RATE_BPS))} AND ${t.previousRateBps} <= ${sql.raw(String(MAX_RATE_BPS))})`,
    ),
  ],
);

/**
 * A maker/checker record freezes a request before anyone may execute it. Its
 * payload is deliberately an opaque, action-specific snapshot: each executor
 * validates it again at approval time, so a historical request cannot turn
 * into a new unreviewed kind of configuration change.
 */
export const approvalRequests = pgTable(
  'approval_requests',
  {
    id: id(),
    action: approvalAction('action').notNull(),
    status: approvalStatus('status').notNull().default('PENDING'),
    targetType: text('targetType').notNull(),
    targetId: text('targetId').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    requestedByStaffId: uuid('requestedByStaffId').notNull(),
    requestedReason: text('requestedReason').notNull(),
    decidedByStaffId: uuid('decidedByStaffId'),
    decisionReason: text('decisionReason'),
    expiresAt: timestamptz('expiresAt').notNull(),
    decidedAt: timestamptz('decidedAt'),
    executedAt: timestamptz('executedAt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('approval_requests_status_createdAt_idx').on(t.status, t.createdAt),
    index('approval_requests_target_idx').on(t.targetType, t.targetId),
    uniqueIndex('approval_requests_one_pending_action_key')
      .on(t.action, t.targetType, t.targetId)
      .where(sql`${t.status} = 'PENDING'`),
    fk('approval_requests_requestedByStaffId_fkey', [t.requestedByStaffId], [staffUsers.id], 'restrict'),
    fk('approval_requests_decidedByStaffId_fkey', [t.decidedByStaffId], [staffUsers.id], 'restrict'),
  ],
);
