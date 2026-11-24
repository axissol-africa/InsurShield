# Batch 14: Payments, issuance and reconciliation

## Purpose

Today a payment is a pretend one. `PaymentsService.pay` writes a `CONFIRMED` payment and a policy in the same
transaction the moment the customer presses Pay. No money moves, nothing can be pending or fail, nobody can refund,
and nobody checks the records against a provider.

Batch 14 makes payment real in shape, even though the real provider is still a stand-in until DEC-008 is settled. A
payment starts, waits for the provider, and is confirmed, failed or reversed only by a signed provider callback (or a
status check against the provider). Only a confirmed payment starts issuance, and only the insurer's acceptance and
certificate make a policy active. Every way this can go wrong (a payment that never confirms, a payment for a quote
that became unpayable while it was pending, an insurer that cannot issue, a duplicate, a reversal) ends in a visible
exception with an owner, and money only goes back to a customer through a refund two people have approved. Finance
can match InsurShield's records against the provider's statement and produce a settlement per insurer.

Backlog items: US-CUS-016, US-CUS-017, US-VEN-007 (issuance; renewals are batch 15), US-ADM-009, and money adjustments
under two-person approval (FR-ADM-003). Requirements: FR-PAY-001 to 004, FR-POL-001, FR-POL-002, FR-IP-008, FR-IP-013
(read-only, Should), FR-ADM-011, NFR-REL-001 to 004, section 8.1 payment and issuance states, section 9 payment
provider row. Decisions applied: 4 (provider stand-in, production refuses it), 15 (two-person approval for money
adjustments), 21 (no road tax), 24 (pending provider payments when an insurer is suspended), DEC-019 (payment alone
never issues a policy).

## Before this batch starts

1. **Batch 13 is merged** (`feat/batch-13-workflow`). What it actually built, and what this plan therefore uses:
   - `insurer_quotes.status` (`ACTIVE | WITHDRAWN | SUPERSEDED`), the premium breakdown (`componentsMinor`), excess,
     add-ons (`{ code, label, priceMinor, included, terms }`) and conditions. Only an `ACTIVE` quote can be paid.
   - `quote_selections`: one current choice per request with `insurerQuoteId` and `acceptedConditionCodes`. It has
     **no chosen add-ons yet**; this batch adds `selectedAddOnCodes` (B14.1) and lets `POST
     /quote-requests/:id/selection` take them.
   - The request's overall state is **computed**, not stored: `requestProgress()` in
     `src/customer/domain/quote-workflow.ts` returns `progress` on every request response. `QuoteRequestStatus` was
     left at `SUBMITTED | QUOTED | EXPIRED`. This batch extends `requestProgress()` with the payment and policy
     states instead of adding enum values (see "Request progress" below).
   - Payment already refuses a quote that is not `ACTIVE` (`QUOTE_UNAVAILABLE`), one whose purchase-critical
     conditions were not accepted by choosing it (`CONDITIONS_NOT_ACCEPTED`). These checks move into initiation
     unchanged. Inspections are optional and never hold up payment, so there is no inspection check.
   - The hourly sweep (`QuoteWorkflowService.sweep`) expires unpaid quoted products at their validity date. From this
     batch it must leave alone a product whose quote has an open payment attempt (rule 2 of B14.3).
2. **DEC-008 is still open** (payment providers, settlement and refunds). The batch builds against a provider-neutral
   adapter with a stand-in. Open questions 1 to 4 below collect what finance has to decide; each has a provisional
   default held in a setting, so the batch is not blocked.

## Rules this batch must hold

1. The amount is always computed by the server from the selected quote, its selected add-ons and the approved fee
   lines. The client's amount is only compared, never used.
2. A payment is confirmed only by a verified provider callback or a provider status query. Nothing the browser says
   confirms a payment.
3. One request has at most one open payment attempt and at most one confirmed payment. A replayed callback, a
   duplicate attempt or a retried command never creates a second charge or a second policy (FR-PAY-003, NFR-REL-001).
4. Payment never issues a policy (DEC-019). A confirmed payment creates the policy in `AWAITING_INSURER_CERTIFICATE`
   ("Policy issuing"); only the insurer's acceptance and certificate make it `ACTIVE`.
5. Every failure after money is taken has an exception with an owner, a reason and an age, and ends either in a policy
   or in a refund. Nothing is left open (FR-PAY-004).
6. Refunds and manual money adjustments need two different InsurShield administrators (decision 15). The maker cannot
   approve their own.
7. Card details never reach InsurShield (FR-PAY-001). Mobile-money numbers are stored only as far as the provider
   contract needs, and masked in every response, log and audit entry.
