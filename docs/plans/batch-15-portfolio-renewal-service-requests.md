# Batch 15: Accounts, portfolio, renewal and service requests

## Purpose

A customer who has bought a policy needs to keep it: see everything they hold in one place, renew it on time, ask the
insurer for a change or a replacement document, and, when they leave, take their data with them and have it deleted
on schedule. Today the account page lists policies and requests, a renewal starts a fresh product comparison with no
reminder and no link to the product the customer had, there is no way to ask an insurer for anything after purchase,
and closing an account is a soft delete that nothing ever follows up.

Backlog items: US-CUS-018 (portfolio), US-CUS-019 (renewal reminders in the notification centre), US-CUS-020 (renew an
eligible policy), US-CUS-021 (service requests and support), US-VEN-007 (renewals, second part), US-ADM-012 (link
support to records), and the data lifecycle half of US-ADM-013. Requirements: FR-SELF-002, FR-SELF-007, FR-REN-001 to
003, FR-POL-003, FR-SUP-001 and 002, FR-IP-009 (renewals), FR-ADM-012, NFR-PRI-001 (data-subject requests and
retention), BR-010 (renewal). Decisions applied: 13 (the external help desk handles complaints and support; InsurShield
hands over with record references), the coordinator choice in section 0 of the roadmap (service requests live inside
InsurShield), quote-flow step 12 (renewal recipients).

## Before this batch starts

What batches 12 to 14 left, which this batch builds on:

- **Renewal** starts in the web: `renewFromPolicy` copies the vehicle, cover type and dates into a new journey with
  `renewalOfPolicyNumber`, and the customer chooses products again. `POST /policies/:n/renew` refuses with
  `RENEWAL_REQUIRES_PRODUCT_SELECTION`. `renewalState()` gives the window (60 days, hard-coded) and blocks a second
  open renewal. There is no reminder, and the product the customer had is not carried over.
- **Policies** carry `productVersionId` (from batch 14), so the product behind a policy can be found.
- **Notifications** have templates, channels, contact preferences and mandatory flags; the job runner now runs in a
  served app (batch 14 part 3a).
- **Account closure** (`POST /account/close`) refuses while a policy is in force, soft-deletes the customer and ends
  sessions. Nothing exports data and nothing deletes anything later.
- **Documents** carry a retention class from upload (batch 5); `DOCUMENT_RETENTION` (batch 10) holds the days per
  class. No job applies them.
- **Refunds** (batch 14) are proposed by one administrator and approved by another; a reconciliation item can lead to
  one.

## Rules this batch must hold

1. A renewal is a new quote request through the normal journey. Nothing renews automatically, and nothing changes the
   old policy.
2. A reminder is sent once per policy and reminder day, through the notification service, so the customer's channel
   preferences and the template's mandatory flag apply. A policy that already has an open or paid renewal gets no
   further reminders.
3. A service request never changes a policy by itself. Only the insurer's recorded decision does, and only for the
   request types that allow it; cancellation never refunds by itself (a refund still needs two administrators).
4. Each party sees only its own: a customer their own requests; an insurer the requests for its own policies;
   InsurShield administrators all of them.
5. A data export contains only the customer's own records, never another person's, never internal notes or staff
   identities, and is produced on request, not stored.
6. Deletion follows the retention settings and never removes what a live contract, an open claim, an open service
   request, an open reconciliation item or an unsettled payment still needs. Every deletion is audited without the
   deleted content.

## The state model

### Service request (`service_requests.status`)

`SUBMITTED → IN_REVIEW → APPROVED → COMPLETED`, with `INFORMATION_REQUIRED` from `IN_REVIEW` (back to `IN_REVIEW` when
the customer answers), `DECLINED` from `SUBMITTED` or `IN_REVIEW`, and `WITHDRAWN` by the customer from any open
state. `APPROVED` is the insurer's recorded decision; `COMPLETED` is when the change is done (for a cancellation, when
the policy is cancelled). `DECLINED`, `COMPLETED` and `WITHDRAWN` are final.

