# Batch 18 ratings and performance badges

[Roadmap](roadmap.md#batch-18-ratings-and-performance-badges) |
[Development methodology and launch approval](batch-18-reputation-methodology-decisions.md) |
[Requirements](../requirements-spec.md) |
[Acceptance criteria](../user-stories.md)

## 1. Governed rules and ratings

- Add a versioned, audited `REPUTATION_POLICY` to rule settings. Defaults are provisional. Confirm this
  method before public display and confirm Batch 17's `REVIEW_POLICY` before showing customer ratings.
- Calculate ratings from current published review revisions joined to the authoritative policy. Use the
  original submission date in the approved rolling window. A withdrawal, edit approval, removal or
  reinstatement is visible on the next read. Disclose the count, window, minimum, mean calculation
  and used rule version. Report the count without an average until the minimum sample is met.
- Batch public reads across the insurers on a cover-options page. Serve only approved aggregates and
  summary evidence. Leave product eligibility, estimates, premiums and comparison sort order governed
  by their own rules.

## 2. Certificate badge and governance

- Store a daily calculation with its method version, evidence window, exact counts and publication
  deadline. The job runner repeats each insurer's calculation with durable retry and deduplication.
  A failed insurer calculation still lets other insurers refresh. An insurer
  that stops meeting the threshold loses visibility as soon as the new calculation completes.
- Count verified deadlines from confirmed payments up to the measurement time. A certificate issued on
  its deadline counts. Expired deadlines without a certificate count as misses. Methods use exact
  ratios for eligibility and round figures only for display.
- At read time, require current insurer standing, a current approved method and a fresh qualifying
  calculation. An authorised administrator can suspend the badge with a reason. Resume takes effect
  after a fresh qualifying calculation. Require the current suspension generation on each decision
  so stale actions cannot override newer ones. Preserve auditable suspension and calculation history.
- Display results on public insurer profiles and concise information alongside the customer's cover
  options. Include the metric, source, threshold, minimum, measured period, award and expiry on the
  profile and in an expandable explanation on the cover option. Show an insufficient-review status
  until an average is available. Give customers a retry if reputation data is unavailable and keep
  cover selection usable. Open pages remove badges at expiry and refresh reputation while visible.

## 3. Verification

Cover exact boundaries, absence of an approved method, too few records, invalid samples, pending and
removed reviews, edits with the original submission date, missing deadlines, equal timestamps, policy
version changes, retries, failed refreshes, expiry, suspension, insurer standing, permissions and public
field exposure. Test the real API and the customer and administrator screens. Sponsored placements
remain in the deferred roadmap scope.
