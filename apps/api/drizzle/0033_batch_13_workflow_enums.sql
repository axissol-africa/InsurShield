CREATE TYPE "public"."InspectionPurpose" AS ENUM('UNDERWRITING', 'GENERAL');--> statement-breakpoint
CREATE TYPE "public"."QuoteProductStatus" AS ENUM('SUBMITTED', 'INSURER_PROCESSING', 'VERIFICATION_REQUIRED', 'INSPECTION_REQUIRED', 'QUOTED', 'DECLINED', 'TIMED_OUT', 'EXPIRED', 'CANCELLED', 'MANUAL_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."QuoteStatus" AS ENUM('ACTIVE', 'WITHDRAWN', 'SUPERSEDED');--> statement-breakpoint
ALTER TYPE "public"."InspectionStatus" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."InspectionStatus" ADD VALUE 'NO_SHOW';--> statement-breakpoint
ALTER TYPE "public"."InspectionStatus" ADD VALUE 'REINSPECTION_REQUIRED';--> statement-breakpoint
ALTER TYPE "public"."QuoteRequestStatus" ADD VALUE 'INSURER_PROCESSING';--> statement-breakpoint
ALTER TYPE "public"."QuoteRequestStatus" ADD VALUE 'PARTIALLY_READY';--> statement-breakpoint
ALTER TYPE "public"."QuoteRequestStatus" ADD VALUE 'QUOTES_READY';--> statement-breakpoint
ALTER TYPE "public"."QuoteRequestStatus" ADD VALUE 'QUOTE_SELECTED';--> statement-breakpoint
ALTER TYPE "public"."QuoteRequestStatus" ADD VALUE 'CANCELLED';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'QUOTE_DECLINE_REASONS';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'QUOTE_SLA_WARNING';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'INSPECTION_EVIDENCE_SLOTS';