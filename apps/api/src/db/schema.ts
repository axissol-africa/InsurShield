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
  uniqueIndex,
  uuid,
  varchar,
  type AnyPgColumn,
  type PgTableExtraConfigValue,
  type UpdateDeleteAction,
} from 'drizzle-orm/pg-core';
import {
  ACTOR_TYPES,
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
  INSPECTION_RULES,
  INSPECTION_STATUSES,
  INSPECTION_TIMINGS,
  INSURANCE_TYPES,
  INSURER_STATUSES,
  NCD_STATUSES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  POLICY_STATUSES,
  QUOTE_REQUEST_STATUSES,
  STAFF_ROLES,
  JOB_STATUSES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_CATEGORIES,
} from '../common/domain/enums.js';
import { MAX_NGWEE, MAX_RATE_BPS, MIN_NGWEE, MIN_RATE_BPS } from '../common/domain/money-limits.js';

// Physical names are the ones Prisma created; only the money and rate columns were renamed.

export const quoteRequestStatus = pgEnum('QuoteRequestStatus', QUOTE_REQUEST_STATUSES);
export const insuranceType = pgEnum('InsuranceType', INSURANCE_TYPES);
export const coverageDuration = pgEnum('CoverageDuration', COVERAGE_DURATIONS);
export const insurerStatus = pgEnum('InsurerStatus', INSURER_STATUSES);
export const evidenceKind = pgEnum('EvidenceKind', EVIDENCE_KINDS);
export const evidenceReviewState = pgEnum('EvidenceReviewState', EVIDENCE_REVIEW_STATES);
export const policyStatus = pgEnum('PolicyStatus', POLICY_STATUSES);
export const paymentStatus = pgEnum('PaymentStatus', PAYMENT_STATUSES);
export const paymentMethod = pgEnum('PaymentMethod', PAYMENT_METHODS);
export const claimStatus = pgEnum('ClaimStatus', CLAIM_STATUSES);
export const ncdStatus = pgEnum('NcdStatus', NCD_STATUSES);
export const inspectionStatus = pgEnum('InspectionStatus', INSPECTION_STATUSES);
export const inspectionRule = pgEnum('InspectionRule', INSPECTION_RULES);
export const inspectionTiming = pgEnum('InspectionTiming', INSPECTION_TIMINGS);
export const inspectionMethod = pgEnum('InspectionMethod', INSPECTION_METHODS);
export const staffRole = pgEnum('StaffRole', STAFF_ROLES);
export const documentKind = pgEnum('DocumentKind', DOCUMENT_KINDS);
export const documentScanStatus = pgEnum('DocumentScanStatus', DOCUMENT_SCAN_STATUSES);
export const documentRetentionClass = pgEnum('DocumentRetentionClass', DOCUMENT_RETENTION_CLASSES);
export const deliveryStatus = pgEnum('DeliveryStatus', DELIVERY_STATUSES);
export const deliveryKind = pgEnum('DeliveryKind', DELIVERY_KINDS);
export const actorType = pgEnum('ActorType', ACTOR_TYPES);
export const jobStatus = pgEnum('JobStatus', JOB_STATUSES);
export const notificationChannel = pgEnum('NotificationChannel', NOTIFICATION_CHANNELS);
export const notificationCategory = pgEnum('NotificationCategory', NOTIFICATION_CATEGORIES);
export const notificationDeliveryStatus = pgEnum('NotificationDeliveryStatus', NOTIFICATION_DELIVERY_STATUSES);

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
    image: text('image'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('auth_users_email_key').on(t.email),
    check('auth_users_email_check', sql`${t.email} = lower(${t.email})`),
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

export const staffUsers = pgTable(
  'staff_users',
  {
    id: id(),
    email: text('email').notNull(),
    fullName: text('fullName').notNull(),
    role: staffRole('role').notNull(),
    insurerId: uuid('insurerId'),
    isActive: boolean('isActive').notNull().default(true),
    lastLoginAt: timestamptz('lastLoginAt'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    userId: uuid('userId'),
  },
  (t) => [
    uniqueIndex('staff_users_email_key').on(t.email),
    uniqueIndex('staff_users_userId_key').on(t.userId),
    index('staff_users_insurerId_idx').on(t.insurerId),
    fk('staff_users_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('staff_users_userId_fkey', [t.userId], [authUsers.id], 'restrict'),
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
  },
  (t) => [
    index('quote_request_recipients_insurerId_status_idx').on(t.insurerId, t.status),
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
  ],
);

export const insurerQuotes = pgTable(
  'insurer_quotes',
  {
    id: id(),
    quoteRequestId: text('quoteRequestId').notNull(),
    insurerId: uuid('insurerId').notNull(),
    premiumMinor: ngwee('premiumMinor').notNull(),
    notes: text('notes'),
    insurerReference: text('insurerReference'),
    validityDays: integer('validityDays').notNull(),
    sentAt: createdAt('sentAt'),
    validUntil: timestamptz('validUntil').notNull(),
    extendedAt: timestamptz('extendedAt'),
    documentId: uuid('documentId').notNull(),
  },
  (t) => [
    uniqueIndex('insurer_quotes_documentId_key').on(t.documentId),
    index('insurer_quotes_validUntil_idx').on(t.validUntil),
    uniqueIndex('insurer_quotes_quoteRequestId_insurerId_key').on(t.quoteRequestId, t.insurerId),
    uniqueIndex('insurer_quotes_quoteRequestId_insurerReference_key').on(
      t.quoteRequestId,
      t.insurerReference,
    ),
    fk('insurer_quotes_quoteRequestId_fkey', [t.quoteRequestId], [quoteRequests.id], 'cascade'),
    fk('insurer_quotes_insurerId_fkey', [t.insurerId], [insurers.id], 'restrict'),
    fk('insurer_quotes_documentId_fkey', [t.documentId], [documents.id], 'restrict'),
    moneyCheck('insurer_quotes', t.premiumMinor),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('payments_transactionId_key').on(t.transactionId),
    uniqueIndex('payments_idempotencyKey_key').on(t.idempotencyKey),
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
    updatedAt: updatedAt(),
  },
  (t): PgTableExtraConfigValue[] => [
    uniqueIndex('policies_paymentId_key').on(t.paymentId),
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
  },
  (t) => [
    index('inspections_customerId_createdAt_idx').on(t.customerId, t.createdAt),
    index('inspections_status_idx').on(t.status),
    fk('inspections_customerId_fkey', [t.customerId], [customers.id], 'restrict'),
    fk('inspections_insurerId_fkey', [t.insurerId], [insurers.id], 'set null'),
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
    insurerId: uuid('insurerId').notNull(),
    kind: deliveryKind('kind').notNull(),
    referenceId: text('referenceId').notNull(),
    endpoint: text('endpoint').notNull(),
    attempt: integer('attempt').notNull().default(1),
    status: deliveryStatus('status').notNull().default('PENDING'),
    requestPayload: jsonb('requestPayload').notNull(),
    responseStatus: integer('responseStatus'),
    responseBody: jsonb('responseBody'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('integration_deliveries_insurerId_kind_referenceId_idx').on(
      t.insurerId,
      t.kind,
      t.referenceId,
    ),
    index('integration_deliveries_status_createdAt_idx').on(t.status, t.createdAt),
    fk('integration_deliveries_insurerId_fkey', [t.insurerId], [insurers.id], 'cascade'),
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
