CREATE TYPE "public"."InsurerProfileDecisionKind" AS ENUM('APPROVE', 'REJECT');--> statement-breakpoint
CREATE TYPE "public"."InsurerProfileRevisionStatus" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');--> statement-breakpoint
ALTER TYPE "public"."RuleSettingKey" ADD VALUE 'REVIEW_POLICY';--> statement-breakpoint
CREATE TABLE "insurer_profile_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revisionId" uuid NOT NULL,
	"decision" "InsurerProfileDecisionKind" NOT NULL,
	"reason" varchar(2000) NOT NULL,
	"decidedByStaffId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "insurer_profile_decisions_reason_check" CHECK (length(trim("insurer_profile_decisions"."reason")) BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "insurer_profile_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"insurerId" uuid NOT NULL,
	"versionNumber" integer NOT NULL,
	"status" "InsurerProfileRevisionStatus" DEFAULT 'PENDING' NOT NULL,
	"brandName" varchar(160) NOT NULL,
	"description" text NOT NULL,
	"serviceInformation" text NOT NULL,
	"contactEmail" varchar(254),
	"contactPhone" varchar(40),
	"websiteUrl" varchar(2048),
	"logoUrl" varchar(2048),
	"submittedByStaffId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "insurer_profile_revisions_version_check" CHECK ("insurer_profile_revisions"."versionNumber" > 0),
	CONSTRAINT "insurer_profile_revisions_content_check" CHECK (length(trim("insurer_profile_revisions"."brandName")) BETWEEN 1 AND 160 AND length(trim("insurer_profile_revisions"."description")) BETWEEN 1 AND 4000 AND length(trim("insurer_profile_revisions"."serviceInformation")) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE TABLE "insurer_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"policyNumber" text NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"withdrawnAt" timestamp (3) with time zone,
	"legalHoldAt" timestamp (3) with time zone
);
--> statement-breakpoint
CREATE TABLE "review_appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"decisionId" uuid NOT NULL,
	"party" text NOT NULL,
	"reason" text,
	"evidence" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"dueAt" date NOT NULL,
	"decidedAt" timestamp (3) with time zone,
	"decidedBy" uuid,
	"outcome" text,
	"outcomeReason" text,
	"purgedAt" timestamp (3) with time zone,
	CONSTRAINT "review_appeals_party_check" CHECK ("review_appeals"."party" IN ('CUSTOMER','INSURER')),
	CONSTRAINT "review_appeals_outcome_check" CHECK (("review_appeals"."outcome" IS NOT NULL AND "review_appeals"."outcome" IN ('UPHELD','OVERTURNED') AND "review_appeals"."decidedAt" IS NOT NULL AND "review_appeals"."decidedBy" IS NOT NULL AND "review_appeals"."outcomeReason" IS NOT NULL)
         OR ("review_appeals"."outcome" IS NULL AND "review_appeals"."decidedAt" IS NULL AND "review_appeals"."decidedBy" IS NULL AND "review_appeals"."outcomeReason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"revisionId" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text NOT NULL,
	"moderatorId" uuid NOT NULL,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "review_decisions_action_check" CHECK ("review_decisions"."action" IN ('PUBLISH','REJECT','REMOVE','REINSTATE'))
);
--> statement-breakpoint
CREATE TABLE "review_revisions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reviewId" uuid NOT NULL,
	"kind" text NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"rating" integer,
	"text" text,
	"createdAt" timestamp (3) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"publishedAt" timestamp (3) with time zone,
	"retiredAt" timestamp (3) with time zone,
	"purgedAt" timestamp (3) with time zone,
	CONSTRAINT "review_revisions_kind_rating_check" CHECK (("review_revisions"."kind" = 'REVIEW' AND "review_revisions"."purgedAt" IS NULL AND "review_revisions"."rating" IS NOT NULL AND "review_revisions"."rating" BETWEEN 1 AND 5)
        OR ("review_revisions"."kind" = 'REVIEW' AND "review_revisions"."purgedAt" IS NOT NULL AND "review_revisions"."rating" IS NULL)
        OR ("review_revisions"."kind" = 'RESPONSE' AND "review_revisions"."rating" IS NULL)),
	CONSTRAINT "review_revisions_purged_check" CHECK ("review_revisions"."purgedAt" IS NULL OR
        ("review_revisions"."retiredAt" IS NOT NULL AND "review_revisions"."text" IS NULL AND "review_revisions"."status" IN ('REJECTED','REMOVED','SUPERSEDED'))),
	CONSTRAINT "review_revisions_status_check" CHECK ("review_revisions"."status" IN ('PENDING','PUBLISHED','REJECTED','REMOVED','SUPERSEDED')),
	CONSTRAINT "review_revisions_text_length_check" CHECK (length("review_revisions"."text") <= 2000),
	CONSTRAINT "review_revisions_published_check" CHECK ("review_revisions"."status" <> 'PUBLISHED' OR ("review_revisions"."publishedAt" IS NOT NULL AND "review_revisions"."purgedAt" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "insurer_profile_decisions" ADD CONSTRAINT "insurer_profile_decisions_revision_fkey" FOREIGN KEY ("revisionId") REFERENCES "public"."insurer_profile_revisions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_profile_decisions" ADD CONSTRAINT "insurer_profile_decisions_reviewer_fkey" FOREIGN KEY ("decidedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_profile_revisions" ADD CONSTRAINT "insurer_profile_revisions_insurer_fkey" FOREIGN KEY ("insurerId") REFERENCES "public"."insurers"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_profile_revisions" ADD CONSTRAINT "insurer_profile_revisions_submitter_fkey" FOREIGN KEY ("submittedByStaffId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "insurer_reviews" ADD CONSTRAINT "insurer_reviews_policy_fkey" FOREIGN KEY ("policyNumber") REFERENCES "public"."policies"("policyNumber") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_appeals" ADD CONSTRAINT "review_appeals_decision_fkey" FOREIGN KEY ("decisionId") REFERENCES "public"."review_decisions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_appeals" ADD CONSTRAINT "review_appeals_decider_fkey" FOREIGN KEY ("decidedBy") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_revision_fkey" FOREIGN KEY ("revisionId") REFERENCES "public"."review_revisions"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_decisions" ADD CONSTRAINT "review_decisions_moderator_fkey" FOREIGN KEY ("moderatorId") REFERENCES "public"."staff_users"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "review_revisions" ADD CONSTRAINT "review_revisions_review_fkey" FOREIGN KEY ("reviewId") REFERENCES "public"."insurer_reviews"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_profile_decisions_revision_key" ON "insurer_profile_decisions" USING btree ("revisionId");--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_profile_revisions_version_key" ON "insurer_profile_revisions" USING btree ("insurerId","versionNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_profile_revisions_pending_key" ON "insurer_profile_revisions" USING btree ("insurerId") WHERE "insurer_profile_revisions"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_profile_revisions_approved_key" ON "insurer_profile_revisions" USING btree ("insurerId") WHERE "insurer_profile_revisions"."status" = 'APPROVED';--> statement-breakpoint
CREATE UNIQUE INDEX "insurer_reviews_policy_key" ON "insurer_reviews" USING btree ("policyNumber");--> statement-breakpoint
CREATE UNIQUE INDEX "review_appeals_party_decision_key" ON "review_appeals" USING btree ("decisionId","party");--> statement-breakpoint
CREATE INDEX "review_appeals_due_idx" ON "review_appeals" USING btree ("dueAt") WHERE "review_appeals"."decidedAt" is null;--> statement-breakpoint
CREATE INDEX "review_appeals_retention_idx" ON "review_appeals" USING btree ("decidedAt") WHERE "review_appeals"."purgedAt" is null;--> statement-breakpoint
CREATE INDEX "review_decisions_revision_created_idx" ON "review_decisions" USING btree ("revisionId","createdAt","id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_revisions_version_key" ON "review_revisions" USING btree ("reviewId","kind","version");--> statement-breakpoint
CREATE UNIQUE INDEX "review_revisions_pending_key" ON "review_revisions" USING btree ("reviewId","kind") WHERE "review_revisions"."status" = 'PENDING';--> statement-breakpoint
CREATE UNIQUE INDEX "review_revisions_published_key" ON "review_revisions" USING btree ("reviewId","kind") WHERE "review_revisions"."status" = 'PUBLISHED';--> statement-breakpoint
CREATE INDEX "review_revisions_status_created_idx" ON "review_revisions" USING btree ("status","createdAt","id");--> statement-breakpoint
CREATE INDEX "review_revisions_retention_idx" ON "review_revisions" USING btree ("retiredAt") WHERE "review_revisions"."purgedAt" is null;
--> statement-breakpoint
-- Review decision invariants begin
CREATE FUNCTION public.review_decisions_reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Review decisions are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER review_decisions_append_only BEFORE UPDATE OR DELETE ON public.review_decisions
FOR EACH ROW EXECUTE FUNCTION public.review_decisions_reject_mutation();
--> statement-breakpoint
CREATE TRIGGER insurer_profile_decisions_append_only BEFORE UPDATE OR DELETE ON public.insurer_profile_decisions
FOR EACH ROW EXECUTE FUNCTION public.review_decisions_reject_mutation();
--> statement-breakpoint
-- Review decision invariants end
INSERT INTO "notification_templates" ("id", "key", "channel", "category", "version", "subject", "body", "mandatory", "activeFrom")
SELECT gen_random_uuid(), template.key, channel::"NotificationChannel", 'ACCOUNT', 1, template.subject, template.body,
       true, '1970-01-01T00:00:00Z'
FROM (VALUES
  ('REVIEW_MODERATED', 'Your insurer review has an update', 'Sign in and open the review on your policy to see the decision.'),
  ('REVIEW_APPEAL_DECIDED', 'Your insurer review appeal has an update', 'Sign in to see the decision on your appeal.')
) AS template(key, subject, body)
CROSS JOIN (VALUES ('IN_APP'), ('EMAIL')) AS channels(channel)
ON CONFLICT ("key", "channel", "version") DO NOTHING;
