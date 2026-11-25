CREATE TYPE "public"."AdjustmentKind" AS ENUM('SETTLEMENT_CORRECTION', 'REVERSAL_RECOVERY', 'FEE_CORRECTION', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."SettlementLineKind" AS ENUM('PAYMENT', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."SettlementStatus" AS ENUM('DRAFT', 'PROPOSED', 'FINALISED');--> statement-breakpoint
ALTER TYPE "public"."ApprovalAction" ADD VALUE 'MONEY_ADJUSTMENT';--> statement-breakpoint
ALTER TYPE "public"."ApprovalAction" ADD VALUE 'SETTLEMENT_FINALISE';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'COMMISSION_RULE';--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'SETTLEMENT_PERIOD';--> statement-breakpoint
CREATE TABLE "money_adjustments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insurerId" uuid NOT NULL,
	"kind" "AdjustmentKind" NOT NULL,
	"amountMinor" bigint NOT NULL,
	"reason" text NOT NULL,
	"reconciliationItemId" uuid,
	"approvalRequestId" uuid NOT NULL,
	"proposedByStaffId" uuid NOT NULL,
	"approvedByStaffId" uuid NOT NULL,
	"settlementId" uuid,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "money_adjustments_amount_check" CHECK ("money_adjustments"."amountMinor" <> 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"settlementId" uuid NOT NULL,
	"kind" "SettlementLineKind" NOT NULL,
	"paymentId" uuid,
	"refundId" uuid,
	"adjustmentId" uuid,
	"amountMinor" bigint NOT NULL,
	"feeMinor" bigint DEFAULT 0 NOT NULL,
	"reference" text NOT NULL,
	"occurredAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "settlement_lines_source_check" CHECK (num_nonnulls("settlement_lines"."paymentId", "settlement_lines"."refundId", "settlement_lines"."adjustmentId") = 1)
);
--> statement-breakpoint
CREATE TABLE "settlements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text NOT NULL,
	"insurerId" uuid NOT NULL,
	"period" varchar(7) NOT NULL,
	"periodStart" timestamp (3) with time zone NOT NULL,
	"periodEnd" timestamp (3) with time zone NOT NULL,
	"status" "SettlementStatus" DEFAULT 'DRAFT' NOT NULL,
	"grossPremiumMinor" bigint NOT NULL,
	"feesMinor" bigint NOT NULL,
	"refundsMinor" bigint NOT NULL,
	"adjustmentsMinor" bigint NOT NULL,
	"commissionMinor" bigint NOT NULL,
	"netPayableMinor" bigint NOT NULL,
	"commissionBps" integer NOT NULL,
	"ruleVersions" jsonb NOT NULL,
	"approvalRequestId" uuid,
	"draftedByStaffId" uuid NOT NULL,
	"finalisedAt" timestamp (3) with time zone,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "settlements_finalised_check" CHECK (("settlements"."status" = 'FINALISED') = ("settlements"."finalisedAt" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "payment_refunds" ADD COLUMN "settlementId" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "settlementId" uuid;--> statement-breakpoint
ALTER TABLE "money_adjustments" ADD CONSTRAINT "money_adjustments_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "money_adjustments" ADD CONSTRAINT "money_adjustments_reconciliationItemId_fkey" FOREIGN KEY ("reconciliationItemId") REFERENCES "public"."reconciliation_items"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "money_adjustments" ADD CONSTRAINT "money_adjustments_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "public"."settlements"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "public"."settlements"("id") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."payments"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlement_lines" ADD CONSTRAINT "settlement_lines_refundId_fkey" FOREIGN KEY ("refundId") REFERENCES "public"."payment_refunds"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_insurerId_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_draftedByStaffId_fkey" FOREIGN KEY ("draftedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "money_adjustments_insurerId_settlementId_idx" ON "money_adjustments" USING btree ("insurerId","settlementId");--> statement-breakpoint
CREATE UNIQUE INDEX "money_adjustments_approvalRequestId_key" ON "money_adjustments" USING btree ("approvalRequestId");--> statement-breakpoint
CREATE INDEX "settlement_lines_settlementId_idx" ON "settlement_lines" USING btree ("settlementId");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_insurerId_period_key" ON "settlements" USING btree ("insurerId","period");--> statement-breakpoint
CREATE UNIQUE INDEX "settlements_reference_key" ON "settlements" USING btree ("reference");--> statement-breakpoint
-- A finalised settlement and its lines never change, and an adjustment is never edited or removed.
CREATE OR REPLACE FUNCTION "settlements_freeze_finalised"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD."status" = 'FINALISED' THEN
    RAISE EXCEPTION 'a finalised settlement cannot change' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "settlements_frozen_once_finalised"
BEFORE UPDATE OR DELETE ON "settlements"
FOR EACH ROW EXECUTE FUNCTION "settlements_freeze_finalised"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "settlement_lines_freeze_finalised"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "settlements"
    WHERE "id" = CASE WHEN TG_OP = 'INSERT' THEN NEW."settlementId" ELSE OLD."settlementId" END
      AND "status" = 'FINALISED'
  ) THEN
    RAISE EXCEPTION 'the lines of a finalised settlement cannot change' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "settlement_lines_frozen_once_finalised"
BEFORE INSERT OR UPDATE OR DELETE ON "settlement_lines"
FOR EACH ROW EXECUTE FUNCTION "settlement_lines_freeze_finalised"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "money_adjustments_append_only"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- The only change ever allowed is recording, once, the settlement that took it.
  IF TG_OP = 'UPDATE'
    AND OLD."settlementId" IS NULL
    AND NEW."settlementId" IS NOT NULL
    AND (to_jsonb(NEW) - 'settlementId') = (to_jsonb(OLD) - 'settlementId') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'money_adjustments is append-only' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "money_adjustments_append_only"
BEFORE UPDATE OR DELETE ON "money_adjustments"
FOR EACH ROW EXECUTE FUNCTION "money_adjustments_append_only"();