8. The production start refuses a stand-in payment provider (decision 4, batch 5 gate).
9. Decision 24: a quote of a suspended insurer cannot start a payment. A payment already pending at the provider when
   the mark is made is completed into a refund, never into a policy, and never left open.
10. Each state change of a payment, refund, policy, reconciliation item or settlement goes through the batch 4
    transition helper and audit writer, in the same transaction as the change.

## The state model

### Payment (`payments.status`)

`INITIATED → PENDING → CONFIRMED`, with `FAILED`, `CANCELLED`, `EXPIRED` from `INITIATED` or `PENDING`, and
`REVERSED` from `CONFIRMED` (provider chargeback or reversal).

- `INITIATED`: written before calling the provider, so a crash between our insert and the provider's answer is
  recoverable by a status query.
- `PENDING`: the provider accepted the instruction (mobile-money prompt sent, or card checkout created) and gave its
  payment id.
- `CONFIRMED`: the provider says the money was taken.
- `FAILED`: the provider says it was declined or errored; `failureCode` holds the provider-neutral code.
- `CANCELLED`: the customer cancelled the attempt before the provider took money.
- `EXPIRED`: no outcome within `PAYMENT_PENDING_TIMEOUT` and the provider status query also says not paid.
- `REVERSED`: money taken and later returned by the provider outside our refund flow (a chargeback).

Refunds are their own records (below), so a payment stays `CONFIRMED` while a refund is in progress and its refunded
total is the sum of completed refunds.

### Policy (`policies.status`)

`AWAITING_INSURER_CERTIFICATE` ("Policy issuing") `→ ACTIVE`, plus `ISSUANCE_FAILED` from issuing (the insurer
declined to issue, or the issuance deadline passed and operations confirmed it failed) and `CANCELLED` from
`ISSUANCE_FAILED` once the refund has completed. Cancelling an active policy is a policy service request (batch 15).

### Request progress (extends batch 13's `requestProgress()`)

When the request has a payment attempt, its progress follows the payment and policy, in this order: `ACTIVE` policy
→ `POLICY_ACTIVE`; policy issuing → `POLICY_ISSUING`; issuance failed → `ISSUANCE_FAILED`; open attempt →
`PAYMENT_PENDING`; latest attempt failed, cancelled or expired → `PAYMENT_FAILED` (the customer can try again while the
selection is payable). Otherwise batch 13's derivation applies. The function stays pure and computed in the response,
as batch 13 built it; no `QuoteRequestStatus` values are added.

### Refund (`payment_refunds.status`)

`PROPOSED → APPROVED → SUBMITTED → COMPLETED`, with `REJECTED` from `PROPOSED` (checker refuses), `EXPIRED` from
`PROPOSED` (approval expiry), and `FAILED` from `SUBMITTED` (provider refused; a new refund can be proposed).

### Reconciliation item (`reconciliation_items.status`)

`OPEN → IN_PROGRESS → RESOLVED`, with the outcome recorded on resolution. Kinds below.

### Settlement (`settlements.status`)

`DRAFT → PROPOSED → FINALISED`, with `REJECTED` back to `DRAFT`.

## Delivery order

Each package starts with failing tests for the rules it adds; one commit per package, Lore format. B14.1 to B14.7 are
API, B14.8 is web, B14.9 is verification and records.

### B14.1 Schema and migrations

As in batch 13, enum values go in their own migration file before anything uses them. Everything else is additive,
with backfills for existing rows. Backup before migrating.

1. **Enums.** `PaymentStatus` gains `INITIATED, CANCELLED, EXPIRED, REVERSED`. `PolicyStatus` gains `ISSUANCE_FAILED,
   CANCELLED`. `ApprovalAction` gains `PAYMENT_REFUND`,
   `MONEY_ADJUSTMENT`, `SETTLEMENT_FINALISE`. New enums: `RefundStatus`, `ReconciliationKind`,
   `ReconciliationStatus`, `ReconciliationOutcome`, `SettlementStatus`, `PaymentProviderName` (`STAND_IN` for now;
   real names are added with their adapters in batch 20).
2. **`payments`** gains: `provider`, `providerPaymentId` (unique per provider, nullable until `PENDING`),
   `checkoutUrl` (card only, short-lived, never logged), `payerMsisdnMasked`, `amountBreakdown` jsonb (lines below),
   `selectionId` → `quote_selections`, `initiatedAt`, `pendingUntil`, `failureCode`, `failureReason`, `reversedAt`,
   `reversalReference`, `lastStatusCheckAt`. Partial unique indexes: one `CONFIRMED` payment per `quoteRequestId`; one
   open (`INITIATED` or `PENDING`) payment per `quoteRequestId`. Existing rows: `provider = 'STAND_IN'`,
   `amountBreakdown` built from `amountMinor` and `rtsaAnniversaryFeeMinor`.
