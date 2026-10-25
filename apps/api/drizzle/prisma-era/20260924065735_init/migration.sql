-- CreateEnum
CREATE TYPE "QuoteRequestStatus" AS ENUM ('SUBMITTED', 'QUOTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InsuranceType" AS ENUM ('COMPREHENSIVE', 'THIRD_PARTY');

-- CreateEnum
CREATE TYPE "CoverageDuration" AS ENUM ('Q1', 'Q2', 'Q3', 'Q4');

-- CreateEnum
CREATE TYPE "InsurerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DELETED');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('AWAITING_INSURER_CERTIFICATE', 'ACTIVE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('MOBILE_MONEY', 'CARD');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('NOTIFIED', 'RECEIVED_BY_INSURER');

-- CreateEnum
CREATE TYPE "NcdStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'VERIFICATION_REQUIRED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('REQUESTED', 'SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "InspectionRule" AS ENUM ('NOT_REQUIRED', 'OPTIONAL', 'REQUIRED');

-- CreateEnum
CREATE TYPE "InspectionTiming" AS ENUM ('BEFORE_QUOTATION', 'BEFORE_PAYMENT', 'AFTER_PAYMENT');

-- CreateEnum
CREATE TYPE "InspectionMethod" AS ENUM ('SELF_CAPTURE', 'PHYSICAL');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'INSURER_USER');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('QUOTATION', 'CERTIFICATE', 'INSPECTION_PHOTO', 'CLAIM_ATTACHMENT', 'INSURER_LOGO', 'NCD_EVIDENCE');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('REGISTRATION', 'PASSWORD_RESET');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'DELIVERED', 'ACKNOWLEDGED', 'FAILED');

-- CreateEnum
CREATE TYPE "DeliveryKind" AS ENUM ('QUOTE_REQUEST', 'PAID_POLICY', 'CLAIM_NOTIFICATION');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('CUSTOMER', 'STAFF', 'INSURER', 'SYSTEM');

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "phoneVerifiedAt" TIMESTAMP(3),
    "emailVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "privacyVersion" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "StaffRole" NOT NULL,
    "insurerId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tradingName" TEXT,
    "status" "InsurerStatus" NOT NULL DEFAULT 'ACTIVE',
    "ratePercentage" DECIMAL(5,2) NOT NULL,
    "quoteValidityDays" INTEGER NOT NULL,
    "coverage" TEXT NOT NULL,
    "plan" TEXT,
    "licenceNumber" TEXT,
    "licenceExpiry" TIMESTAMP(3),
    "logoUrl" TEXT,
    "ncdAccepted" BOOLEAN NOT NULL DEFAULT true,
    "inspectionRule" "InspectionRule" NOT NULL DEFAULT 'OPTIONAL',
    "inspectionTiming" "InspectionTiming" NOT NULL DEFAULT 'BEFORE_PAYMENT',
    "inspectionMethod" "InspectionMethod" NOT NULL DEFAULT 'SELF_CAPTURE',
    "icon" TEXT,
    "isBestValue" BOOLEAN NOT NULL DEFAULT false,
    "benefits" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "insurers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurer_contacts" (
    "insurerId" UUID NOT NULL,
    "tagline" TEXT,
    "contactPerson" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "mobile" TEXT,
    "whatsapp" TEXT,
    "email" TEXT NOT NULL,
    "address" TEXT,
    "hours" TEXT,

    CONSTRAINT "insurer_contacts_pkey" PRIMARY KEY ("insurerId")
);

