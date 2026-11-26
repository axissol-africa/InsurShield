# Batch 17 review rules for approval

Status: provisional development defaults, as directed by the user while Product and Compliance discuss DEC-014.
Record their approved rules and decision date in DEC-014 before enabling publication. Public reviews and
insurer responses require a confirmed review policy.

| Decision | Proposed launch rule |
| --- | --- |
| Who may review and when | A signed-in customer with a verified email may review the insurer after it issues a policy through InsurShield to that customer. Open the form from the issued policy in My account and offer it when the customer reaches an issued-policy confirmation. Accept reviews within 90 calendar days of issuance. Claims, NCD and other service interactions would need their own approved eligibility rules. |
| Rating and duplicate rule | Require one whole-star rating from 1 to 5, with an optional written review. Allow one review per issued policy. A separately issued renewal qualifies once. Eligibility opens when the insurer issues the policy. |
| Edits and withdrawals | Allow edits during the first 30 calendar days after submission and send each edit for moderation. Keep the last approved version visible while an edit is reviewed. Let the customer withdraw at any time, remove the public review and its response immediately, and preserve the original review’s eligibility record to prevent duplicate submissions. |
| Publication and prohibited content | Require a moderator to approve reviews and insurer responses before publication. Show the stars, approved text, month and year, verified policy purchase label, and any approved response. Keep customer names, policy numbers, claim details, payment details, registration numbers, and other identifying details private. Reject threats, harassment, discriminatory abuse, spam, impersonation, and undisclosed paid or incentivised reviews. Fair criticism stays eligible. |
| Insurer responses and public profiles | Authorised insurer staff may submit one public response per published review. Edits go through moderation. Insurers can propose profile updates with brand details, contacts, service information and links. Customers can open an approved profile and read published reviews before requesting a quote. Show product and licence information from approved records. |
| Appeals and evidence | Let the customer appeal a review decision and the insurer dispute a published review or a decision about its response. Allow 30 calendar days from notice and aim for a decision within 14 calendar days of receipt. Ask for a reason and evidence privately, and assign a reviewer who did not make the original decision. An appeal leaves current visibility in place unless a moderator separately finds a reason to remove the content. Notify the appellant of the outcome and keep an auditable decision history. |
| Retention and holds | Confirm a retention period and trigger for unpublished text, superseded revisions, private evidence and appeal records. Proposed starting point for approval: 12 months after the case closes or content becomes unpublished, whichever is later, subject to unresolved appeals and legal holds. Use the approved audit-retention rules for decision metadata and keep private review text and evidence out of that audit record. |

## Requirements to carry into the plan

- Verify ownership and issuance against server records. Use insurer and policy identifiers for linkage and enforce
  one review per eligible policy in the database. Base eligibility on completed issuance.
- Keep public results tied to approved profile, review and response versions. Your own account can show moderation
  and appeal status. Portal access and document permissions follow the user's role and insurer membership.
- Preserve the distinction between historical service and current sales eligibility. Licence status and available
  products come from authoritative insurer and product records.
- Compare approved individual reviews from the insurer profile before requesting a quote. Aggregate ratings,
  calculation disclosures and performance badges follow Batch 18.

See [Batch 17 in the roadmap](roadmap.md#batch-17-verified-reviews-and-insurer-profiles),
[DEC-014 and the review requirements](../requirements-spec.md), and [the acceptance criteria](../user-stories.md)
for US-CUS-025, US-VEN-013 and US-ADM-015.