3. **Idempotency.** Payment initiation moves onto batch 3's shared mechanism (keyed by caller, endpoint and body
   hash). Keep `payments.idempotencyKey` for existing rows; new rows store the shared key's id. A missing header is
   refused with a clear error instead of a random key, so a retry can always be recognised (the web always sends one).
4. **`payment_callbacks`**: provider-scoped replay protection, separate from insurer callbacks: `provider`,
   `eventId`, `eventType`, `envelopeHash`, `paymentId` (nullable until matched), `receivedAt`, `processedAt`,
   `outcome`. Unique (`provider`, `eventId`).
5. **`payment_refunds`**: `id`, `paymentId`, `amountMinor` (≤ confirmed amount minus completed refunds, checked in
   the service and by a trigger or a locked read), `reason` (code and text), `status`, `approvalRequestId`,
   `providerRefundId` (unique per provider), `proposedByStaffId`, `submittedAt`, `completedAt`, `failureReason`,
   `reconciliationItemId`.
6. **`money_adjustments`**: corrections that are not a provider refund (for example a settlement correction after a
   reconciliation finding): `id`, `kind`, `insurerId`, `amountMinor` (signed), `reason`, `evidenceDocumentIds`,
   `before` and `after` jsonb snapshots, `approvalRequestId`, `settlementId` (the settlement it lands in),
   `createdAt`. Append-only.
7. **Reconciliation.** `provider_statement_imports` (`provider`, `periodStart`, `periodEnd`, `documentId` of the
   uploaded file, `importedByStaffId`, line count, checksum unique per provider), `provider_statement_lines`
   (`importId`, `providerPaymentId`, `providerRefundId`, `type` charge, refund or reversal, `amountMinor`,
   `occurredAt`, `raw` limited to the provider-neutral columns), `reconciliation_items` (`kind`, `status`,
   `outcome`, `paymentId`, `refundId`, `policyNumber`, `statementLineId`, `insurerId`, `amountMinor`,
   `ownerStaffId`, `reason`, `evidenceDocumentIds`, `resolutionNote`, `openedAt`, `resolvedAt`). A partial unique
   index allows one open item per (`kind`, `paymentId`) and per (`kind`, `statementLineId`).
8. **Settlement.** `settlements` (`insurerId`, `periodStart`, `periodEnd`, `status`, `grossPremiumMinor`,
   `feesMinor`, `refundsMinor`, `adjustmentsMinor`, `commissionMinor`, `netPayableMinor`, `ruleVersions` jsonb,
   `approvalRequestId`, `exportDocumentId`, `finalisedAt`), unique per (`insurerId`, `periodStart`, `periodEnd`) for
   non-rejected rows; `settlement_lines` (`settlementId`, `paymentId` or `refundId` or `adjustmentId`, `amountMinor`,
   `kind`). A finalised settlement and its lines are never updated.
9. **Selections.** `quote_selections` gains `selectedAddOnCodes text[]` (default empty). Choosing a quote accepts
   only codes of add-ons the quote offers and does not include; included add-ons need no choice.
10. **Policies.** `policies` gains `productVersionId` (from the quote; null for legacy), `issuanceDueAt`,
   `issuanceFailedAt`, `issuanceFailureReason`, `issuanceAcceptedAt`, `cancelledAt`. Backfill `productVersionId`
   from `insurer_quotes`.
11. **Settings** (batch 10 rule versions, provisional defaults, listed in the release gate): `PAYMENT_CHARGES`
    (approved fee and tax lines: code, label, basis `FIXED` or `PERCENT_OF_PREMIUM`, amount or basis points, cover
    types it applies to; default contains only the RTSA anniversary fee as today), `PAYMENT_PENDING_TIMEOUT`
    (`{ minutes }`, default 15), `ISSUANCE_DEADLINE` (`{ hours }`, default 48), `COMMISSION_RULE`
    (`{ basisPoints }`, default 0, provisional until DEC-008), `SETTLEMENT_PERIOD` (`{ kind: 'MONTHLY' }`).
    The RTSA anniversary fee moves from `RTSA_ANNIVERSARY_FEE_NGWEE` into `PAYMENT_CHARGES`; keep reading the
    environment variable as the fallback until the setting is confirmed, then remove it in batch 20.
