-- The role set decision 7 asks for: six insurer roles beside the two
-- InsurShield ones.
--
-- Three roles meant one INSURER_USER carried every portal function, so an
-- insurer could not say that its finance staff may not answer a claim, nor its
-- compliance reader may not quote. US-VEN-002 requires exactly that, and
-- US-VEN-001 requires reaching an unassigned function to be denied and audited.
--
-- Nothing is granted here. A staff member holding one of these new roles
-- matches no route's role list, so they reach nothing until the permission
-- matrix lands; the vocabulary goes first so the matrix is written against
-- roles that already exist.
--
-- INSURER_USER stays, and keeps carrying the portal. Moving its rows onto
-- INSURER_ADMIN cannot happen here: this migrator applies every pending
-- migration in one transaction, and PostgreSQL refuses an enum value that its
-- own transaction added. Retiring it is a column rewrite, and it belongs with
-- the matrix that replaces what it means.
--
-- Added before INSURER_USER so the stored order groups the insurer roles after
-- the InsurShield ones, as the role lists in enums.ts do.
ALTER TYPE "public"."StaffRole" ADD VALUE 'INSURER_ADMIN' BEFORE 'INSURER_USER';--> statement-breakpoint
ALTER TYPE "public"."StaffRole" ADD VALUE 'QUOTE_OFFICER' BEFORE 'INSURER_USER';--> statement-breakpoint
ALTER TYPE "public"."StaffRole" ADD VALUE 'CLAIMS_OFFICER' BEFORE 'INSURER_USER';--> statement-breakpoint
ALTER TYPE "public"."StaffRole" ADD VALUE 'SUPPORT' BEFORE 'INSURER_USER';--> statement-breakpoint
ALTER TYPE "public"."StaffRole" ADD VALUE 'FINANCE' BEFORE 'INSURER_USER';--> statement-breakpoint
ALTER TYPE "public"."StaffRole" ADD VALUE 'COMPLIANCE_READ_ONLY' BEFORE 'INSURER_USER';