-- CreateTable
CREATE TABLE "insurer_integrations" (
    "insurerId" UUID NOT NULL,
    "apiBaseUrl" TEXT NOT NULL,
    "publicSigningKey" TEXT NOT NULL,
    "quoteCallbackUrl" TEXT,
    "claimsCallbackUrl" TEXT,
    "policyCallbackUrl" TEXT,
    "clientId" TEXT NOT NULL,
    "clientSecretEncrypted" TEXT NOT NULL,
    "sandboxMode" BOOLEAN NOT NULL DEFAULT true,
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurer_integrations_pkey" PRIMARY KEY ("insurerId")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedByCustomerId" UUID,
    "uploadedByStaffId" UUID,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "plateNumber" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" TEXT NOT NULL,
    "color" TEXT,
    "chassisNumber" TEXT,
    "engineNumber" TEXT,
    "registrationDate" TIMESTAMP(3),
    "rtsaAnniversaryDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "status" "QuoteRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "customerId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "vehicleValue" DECIMAL(14,2) NOT NULL,
    "vehicleUsage" TEXT NOT NULL,
    "insuranceType" "InsuranceType" NOT NULL,
    "coverageDuration" "CoverageDuration" NOT NULL,
    "matchRtsaAnniversary" BOOLEAN NOT NULL DEFAULT false,
    "rtsaRegistrationDate" TIMESTAMP(3),
    "policyStartDate" TIMESTAMP(3),
    "policyEndDate" TIMESTAMP(3),
    "coverageDays" INTEGER,
    "ncdCode" TEXT,
    "ncdPercentage" INTEGER,
    "photosCapturedAt" TIMESTAMP(3),
    "requotedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_request_recipients" (
    "id" UUID NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "insurerId" UUID NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "deliveredAt" TIMESTAMP(3),
    "acknowledgedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "quote_request_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurer_quotes" (
    "id" UUID NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "insurerId" UUID NOT NULL,
    "premium" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "insurerReference" TEXT,
    "validityDays" INTEGER NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "extendedAt" TIMESTAMP(3),
    "documentId" UUID NOT NULL,

    CONSTRAINT "insurer_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_shots" (
    "id" UUID NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "shotKey" TEXT NOT NULL,
    "documentId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_shots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "transactionId" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'ZMW',
    "confirmedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "providerReference" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "customerId" UUID NOT NULL,
    "quoteRequestId" TEXT NOT NULL,
    "insurerQuoteId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "policyNumber" TEXT NOT NULL,
    "insurerPolicyNumber" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'AWAITING_INSURER_CERTIFICATE',
    "insurerId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "vehicleId" UUID NOT NULL,
    "coverage" TEXT NOT NULL,
    "plan" TEXT,
    "premium" DECIMAL(14,2) NOT NULL,
    "policyStartDate" TIMESTAMP(3),
    "policyEndDate" TIMESTAMP(3),
    "quoteRequestId" TEXT,
    "insurerQuoteId" UUID,
    "insurerQuoteReference" TEXT,
    "quoteDocumentId" UUID,
    "certificateDocumentId" UUID,
    "paymentId" UUID NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issuedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("policyNumber")
);

-- CreateTable
CREATE TABLE "claim_notifications" (
    "claimNumber" TEXT NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'NOTIFIED',
    "insurerId" UUID NOT NULL,
    "customerId" UUID,
    "policyNumber" TEXT,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "plate" TEXT NOT NULL,
    "vehicleLabel" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "incidentDate" TIMESTAMP(3) NOT NULL,
    "location" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedLoss" DECIMAL(14,2),
    "policeReport" BOOLEAN NOT NULL DEFAULT false,
    "policeReportNumber" TEXT,
    "lateReason" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedAt" TIMESTAMP(3),
    "insurerClaimReference" TEXT,

    CONSTRAINT "claim_notifications_pkey" PRIMARY KEY ("claimNumber")
);

-- CreateTable
CREATE TABLE "claim_attachments" (
    "id" UUID NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "documentId" UUID NOT NULL,

    CONSTRAINT "claim_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncd_applications" (
    "id" UUID NOT NULL,
    "applicationNumber" TEXT NOT NULL,
    "insurerId" UUID NOT NULL,
    "customerId" UUID,
    "policyNumber" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "yearsClaimFree" INTEGER NOT NULL,
    "status" "NcdStatus" NOT NULL DEFAULT 'SUBMITTED',
    "approvedCodeId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ncd_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ncd_codes" (
    "code" TEXT NOT NULL,
    "insurerId" UUID NOT NULL,
    "percentage" INTEGER NOT NULL,
    "yearsClaimFree" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "redeemedAt" TIMESTAMP(3),

    CONSTRAINT "ncd_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'REQUESTED',
    "customerId" UUID NOT NULL,
    "insurerId" UUID,
    "vehiclePlate" TEXT NOT NULL,
    "vehicleLabel" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3),
    "preferredTime" TEXT,
    "preferredLocation" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "inspectorName" TEXT,
    "inspectorPhone" TEXT,
    "location" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_photos" (
    "id" UUID NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "documentId" UUID NOT NULL,

    CONSTRAINT "inspection_photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pia_config" (
    "id" TEXT NOT NULL DEFAULT 'current',
    "piaRatePercentage" DECIMAL(5,2) NOT NULL,
    "updatedByStaffId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pia_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "key" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "integration_deliveries" (
    "id" UUID NOT NULL,
    "insurerId" UUID NOT NULL,
    "kind" "DeliveryKind" NOT NULL,
    "referenceId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "requestPayload" JSONB NOT NULL,
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "integration_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "customers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE INDEX "customers_deletedAt_idx" ON "customers"("deletedAt");

-- CreateIndex
CREATE INDEX "consent_records_customerId_acceptedAt_idx" ON "consent_records"("customerId", "acceptedAt");

-- CreateIndex
CREATE INDEX "otp_challenges_phone_purpose_expiresAt_idx" ON "otp_challenges"("phone", "purpose", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "staff_users_email_key" ON "staff_users"("email");

-- CreateIndex
CREATE INDEX "staff_users_insurerId_idx" ON "staff_users"("insurerId");

-- CreateIndex
CREATE UNIQUE INDEX "insurers_name_key" ON "insurers"("name");

-- CreateIndex
CREATE INDEX "insurers_status_idx" ON "insurers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "insurer_integrations_clientId_key" ON "insurer_integrations"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "documents_storageKey_key" ON "documents"("storageKey");

-- CreateIndex
CREATE INDEX "documents_kind_idx" ON "documents"("kind");

-- CreateIndex
CREATE INDEX "vehicles_plateNumber_idx" ON "vehicles"("plateNumber");

-- CreateIndex
CREATE UNIQUE INDEX "quote_requests_requotedFromId_key" ON "quote_requests"("requotedFromId");

-- CreateIndex
CREATE INDEX "quote_requests_customerId_submittedAt_idx" ON "quote_requests"("customerId", "submittedAt");

-- CreateIndex
CREATE INDEX "quote_requests_status_expiresAt_idx" ON "quote_requests"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "quote_request_recipients_insurerId_status_idx" ON "quote_request_recipients"("insurerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "quote_request_recipients_quoteRequestId_insurerId_key" ON "quote_request_recipients"("quoteRequestId", "insurerId");

-- CreateIndex
CREATE UNIQUE INDEX "insurer_quotes_documentId_key" ON "insurer_quotes"("documentId");

-- CreateIndex
CREATE INDEX "insurer_quotes_validUntil_idx" ON "insurer_quotes"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "insurer_quotes_quoteRequestId_insurerId_key" ON "insurer_quotes"("quoteRequestId", "insurerId");

-- CreateIndex
CREATE UNIQUE INDEX "insurer_quotes_quoteRequestId_insurerReference_key" ON "insurer_quotes"("quoteRequestId", "insurerReference");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_shots_documentId_key" ON "inspection_shots"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_shots_quoteRequestId_shotKey_key" ON "inspection_shots"("quoteRequestId", "shotKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transactionId_key" ON "payments"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "payments_customerId_createdAt_idx" ON "payments"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "payments_status_idx" ON "payments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "policies_paymentId_key" ON "policies"("paymentId");

-- CreateIndex
CREATE INDEX "policies_customerId_receivedAt_idx" ON "policies"("customerId", "receivedAt");

-- CreateIndex
CREATE INDEX "policies_insurerId_status_idx" ON "policies"("insurerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "policies_quoteRequestId_insurerPolicyNumber_key" ON "policies"("quoteRequestId", "insurerPolicyNumber");

-- CreateIndex
CREATE INDEX "claim_notifications_customerId_submittedAt_idx" ON "claim_notifications"("customerId", "submittedAt");

-- CreateIndex
CREATE INDEX "claim_notifications_insurerId_status_idx" ON "claim_notifications"("insurerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "claim_attachments_documentId_key" ON "claim_attachments"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ncd_applications_applicationNumber_key" ON "ncd_applications"("applicationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ncd_applications_approvedCodeId_key" ON "ncd_applications"("approvedCodeId");

-- CreateIndex
CREATE INDEX "ncd_applications_insurerId_status_idx" ON "ncd_applications"("insurerId", "status");

-- CreateIndex
CREATE INDEX "inspections_customerId_createdAt_idx" ON "inspections"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "inspections_status_idx" ON "inspections"("status");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_photos_documentId_key" ON "inspection_photos"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_photos_inspectionId_slot_key" ON "inspection_photos"("inspectionId", "slot");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE INDEX "integration_deliveries_insurerId_kind_referenceId_idx" ON "integration_deliveries"("insurerId", "kind", "referenceId");

-- CreateIndex
CREATE INDEX "integration_deliveries_status_createdAt_idx" ON "integration_deliveries"("status", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorType_actorId_createdAt_idx" ON "audit_logs"("actorType", "actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurer_contacts" ADD CONSTRAINT "insurer_contacts_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurer_integrations" ADD CONSTRAINT "insurer_integrations_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedByCustomerId_fkey" FOREIGN KEY ("uploadedByCustomerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploadedByStaffId_fkey" FOREIGN KEY ("uploadedByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_requotedFromId_fkey" FOREIGN KEY ("requotedFromId") REFERENCES "quote_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_recipients" ADD CONSTRAINT "quote_request_recipients_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quote_request_recipients" ADD CONSTRAINT "quote_request_recipients_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurer_quotes" ADD CONSTRAINT "insurer_quotes_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_shots" ADD CONSTRAINT "inspection_shots_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_shots" ADD CONSTRAINT "inspection_shots_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_insurerQuoteId_fkey" FOREIGN KEY ("insurerQuoteId") REFERENCES "insurer_quotes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "vehicles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_quoteRequestId_fkey" FOREIGN KEY ("quoteRequestId") REFERENCES "quote_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_insurerQuoteId_fkey" FOREIGN KEY ("insurerQuoteId") REFERENCES "insurer_quotes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_quoteDocumentId_fkey" FOREIGN KEY ("quoteDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_certificateDocumentId_fkey" FOREIGN KEY ("certificateDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_notifications" ADD CONSTRAINT "claim_notifications_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_notifications" ADD CONSTRAINT "claim_notifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_notifications" ADD CONSTRAINT "claim_notifications_policyNumber_fkey" FOREIGN KEY ("policyNumber") REFERENCES "policies"("policyNumber") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_attachments" ADD CONSTRAINT "claim_attachments_claimNumber_fkey" FOREIGN KEY ("claimNumber") REFERENCES "claim_notifications"("claimNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_attachments" ADD CONSTRAINT "claim_attachments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncd_applications" ADD CONSTRAINT "ncd_applications_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncd_applications" ADD CONSTRAINT "ncd_applications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncd_applications" ADD CONSTRAINT "ncd_applications_approvedCodeId_fkey" FOREIGN KEY ("approvedCodeId") REFERENCES "ncd_codes"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ncd_codes" ADD CONSTRAINT "ncd_codes_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_photos" ADD CONSTRAINT "inspection_photos_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pia_config" ADD CONSTRAINT "pia_config_updatedByStaffId_fkey" FOREIGN KEY ("updatedByStaffId") REFERENCES "staff_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "insurers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
