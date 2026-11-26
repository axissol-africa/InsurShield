# Batch 17 verified reviews and insurer profiles

[Roadmap](roadmap.md#batch-17-verified-reviews-and-insurer-profiles) |
[Provisional rules](batch-17-review-methodology-decisions.md) |
[Requirements](../requirements-spec.md) |
[Acceptance criteria](../user-stories.md)

## Scope and release

Implement the policy purchase review journey, moderator decisions, insurer responses, approved public profiles
and appeals. The user authorised development using reasonable defaults pending the DEC-014 discussion.
The governed REVIEW_POLICY setting starts provisional. Reviews and replies can be exercised privately during
development. Publication and public reads for review content require a confirmed effective setting.
Product and Compliance still own approval under DEC-014. Aggregate rating calculation and badges follow Batch 18.

## Part 1. Verified policy reviews

- Use an issued server policy with an issuance timestamp and an authenticated, verified customer who owns it.
  Treat an issued renewal as its own eligible interaction. A later cancellation preserves eligibility within the
  original submission window. Use Lusaka calendar dates for deadlines.
- Enforce one review per policy with a database constraint. Keep a durable review record with versioned submissions.
  Lock the review while appending a new revision, withdrawing it, or deciding on a pending revision. A moderation
  decision names the revision explicitly. Public and pending versions can differ until a decision is made.
- Expose the eligibility and review status on the issued policy in the customer account. Show the real star control
  for eligible customers. Preserve the prototype behavior in mock mode.
- Limit writing to a bounded rating and optional plain text, and require moderation before any text is visible publicly.
  Reuse the append-only audit and notification patterns. Keep review text and evidence out of audit payloads.

## Part 2. Insurer profiles and replies

- Let authorised staff submit profile changes for approval. Keep the approved profile visible during review of the
  replacement. Publish it with permission and a recorded decision. Serve only approved public fields and read
  licence and available products from existing insurer and product records.
- Link profiles from the customer's cover choice. Display approved reviews and insurer replies on the profile after
  the review policy is confirmed. Use public field allowlists and paginate review results.
- Allow an authorised insurer to respond to a published review from its own profile. Moderate response revisions
  separately, keep the last approved response visible when reviewing edits, and hide the response whenever its
  parent review is hidden.

## Part 3. Removal, appeals and retention

- Record a reason when a moderator rejects, removes, or reinstates content. Withdraw a review immediately when its
  author requests it. Make version and decision history available only to the roles that need it.
- Allow a customer or the affected insurer to appeal a decision with a private reason and evidence. Record
  the due date and the outcome. Assign the decision to someone other than the original moderator. Show the
  customer's appeal history on their policy after a review is reinstated, edited, or withdrawn.
- Apply the configured retention period through the existing lifecycle job. Preserve content during an open appeal
  or legal hold. Clear retired ratings and text, including responses hidden after the parent review is removed.
  Keep the minimum decision and duplicate-prevention metadata after private content expires.

## Verification

Exercise ownership, unissued and expired eligibility, rating bounds, simultaneous submissions, edits pending
moderation, withdrawal, provisional publication gates on both write and read, tenant and role separation,
independent appeals, retention holds, public field exposure, and access to profiles before payment. Include
PostgreSQL integration tests and browser checks for the affected customer and staff routes.