Types: `DETAILS_CHANGE` (a correction to the policy's details, such as contact or vehicle details), `DOCUMENT_REPLACEMENT`,
`CANCELLATION`, `ASSISTANCE`. Only `CANCELLATION` changes a policy, and only on `COMPLETED`.

## Delivery order

### B15.1 Renewal

1. **Setting** `RENEWAL_POLICY` (batch 10 rule versions, provisional): `{ windowDays: 60, reminderDays: [30, 14, 3] }`.
   `renewalState()` reads the window from it instead of the constant.
2. **The product carried over** (quote-flow step 12): each policy response gains `renewalProduct`: the current
   approved version of the product the policy was bought on, when one is eligible for new business today, with its
   name and whether its terms changed since the policy's version; null for a policy from before product selection
   or a product no longer offered (with the reason). The web preselects it when the customer renews; the customer
   can still add or remove products.
3. **Reminders**: a daily job finds active policies whose end date is one of `reminderDays` away (in Lusaka days) and
   that have no open or paid renewal, and sends `policy.renewal_due` (in-app and email, category `POLICY`). A
   `renewal_reminders` row per (policy, day) makes each reminder once, even if the job runs twice. After the end
   date, one `policy.lapsed` notice.
4. **Insurer view**: a renewal request shows the insurer "Renewal of POL-…" with the previous insurer and dates (the
   insurer can requote, ask for information, ask for an inspection or decline it with the normal batch 13 actions).
5. Tests: the window and reminder days come from the setting; each reminder is sent once; no reminder when a renewal
   is open or paid; the lapsed notice once; `renewalProduct` for a current product, a changed one, a withdrawn one
   and a legacy policy; another customer's policy is not reachable.

### B15.2 Service requests and support hand-over

1. **Schema**: `service_requests` (`reference`, `policyNumber`, `customerId`, `insurerId`, `type`, `status`,
   `reason`, `evidenceDocumentIds`, `requestedEffectiveDate` for a cancellation, `decision`, `decisionNote`,
   `decidedByStaffId`, `decidedAt`, `completedAt`, timestamps) and `service_request_updates` (append-only:
   author kind and id, `message`, `visibleToCustomer`, `statusFrom`, `statusTo`, `createdAt`).
2. **Customer**: `POST /service-requests` for one of their own policies that is active or being issued (a reason of
   at least 10 characters; evidence documents from batch 5's upload; a cancellation date not in the past);
   `GET /service-requests` and `/:reference` with the updates meant for them; `POST /:reference/reply` to answer an
   information request; `POST /:reference/withdraw`.
3. **Insurer** (`portal:service-request:read` for every insurer role that reads policies, `...:manage` for
   `INSURER_ADMIN`, `INSURER_USER` and `SUPPORT`): a queue of its own requests oldest first; take into review; ask
   the customer for information; post an update; decline with a reason; approve with a note. Approve-and-complete for
   `DETAILS_CHANGE`, `DOCUMENT_REPLACEMENT` and `ASSISTANCE` records what the insurer did (a replacement certificate
   goes through the existing certificate upload). For `CANCELLATION`, approval records the insurer's refund amount
   (zero or more, at most what was paid less completed refunds) and the cancellation date; completing it moves the
   policy to `CANCELLED` and, when the amount is above zero, opens a `REFUND_REQUIRED` reconciliation item for that
   amount, so the refund goes through batch 14's two-person approval.
4. **InsurShield administrators** read every request (`service-request:read`), for support.
5. **Notifications** to the customer for each status change and each update meant for them; to the insurer's
   staff by email for a new request (the batch 13 staff email job).
6. **Support hand-over** (decision 13): `GET /support/contact` returns the help-desk address and hours from
   configuration and the customer's open record references (requests, policies, payments, service requests, claims),
   which the web shows on a "Contact support" page with a copy button. `GET /admin/records/:reference` finds any record
   by its InsurShield reference for a help-desk agent, and audits the look-up (US-ADM-012).
7. Tests: each transition and its refusal; a customer cannot reach another's request or policy; an insurer cannot
   reach another insurer's request (404, audited); the policy is unchanged until completion; a completed
   cancellation cancels the policy and opens one refund item for the stated amount; withdrawn and final states refuse
   further actions; updates meant for the insurer are never shown to the customer.

### B15.3 Data lifecycle

1. **Export** `GET /account/export`: one JSON document with the customer's profile, consents, contact preferences,
   vehicles, quote requests (answers, chosen products, quotes received), payments (masked), policies, service
   requests with customer-visible updates, claims, NCD applications, inspections and notifications, plus the list of
   their documents with protected download links. Audited (`customer.data_exported`), rate-limited, never stored.
2. **Closure**: unchanged refusal while cover is in force; now also refused while a service request is open, a payment
   is in progress, or a refund is in progress, with the reason. Closing withdraws drafts and open quote requests.
3. **Deletion job** (daily, on the job runner): for each document whose retention class period (from
   `DOCUMENT_RETENTION`) has passed since its upload, and which is not held by a live policy, an open claim, an open
   service request or an open reconciliation item, delete the stored object and mark the row deleted (keeping its id,
   kind, class and dates, so references stay explainable). For a customer closed longer than a new `ACCOUNT_RETENTION`
   setting (`{ daysAfterClosure }`), replace their name, phone and email with a placeholder and remove their sign-in, keeping the records that
   regulators require under their own classes. Audit counts, never content.
4. Tests: the export contains every category and nothing of anyone else's; closure refusals; the deletion job deletes
   only what is past its period and not held, is idempotent, and audits; anonymisation keeps the records and removes
   the identity.

### B15.4 Web

1. **Portfolio** (`CustomerAccountPage`): one place for requests, policies, renewals, service requests and documents,
   each showing its insurer, status, latest update, next action and due date, with a search and status filters
   (FR-SELF-002, FR-SELF-007) and an empty state with the start action for each kind.
2. **Renewal**: reminders in the notification centre link to the renewal page; renewing preselects the carried-over
   product and shows when its terms changed.
3. **Service requests**: a "Request a change" action on each policy, a form per type with evidence upload, the
   request's timeline, reply and withdraw.
4. **Insurer portal**: a Service requests section with the queue and each request's actions.
5. **Contact support** page with the help-desk details and the record references to quote; **Privacy** section in the
   account with "Download my data" and the closure explanation.
6. **Admin console**: find a record by reference.
7. Tests: component tests for each screen and state; Playwright on the mock lane for renewal from a reminder and a
   service request from submission to completion.

### B15.5 Verification and records

`npm run lint`, `npm run test`, `npm run build`, API `tsc --noEmit`, API e2e and Playwright with numbers. Update
`INSURER_API_INTEGRATION.md` (renewal requests and service requests are portal-only for now), the README settings
table and `docs/PAYMENTS.md` (cancellation refunds). List the provisional settings this batch adds for the batch 20
release gate.

## Security and privacy

- Every route is scoped to its owner; another owner's record answers as absent, and an insurer reaching for another
  insurer's request is audited (as batch 7 does for quotes).
- The export goes only to the signed-in customer, after a fresh session check, and is never written to storage.
- The deletion job never deletes audit history; audit entries keep ids and counts, never the deleted content.
- Help-desk look-ups by reference are audited with who looked and why.

## Explicit boundaries

- Claims, NCD and inspections after payment are batch 16; the export includes what exists of them today.
- No automatic renewal, no repricing outside the normal quote, no NCD carry-over rule (batch 16).
- No two-way chat: updates on a service request are messages on the request, not a conversation channel (amendment
  5.1).
- The help desk itself is external (decision 13); InsurShield only hands over references and contact details.
- Pro-rata refund calculation is the insurer's, stated on its approval; InsurShield does not compute it.

## Open questions for the user

Each has a provisional default so the batch proceeds.

1. **Renewal reminders.** Default: 30, 14 and 3 days before the end date, in-app and email, and one lapsed notice.
2. **Who may decide service requests at an insurer.** Default: `INSURER_ADMIN`, `INSURER_USER` and `SUPPORT`.
3. **Retention periods.** Default: the `DOCUMENT_RETENTION` values already provisional from batch 10, and an
   `ACCOUNT_RETENTION` of 7 years (2,555 days) after closure before the identity is anonymised.
4. **Help-desk contact.** Default: an address and hours from configuration (`HELP_DESK_EMAIL`, `HELP_DESK_PHONE`,
   `HELP_DESK_HOURS`), shown as given.

## Delivery in parts

One branch, `feat/batch-15-portfolio`, one PR at the end:

- **Part 1**: B15.1 renewal with its web parts.
- **Part 2**: B15.2 service requests and support hand-over with their web parts.
- **Part 3**: B15.3 data lifecycle and the portfolio search and filters.

### Part 1 as delivered

- `RENEWAL_POLICY` sets the window and the reminder days. Migration 0043 adds the setting key, the
  `renewal_reminders` table and the `policy.renewal_due` and `policy.lapsed` templates (in-app and email,
  category `POLICY`, not mandatory, so a customer who turned policy email off still sees them in the app).
- A reminder run that was missed sends the closest reminder still ahead (a policy 2 days from its end gets the
  3-day reminder), never an older one, and a later reminder is not sent once a closer one has gone out.
- The lapsed notice goes once, within 30 days after the end date, so a long-lapsed policy is not told years later.
- Where the plan said `renewalProduct` is null for a product no longer offered, it is
  `{ available: false, reason }` instead, so the renewal page can say why nothing is preselected. It is null only
  for a policy bought before product selection.
- Notifications gain `action` (`RENEW` for the two renewal notices), so the notification centre links them to the
  renewal page rather than to the account.
- The insurer portal shows "Renewal of POL-… (previous insurer, ends date)" in the queue and on the quote screen.
- Fixed on the way: renewing against the real API stopped at "Let's start with your vehicle", because the policy
  response had no vehicle value. Policies now carry `vehicleValue` and `vehicleUsage` from the request they were
  quoted on, and the renewal starts with both filled in.
- The served job runner test now queues its job ahead of everything else, so a long backlog left by the rest of
  the suite cannot time it out.

### Part 2 as delivered

- Migration 0044 adds `service_requests`, the append-only `service_request_updates` (a database trigger refuses any
  change or deletion), the `SERVICE_REQUEST_DOCUMENT` document kind and the `service_request.*` templates. The
  templates are mandatory: a customer always hears what the insurer decided about their own request.
- The database holds the state model too: a decision matches the status, a completed request has its completion time,
  an approved cancellation carries its refund and end date, and a policy has at most one open cancellation.
- Insurer routes: `GET /insurer/service-requests` (oldest first, optional `status`), `GET .../:reference`, and
  `POST .../:reference/review`, `/information-requests`, `/updates`, `/decline`, `/approve`, `/complete`. An update
  can be kept internal; the customer never sees it, nor a document attached to it.
- A correction, replacement or help request can be completed in one step, which records the approval and the
  completion together. A cancellation must be approved first and is completed on or after its end date.
- A customer can ask about a policy that is active or still being issued, but can cancel only cover that is in force:
  before issue, the insurer reports it cannot issue and the customer is refunded that way.
- Documents on a service request are kept under `POLICY_EVIDENCE`, as evidence about the contract.
- Fixed on the way: a policy issued and then cancelled on the customer's request dropped out of settlements, so its
  premium and the refund on it were never accounted to the insurer. Settlements now include cover that was issued
  and later cancelled. The failing test came first.
- Support: `GET /support/contact` gives the help desk from `HELP_DESK_EMAIL`, `HELP_DESK_PHONE` and `HELP_DESK_HOURS`
  and up to ten open references per kind. `GET /admin/records/:reference?reason=` searches requests, policies,
  payments, claims, service requests, NCD applications and inspections, and audits every look-up with the reason,
  found or not.
- Web: "Request a change" on each policy that can take one, a form per type with evidence upload, the request's
  timeline with reply and withdraw, a Service requests section in the insurer portal, the help desk card on the
  support page, and "Find a record by reference" under Find customer in the admin console. A notification about a
  service request opens it.

## Size and split

L. If it splits, split after part 2: renewal and service requests first, data lifecycle second.
