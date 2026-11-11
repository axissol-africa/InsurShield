-- The statuses onboarding needs, in lifecycle order.
--
-- Three values carried five ideas. "Not yet approved" and "suspended" were both
-- INACTIVE, so the audit log could not tell an insurer that has never traded
-- from one that has been stopped, and decision 24's cascade had no state of its
-- own to hang on.
--
-- The three existing values keep their meanings exactly: ACTIVE trades,
-- INACTIVE has had its approval withdrawn, DELETED is removed. No row changes
-- status here, and nothing yet puts an insurer into either new state -- the
-- onboarding gate that sets PENDING and the suspension that sets SUSPENDED
-- arrive later in this batch. Adding the values first is what lets those be
-- written against a vocabulary that already exists, and it is why this
-- migration needs no backfill: PostgreSQL will not let a transaction use an
-- enum value it added itself.
--
-- Added by position so the stored order reads as the lifecycle does:
-- PENDING, ACTIVE, SUSPENDED, INACTIVE, DELETED.
ALTER TYPE "public"."InsurerStatus" ADD VALUE 'PENDING' BEFORE 'ACTIVE';--> statement-breakpoint
ALTER TYPE "public"."InsurerStatus" ADD VALUE 'SUSPENDED' BEFORE 'INACTIVE';