12. Tests: enum migration before the table migration on a populated database; backfills; the two partial unique
    indexes on payments refuse a second open and a second confirmed payment; a refund larger than the remaining amount
    is refused; finalised settlements refuse updates.

### B14.2 The payment provider adapter and its stand-in

1. **Port** in `src/payments/provider/payment-provider.ts`, provider-neutral:
   - `initiate({ paymentId, amountMinor, currency, method, msisdn?, returnUrl, idempotencyKey, description })` returns
     `{ providerPaymentId, status: 'PENDING', checkoutUrl? }` or a typed refusal;
   - `status(providerPaymentId)` returns `PENDING | CONFIRMED | FAILED | CANCELLED` with amount and reference;
   - `refund({ providerPaymentId, refundId, amountMinor, idempotencyKey })` returns `{ providerRefundId, status }`;
   - `verifyCallback(rawBody, headers)` returns a typed event (`payment.confirmed`, `payment.failed`,
     `payment.cancelled`, `payment.reversed`, `refund.completed`, `refund.failed`) with `eventId`, amount and ids,
     or throws.
2. **Stand-in** (`PAYMENT_PROVIDER=stand-in`), registered with the provider registry as `stand-in`, so production
   refuses to start with it:
   - `initiate` returns `PENDING` with a fake provider id; card payments get a checkout URL to a stand-in page
     served by the API in development and test only.
   - Outcomes are driven by test wallet numbers and card tokens documented in the README (for example a wallet ending
     `0001` confirms, `0002` fails, `0003` stays pending until expiry, `0004` confirms then reverses), and by a
     development-only route `POST /dev/payment-provider/events` that emits a signed callback.
   - Its callbacks are signed with a test HMAC secret through the same `verifyCallback` path the real adapter will
     use, so the callback code is exercised for real.
3. **Outbound calls** go through the batch 11.1 endpoint safety helper (pinned DNS, no redirects, HTTPS only in live
   mode, timeout), with the provider's base URL from configuration, not from any database field.
4. **Secrets.** Provider credentials come from environment variables or the secret manager, named in `.env.example`
   with `CHANGE_ME`; never stored in the database. The callback signing secret supports two values at once
   (current and previous) for rotation.
5. Tests: the port's contract tests run against the stand-in; the production gate refuses `stand-in`; the outbound
   helper refuses a private base URL.

### B14.3 Paying: initiation, callbacks, status checks and expiry

1. **Initiation** `POST /payments` (body: `quoteRequestId`, `insurerQuoteId`, `amount` as shown, `method`,
   `mobileNumber` for mobile money). In one transaction:
   - every batch 12 and 13 check, unchanged: request owned, account open, quote belongs to the request, quote
     `ACTIVE` and not expired, not marked under decision 24, insurer takes new business, quote is the customer's
     current selection (batch 13 required this only for quotes with purchase-critical conditions; from now on every
     product-selection payment needs a selection, so the amount can include its add-ons), accepted conditions still
     match. No inspection check: inspections are optional and never decide a purchase;
   - no confirmed payment and no open attempt already exist for the request (an open attempt is returned as is when
     the idempotency key matches, otherwise refused with `PAYMENT_IN_PROGRESS` and its status);
   - compute the breakdown: premium, each selected add-on, each `PAYMENT_CHARGES` line that applies; no road tax
     (decision 21); refuse `AMOUNT_MISMATCH` when the client's amount differs, with the expected breakdown;
   - insert the payment `INITIATED` with the breakdown, `pendingUntil`, and the selection id; audit; commit.
   Then, outside the transaction, call `provider.initiate`. On success move to `PENDING` with the provider id (and
   checkout URL for cards). On a typed refusal move to `FAILED`. On a timeout or network error leave `INITIATED`; the
   status job resolves it. The response is the payment status, never a receipt.
2. **Quote validity while pending.** The price is fixed when the attempt starts. A quote that expires while its payment
   is pending is honoured when the confirmation arrives within `pendingUntil`; after that the attempt expires.
