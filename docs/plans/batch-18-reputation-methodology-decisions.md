# Batch 18 rating and badge rules for approval

Status: the user approved these starting rules for development. Product and Compliance approval under
DEC-014 is still required before customers see the ratings or performance badges.

## Customer star rating

| Decision | Proposed rule |
| --- | --- |
| Reviews included | Use the current published version of each verified policy review submitted in the past 365 days. Use the original submission date so an edit cannot make an older review count as new. |
| Minimum and calculation | Show a rating once an insurer has 10 eligible reviews. Give each review equal weight, average its 1–5-star rating and show one decimal place. Show the review count and period. Below 10, show the count with “Not enough reviews for a rating yet.” |
| Updates and visibility | Refresh after publication, removal, withdrawal, reinstatement or a published edit. Refresh daily as reviews age out. Show a rating only when both the review policy and the rating method are approved. |

## On-time policy certificates badge

| Decision | Proposed rule |
| --- | --- |
| What it measures | Among paid policies with a recorded certificate deadline that fell in the past 90 days, measure how often the insurer issued the certificate by that deadline. |
| Data source | Use the deadline saved when InsurShield confirms payment and the actual certificate issue time saved by the insurer portal. Use one record per policy. Missing deadlines and deadlines still in the future are outside the sample. A recorded deadline that passed with a late or missing certificate counts as a miss. |
| Minimum and threshold | Award the badge if the insurer has at least 30 eligible policies and issued certificates on time for at least 90% of them. Apply the threshold to the exact ratio before rounding for display. |
| Refresh, expiry and suspension | Recalculate daily. An award expires after 48 hours without a successful refresh. Hide it immediately when the insurer is suspended or no longer eligible to sell through InsurShield, when an authorised administrator suspends the badge with a recorded reason, or when the effective approved method stops applying. Hide it on recalculation if the insurer falls below either threshold. |
| Customer explanation | Show the metric, threshold, measured result, sample size, review period, data source, award date and expiry. Suggested wording is “Based on recent certificate issuance through InsurShield. Check your quote and policy for cover details.” |

An authorised administrator can propose changes to the period, sample, and threshold through the governed rule
settings. Approval creates a version that can be used to explain and reproduce the result. Ratings and badges
appear on the insurer profile and alongside cover options where customers choose whom to ask for a quote.
Quote eligibility, estimates and existing sorting continue to use the objective quote comparison rules.

The development calculation counts all recorded deadlines that have passed. If Product and Compliance later
approve a cancellation exception, it should require a recorded customer request and a timestamp before the
deadline so the result can be reproduced.

The source fields are `insurer_reviews.createdAt`, the current published review revision and the policy's
`issuanceDueAt` and `issuedAt` timestamps. The expiry check uses the saved calculation and award times.

See the [Batch 18 roadmap](roadmap.md#batch-18-ratings-and-performance-badges),
[requirements and decision register](../requirements-spec.md), and [user stories](../user-stories.md).