3. **Provider callbacks** `POST /payments/callbacks/:provider` (public, rate-limited, raw body kept for signature
   verification). Verify with the adapter, record in `payment_callbacks` (a replayed event returns the original
   outcome; the same event id with a different body is refused), then apply the event in one transaction with the
   payment row locked:
   - `payment.confirmed`: only from `INITIATED` or `PENDING`, and only when the amount and currency match the
     breakdown total. Then, still in the same transaction:
     - if the request already has a confirmed payment, or the quote is now marked unpayable under decision 24, or the
       insurer no longer takes new business, mark the payment `CONFIRMED`, create **no** policy, and open a
       `REFUND_REQUIRED` reconciliation item with the reason (rule 9);
     - otherwise mark `CONFIRMED`, move the chosen product to stay `QUOTED` (the quote expiry sweep never expires a
       paid quote), create the policy in `AWAITING_INSURER_CERTIFICATE` with `issuanceDueAt` from
       `ISSUANCE_DEADLINE`, redeem the NCD code (moved here from today's `pay`), set the request to
       `POLICY_ISSUING`, queue the `PAID_POLICY` delivery to the insurer (batch 11; the portal remains the standard
       path), notify the customer (`payment.confirmed`) and write the audit entries.
   - an amount mismatch on confirmation: mark `CONFIRMED` (money was taken), create no policy, open an
     `AMOUNT_MISMATCH` reconciliation item.
   - `payment.failed` and `payment.cancelled`: from `INITIATED` or `PENDING` to `FAILED` or `CANCELLED`; notify; the
     customer may try again.
   - `payment.reversed`: from `CONFIRMED` to `REVERSED`; open a `REVERSAL` reconciliation item; if a policy exists,
     it is not changed automatically (operations decide with the insurer).
   - an event for an unknown provider payment id: store it and open an `UNMATCHED_PROVIDER_EVENT` item.
   - an event that does not fit the current state (for example `failed` after `confirmed`): store it, change nothing,
     open a `STATE_CONFLICT` item.
4. **Customer cancel** `POST /payments/:id/cancel` while `INITIATED` or `PENDING`: asks the provider to cancel where
   it can; the attempt becomes `CANCELLED` only on the provider's answer or callback.
5. **Status job** on batch 6's runner, every minute: for `INITIATED` and `PENDING` attempts older than a short grace,
   call `provider.status` and apply the answer through the same code path as callbacks (a synthetic event id per
   payment and status, so a later real callback replays harmlessly). At `pendingUntil`, a final status check; if
   still not paid, `EXPIRED`.
6. **Decision 24.** At the moment an insurer is suspended (batch 7's action), its quotes are marked unpayable as
   today; open attempts for those quotes are cancelled at the provider where possible. Any confirmation that still
   arrives follows the `REFUND_REQUIRED` path above. The insurer deletion check keeps counting `INITIATED` and
   `PENDING` payments, and also counts confirmed payments with no policy and no completed refund.
7. Tests: initiation writes `INITIATED` before the provider call; a provider timeout leaves `INITIATED` and the status
   job resolves it; two concurrent initiations for one request give one attempt; the same key returns the same
   attempt; a different body with the same key is refused; a confirmed callback creates exactly one policy; a replayed
   confirmed callback creates nothing; a confirmed callback after a suspension creates a refund item and no policy; a
   confirmed callback with a wrong amount creates a mismatch item and no policy; a confirmation after a successful
   one on another attempt creates a refund item; `failed` after `confirmed` is a state conflict; expiry at
   `pendingUntil`; a forged or stale callback is refused before any state change; the browser cannot confirm a
   payment through any route.

### B14.4 Issuance by the insurer

1. **Accept or refuse issuance.** New insurer routes (permission `portal:policy:issue`, `ISSUING` roles):
   - `POST /insurer/policies/:policyNumber/accept` records `issuanceAcceptedAt` and the insurer's policy number
     (optional at this point);
   - `POST /insurer/policies/:policyNumber/certificate` (today's `issueCertificate`) uploads the certificate and moves
     the policy to `ACTIVE`; it now requires acceptance first, or accepts and issues in one call;
   - `POST /insurer/policies/:policyNumber/issuance-failure` with a reason code and customer wording moves the policy
     to `ISSUANCE_FAILED` and opens an `ISSUANCE_FAILED` reconciliation item, which leads to a refund proposal.
   All three refuse a policy not in `AWAITING_INSURER_CERTIFICATE` (and the certificate route refuses a second
   certificate, as today), are tenant-scoped and audited, and notify the customer.
2. **Insurer API path.** A `POLICY_ISSUED` signed insurer callback (batch 11 envelope) with the insurer policy
   number and a certificate the insurer uploads through the API's document route goes through the same service
   method as the portal route, so the rules are identical. Idempotent on the callback event id and on the policy
   (a second issue event for an active policy is accepted as a replay when identical, refused when different).
3. **Issuance deadline job**: policies still issuing after `issuanceDueAt` get an `ISSUANCE_OVERDUE` reconciliation
   item (owner: operations), an email to the insurer's admins, and a customer notice that issuance is delayed. The
   policy is not failed automatically; operations confirm the failure with the insurer.
4. **Policy documents** (FR-POL-001): the confirmation shows policy number, insurer policy number, insurer and
   product (from the quote's version), customer, vehicle, cover, dates, premium, status, the certificate and the
   product terms (the version's cover guide, and the quote's terms document from batch 13). Downloads use batch 5's
   short-lived links.
5. Tests: issue before payment confirmation is impossible (no policy exists); accept then issue; issue without accept
   follows the chosen rule; issuance failure opens an item and blocks a later certificate; another insurer's policy is
   404 and audited; the API callback and the portal give the same result; a duplicate issue event creates nothing;
   the overdue job opens one item per policy.

### B14.5 Refunds and money adjustments under two-person approval

1. **Proposing a refund** (`POST /admin/payments/:paymentId/refunds`, `ADMIN` or `SUPER_ADMIN`): amount, reason code
   and text, linked reconciliation item if any. Creates `payment_refunds` in `PROPOSED` and a `PAYMENT_REFUND`
   approval request with the frozen payload (payment id, amount, reason). The service refuses an amount above what is
   left to refund, and a payment that is not `CONFIRMED`.
2. **Approving** goes through batch 8's approvals (`POST /admin/approvals/:id/approve`); the checker must differ from
   the maker. Execution, inside the approving transaction, re-checks the remaining amount with the payment locked,
   moves the refund to `APPROVED`, and queues the provider refund as a `PAYMENT_GATEWAY` integration delivery with
   the refund id as its idempotency key. The delivery handler calls `provider.refund`; the refund becomes
   `SUBMITTED`, then `COMPLETED` or `FAILED` on the provider's callback or status check.
3. **After a completed refund**: when the payment is fully refunded and its policy is `ISSUANCE_FAILED`, the policy
   becomes `CANCELLED`; the reconciliation item resolves with outcome `REFUNDED`; the customer is notified
   (`payment.refunded`). A partially refunded payment keeps its policy.
4. **Money adjustments** (`POST /admin/money-adjustments`): a signed amount against an insurer's next settlement, with
   reason, evidence documents and before and after values, through a `MONEY_ADJUSTMENT` approval. Executed only on
   approval; append-only.
5. Two-person approval is not used for role grants (decision 15 excludes them) and not for the automatic creation of
   reconciliation items, which move no money.
6. Tests: the maker cannot approve; a second approval of the same request does nothing; two refunds that together
   exceed the payment are refused even when approved concurrently; the provider refund is sent once even if the job
   retries; a failed provider refund allows a new proposal; a completed full refund cancels an `ISSUANCE_FAILED`
   policy and not an `ACTIVE` one; an adjustment lands in the next draft settlement only after approval.

### B14.6 Reconciliation (US-ADM-009, FR-ADM-011, NFR-REL-003)

1. **Kinds of item**: `REFUND_REQUIRED`, `AMOUNT_MISMATCH`, `REVERSAL`, `UNMATCHED_PROVIDER_EVENT`, `STATE_CONFLICT`,
   `ISSUANCE_FAILED`, `ISSUANCE_OVERDUE`, `PENDING_TOO_LONG` (an attempt still `INITIATED` after the status job gave
   up), `STATEMENT_UNMATCHED` (a provider statement line with no InsurShield record), `MISSING_FROM_STATEMENT` (a
   confirmed InsurShield payment absent from a statement covering its date), `DUPLICATE` (two statement lines or two
   confirmations for one payment).
2. **Statement import** `POST /admin/reconciliation/statements` (upload a CSV in the provider-neutral format
   documented in `docs/PAYMENTS.md`; the stand-in can produce one for a period). The file goes through batch 5's
   scanning and retention. Import is idempotent on the file checksum. Matching: by provider payment id and refund id,
   then amount and currency; each line ends `MATCHED`, or opens an item. After the import, confirmed payments in the
   period with no line open `MISSING_FROM_STATEMENT`.
3. **Queue** `GET /admin/reconciliation/items` with filters (kind, status, owner, insurer, age, amount) and cursor
   paging; each item shows amount, references, age, reason, owner, evidence, linked payment, refund and policy, and
   the actions allowed for its kind. Actions: assign, add evidence, resolve with outcome and note, propose a refund
   (B14.5) or an adjustment. Resolving never moves money by itself.
4. **InsurShield finance access.** There is no InsurShield finance role yet. Reconciliation is `ADMIN` and
   `SUPER_ADMIN` in this batch (open question 5 asks whether to add one).
5. Tests: each kind is produced by its trigger exactly once; re-importing the same file changes nothing; a partly
   overlapping statement matches only the new lines; resolution requires an outcome and a note; filters and paging;
   only InsurShield admins can reach any of it.

### B14.7 Settlement (FR-IP-013 read-only, US-ADM-009 last criterion)

1. **Draft** `POST /admin/settlements` for an insurer and period (from `SETTLEMENT_PERIOD`): includes every payment
   confirmed in the period for that insurer's quotes that has an `ACTIVE` policy or is still issuing, every refund
   completed in the period, every approved adjustment not yet settled; computes gross premium, fees (the
   `PAYMENT_CHARGES` lines that are InsurShield's or a third party's, per open question 2), refunds, adjustments,
   commission from `COMMISSION_RULE`, and net payable; records the rule versions used. Re-drafting replaces a `DRAFT`.
2. **Finalise** through a `SETTLEMENT_FINALISE` approval. Finalising freezes the settlement and its lines, marks the
   included records as settled so no later settlement takes them again, and produces a CSV export as a stored
   document. A finalised settlement can only be corrected by an adjustment in a later one.
3. **Insurer view** `GET /insurer/settlements` (new permission `portal:settlement:read` for `INSURER_ADMIN` and
   `FINANCE`): finalised settlements for that insurer only, with lines and the export.
4. Tests: a payment is settled once only; a refund in a later period reduces that period; the commission uses the rule
   version in force for the period; the export reproduces the totals; another insurer's settlement is invisible.

### B14.8 Web

WCAG 2.2 AA for every new or changed screen. Status changes are announced; nothing relies on colour alone.

1. **Customer payment** (`PaymentPage.jsx`): the itemised breakdown from the server (premium, each add-on, each fee
   line, total) before authorisation; method choice; for mobile money, the wallet number and clear "approve the
   prompt on your phone" waiting state that polls the payment status (with a timeout message at `pendingUntil`);
   for cards, a redirect to the provider's checkout and a return page that shows the status from the server, never
   from the URL; a failed, cancelled or expired attempt offers "try again" while the quote is payable, or the requote
   path when it is not. An `Idempotency-Key` per attempt, kept across retries of the same attempt.
2. **Confirmation and policy** (`PolicyConfirmationPage.jsx`, account pages): payment received; policy issuing with
   the expected time; issued with certificate and terms; issuance delayed; issuance failed with the refund status. The
   refund state is shown on the policy and in the notification centre.
3. **Insurer portal**: paid policies list with issuing, overdue and failed filters; accept, upload certificate and
   report failure actions; settlements tab for admins and finance.
4. **Admin console**: reconciliation queue and item detail; statement upload; refund proposal and the approval inbox
   entries for refunds, adjustments and settlements (batch 8's inbox); settlements list, draft, finalise.
5. **Mock adapter**: the same contracts, with the stand-in's test wallets, so the mock Playwright lane can run
   pending, confirmed, failed and expired paths.
6. Tests: component tests for the breakdown, the waiting state and every payment and policy state; Playwright on both
   lanes: mobile money confirmed to issued; card return page; failed then retried; expired; a suspension while
   pending ending in a refund proposal visible to the admin; an insurer reporting issuance failure; the two-person
   refund approval.

### B14.9 Verification and records

1. `npm run lint`, `npm run test`, `npm run build`, API `tsc --noEmit`, API e2e, web Playwright mock and HTTP lanes,
   with numbers. Infrastructure-only failures reported separately.
2. Two reviews and the security hunt per package; findings fixed before the commits are approved. The security hunt
   covers at least: callback forgery and replay, amount tampering, concurrent initiation, double refund, IDOR on
   payments, refunds, policies, items and settlements, and leakage of wallet numbers or checkout URLs into logs.
3. New `docs/PAYMENTS.md`: the state models, the provider port, the stand-in's test wallets and events, the statement
   CSV format, and the runbook for each reconciliation kind. Update `contracts.js`, `INSURER_API_INTEGRATION.md`
   (`PAID_POLICY` and `POLICY_ISSUED`, the issuance failure event), the README settings table and the roadmap status.
4. Record DEC-019 as applied and list the provisional settings this batch adds for the batch 20 release gate.

## Security and privacy

- Card data never touches InsurShield; checkout is the provider's page. Mobile-money numbers are masked to the last
  three digits outside the provider call, and never written to logs or audit entries.
- Callbacks are verified on the raw body before parsing their business content, with timestamp and replay checks,
  and a provider-scoped event table.
- All money is integer ngwee; every total is recomputed on the server; amounts in callbacks are compared, never
  trusted.
- Every money-moving action (refund, adjustment, settlement) needs two administrators; every money-related record is
  append-only or state-guarded, and audited in the same transaction.
- Customers see only their own payments and policies; insurers only their own policies and settlements; reconciliation
  is InsurShield-only.

## Explicit boundaries

- No real provider adapter: that is batch 20, after DEC-008 names the providers and supplies sandbox credentials.
- No road tax (decision 21).
- Renewal payments use the same flow but the renewal journey is batch 15. Policy cancellation after issuance and
  pro-rata refunds are policy service requests (batch 15).
- No InsurShield finance role unless open question 5 says otherwise.
- Claims and NCD money are out of scope (settlement of claims stays in the insurer's system, decision 3).

## Open questions for the user (DEC-008 and finance)

Each has a provisional default so the batch proceeds; each is a setting or a small rule, changeable without a
migration.

1. **Providers and methods.** Which mobile-money providers and which card acquirer at launch? Default: build the port
   and the stand-in only; methods stay `MOBILE_MONEY` and `CARD`.
2. **Fees and taxes on the payable amount.** Which approved levies, taxes and fees are added to the premium, and who
   receives each (insurer, InsurShield, a regulator)? Default: only the RTSA anniversary fee, as today, held in
   `PAYMENT_CHARGES`.
3. **Commercial model.** Does InsurShield collect the premium and settle net of commission to the insurer, or does the
   provider split at source? What is the commission and the settlement period? Default: InsurShield collects, monthly
   settlement, commission 0 bps provisional.
4. **Pending window and issuance deadline.** Default: 15 minutes for a pending payment, 48 hours for issuance.
5. **Finance role.** Should InsurShield have its own finance role for reconciliation and settlements, separate from
   `ADMIN`? Default: no; admins only, with two-person approval on every money movement.
6. **Refund on issuance failure.** Always a full refund, or can an admin propose a partial one (for example to keep a
   fee)? Default: full refund proposed automatically as a draft for the maker to submit; partial allowed with a
   reason.

## Delivery in parts

As batch 13 did, this batch is delivered in parts on one branch, `feat/batch-14-payments`, with one PR at the end:

- **Part 1** (delivered): B14.1 (schema), B14.2 (provider port and stand-in) and B14.3 (initiation, callbacks,
  status job and expiry), with the web payment page's waiting and result states. Where it differs from the plan:
  - Migration 0038 holds the schema part 1 needs: the payment statuses and columns, the two partial unique indexes,
    `payment_callbacks`, `reconciliation_items`, the policy issuance columns, `selectedAddOnCodes`, and the
    `PAYMENT_CHARGES`, `PAYMENT_PENDING_TIMEOUT` and `ISSUANCE_DEADLINE` settings. Refunds, money adjustments,
    statements, settlements, `COMMISSION_RULE`, `SETTLEMENT_PERIOD` and the new approval actions come with part 3.
  - `PaymentStatus` is rebuilt as a new type rather than extended, because the migrator runs every migration in one
    transaction and the index predicates use the new values.
  - Payments recorded before this batch that were still `PENDING` had never reached a provider, so 0038 marks them
    `EXPIRED` (`NEVER_SENT`).
  - Idempotency stays on `payments.idempotencyKey`, now required. The same key answers with its attempt, also when
    two requests with one key arrive together, and a key reused for another payment is refused.
  - The stand-in makes no outbound calls, so the endpoint safety helper is first used by the live adapter in batch 20.
  - The web shows the server's breakdown once an attempt starts, or when the server refuses the amount. Before that,
    the page adds the premium, the chosen add-ons and the RTSA fee it knows. The customer chooses optional add-ons on
    the compare page.
  - `docs/PAYMENTS.md` is started with the part 1 flow, the stand-in wallets and the settings.
- **Part 2**: B14.4 (issuance accept, certificate and failure, the overdue job) with its portal and customer screens.
- **Part 3**: B14.5 to B14.7 (refunds and adjustments under two-person approval, reconciliation, settlement) with the
  admin console screens.

Until part 3 lands, every case that needs a refund opens its reconciliation item so nothing is lost, and the branch
stays unmerged.

## Size and split

XL. If it splits, split after B14.4: the provider flow, callbacks, status checks and issuance (B14.1 to B14.4 and
their web parts) first, then refunds, reconciliation and settlement (B14.5 to B14.7). The first half must still never
leave money unaccounted for: until B14.5 lands, every `REFUND_REQUIRED`, `AMOUNT_MISMATCH` and `ISSUANCE_FAILED` case
opens its reconciliation item and is visible to admins, and the release of the first half stays in development only.
