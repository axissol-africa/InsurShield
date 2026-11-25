# Payments

How InsurShield takes a payment for an accepted quote, and how the insurer then issues the policy. Batch 14 builds
this in parts; this page covers all of them.

## The rules

- The server works out the amount from the chosen quote, the optional add-ons the customer chose and the approved
  charges. The amount the browser sends is only compared with it.
- Starting a payment never confirms it. Only a verified provider callback or a provider status answer does.
- A request has at most one open attempt and at most one confirmed payment. The database enforces both.
- A confirmed payment creates the policy in "Policy issuing". Only the insurer's certificate makes it active.
- Money taken that cannot become a policy opens a reconciliation item, so nothing is lost before refunds arrive.
- Card details never reach InsurShield. Wallet numbers are kept only masked to their last three digits.

## A payment's states

| Status | Meaning |
| --- | --- |
| `INITIATED` | Written before the provider is asked, so a crash in between is recovered by the status job. |
| `PENDING` | The provider accepted the instruction: the wallet prompt was sent, or the card checkout was created. |
| `CONFIRMED` | The provider says the money was taken. |
| `FAILED` | Declined or refused by the provider. The customer can try again. |
| `CANCELLED` | Stopped before any money was taken, by the customer or because the insurer was suspended. |
| `EXPIRED` | No outcome by `pendingUntil`, and the provider's last answer was still not paid. |
| `REVERSED` | Money taken and later returned by the provider outside InsurShield, such as a chargeback. |

Payments recorded before batch 14 that were still `PENDING` were never sent to a provider, so migration 0038 marks
them `EXPIRED` with the failure code `NEVER_SENT`.

## The flow

1. `POST /api/v1/payments` with `quoteRequestId`, `insurerQuoteId`, `amount`, `method` and, for mobile money,
   `mobileNumber`. A card payment may send `returnUrl`, which must be on one of InsurShield's own origins. The
   `Idempotency-Key` header is required: the same key answers with the attempt it started, and a key used for a
   different payment is refused.
2. The checks: the request is the customer's, the account is open, the insurer still takes new business, the quote is
   active, payable and not expired, a product-selection quote has been chosen with its required conditions accepted,
   and there is no other open or confirmed payment for the request. A wrong amount is refused with
   `AMOUNT_MISMATCH` and the expected breakdown.
3. The attempt is written `INITIATED`, then the provider is called outside the transaction. It moves to `PENDING`
   with the provider's id, or `FAILED` on a refusal. When the provider does not answer it stays `INITIATED`.
4. The answer is the attempt's status, never a receipt. The customer's page polls `GET /api/v1/payments/:id`, which
   asks the provider at most every few seconds while the attempt is open. `POST /api/v1/payments/:id/cancel` asks the
   provider to stop it.
5. The provider's callback, `POST /api/v1/payments/callbacks/:provider`, is verified on the raw body, stored once per
   event id, and applied with the payment locked. A replay answers with the first outcome; the same event id with
   other content is refused.
6. The status job runs every minute on the job runner. It asks the provider about every attempt still open after a
   short grace and applies the answer the same way a callback is applied. At `pendingUntil` it makes the last check
   and expires the attempt if it is still not paid.

A quote that expires while its payment is pending is honoured when the confirmation arrives before `pendingUntil`.

## What a confirmation does

| Situation | Result | Reconciliation item |
| --- | --- | --- |
| Normal | `CONFIRMED`, policy created in "Policy issuing", NCD code redeemed, customer told | none |
| Amount differs from the breakdown | `CONFIRMED`, no policy | `AMOUNT_MISMATCH` |
| Request already paid, quote unpayable after a suspension, or insurer no longer trading | `CONFIRMED`, no policy, customer told a refund is coming | `REFUND_REQUIRED` |
| Reversal of a confirmed payment | `REVERSED`, policy left for operations | `REVERSAL` |
| Event for a payment nobody knows | stored only | `UNMATCHED_PROVIDER_EVENT` |
| Event that does not fit the state, such as a failure after a confirmation | nothing changes | `STATE_CONFLICT` |

When an insurer is suspended, its open attempts are queued for cancellation at the provider. Any confirmation that
still arrives follows the `REFUND_REQUIRED` row above.

## Issuing the policy

A confirmed payment creates the policy in "Policy issuing" (`AWAITING_INSURER_CERTIFICATE`), due by
`issuanceDueAt`, which is the confirmation time plus `ISSUANCE_DEADLINE`. From the insurer portal, or the same routes
under `/api/v1/insurer/policies/:policyNumber`:

| Route | Effect |
| --- | --- |
| `POST .../accept` | Records that the insurer has taken it on, with its own policy number if it has one. A repeat answers what was recorded. The customer is told. |
| `POST .../certificate` | Uploads the certificate and makes the policy `ACTIVE`. Without an earlier acceptance, it accepts at the same moment. |
| `POST .../issuance-failure` | `reasonCode` and `customerMessage` (at least 10 characters, shown to the customer as written). The policy becomes `ISSUANCE_FAILED`, an `ISSUANCE_FAILED` reconciliation item opens for the refund, and the customer is told. |

All three refuse a policy that is no longer waiting to be issued: an active one with `ALREADY_ISSUED`, a failed one
with `ISSUANCE_CLOSED`. Another insurer's policy answers as absent, and the attempt is audited.

Reason codes: `RISK_NOT_ACCEPTED`, `VEHICLE_DETAILS_WRONG`, `DOCUMENTS_MISSING`, `DUPLICATE_COVER`, `OTHER`.

The issuance check runs every hour. A policy still issuing after `issuanceDueAt` gets one `ISSUANCE_OVERDUE`
reconciliation item, a notice to the customer that it is delayed, and an email to each of the insurer's
administrators. The policy is not failed automatically: operations confirm a failure with the insurer. When the late
policy is issued, its overdue item is resolved as `ISSUED`.

Both the portal and the customer's policy show `issuance`: `dueAt`, `acceptedAt`, `overdue`, `failedAt` and
`failureReason`. The customer's policy also shows the product bought, from the quoted version.

## Refunds

Only an InsurShield administrator can propose a refund, and a different one must approve it (decision 15). No money
moves until then.

1. `POST /api/v1/admin/payments/:transactionId/refunds` with `amount` (kwacha), `reasonCode`, `reason` (at least 10
   characters, the approver reads it) and, optionally, the `reconciliationItemId` it settles. The payment must be
   `CONFIRMED`, and the amount at most what is left after completed refunds. The refund is `PROPOSED` and a
   `PAYMENT_REFUND` request appears in the approvals inbox with the payment, the amounts and the reason.
2. The second administrator approves it at `POST /api/v1/admin/approvals/:id/approve`. With the payment locked, the
   amount is checked again, the refund becomes `APPROVED` and a job sends it to the provider with the refund id as the
   idempotency key, so a retried job cannot pay out twice. Rejecting the request makes the refund `REJECTED`.
3. The provider accepts it (`SUBMITTED`), then completes it (`COMPLETED`) or refuses it (`FAILED`) by callback. The
   status job asks about any refund still submitted after its grace, and resends an approved one whose job was lost.
4. When the payment has been refunded in full, a policy that was never issued becomes `CANCELLED`, and the items
   waiting for the money (`REFUND_REQUIRED`, `ISSUANCE_FAILED`, `AMOUNT_MISMATCH`, `DUPLICATE`) resolve as
   `REFUNDED`. A partial refund resolves only the item it was proposed for and leaves the policy alone. The customer
   is told each time (`payment.refunded`).

A payment has at most one refund in progress (`PROPOSED`, `APPROVED` or `SUBMITTED`), enforced by the database, so two
refunds can never together pass what was paid. A refund that is rejected, fails, or whose approval expires stops
blocking a new proposal.

Reason codes: `ISSUANCE_FAILED`, `INSURER_UNAVAILABLE`, `DUPLICATE_PAYMENT`, `AMOUNT_MISMATCH`, `CUSTOMER_REQUEST`,
`OTHER`.

A payment taken before batch 14 never went through a provider, so it has nothing to refund against: proposing a refund
for one is refused with `REFUND_NOT_POSSIBLE`. Refund it outside InsurShield, then resolve its item as `REFUNDED`.
The queue marks such payments with `refundable: false`.

### Cancelling cover the customer no longer needs

A customer asks to cancel through a service request (`CANCELLATION`), naming the day they want the cover to end. The
insurer approves it with the refund it owes (zero or more, worked out by the insurer, at most what is left of the
payment after completed refunds) and the day the cover ends. On or after that day the insurer completes it: the policy
becomes `CANCELLED` and, when the refund is above zero, a `REFUND_REQUIRED` item opens for that amount. The refund is
then proposed and approved by two administrators as above; the service request never moves money itself.

A policy cancelled this way after it was issued stays in settlements: its premium is the insurer's, and the refund on
it comes off the insurer's settlement.

## The reconciliation queue

`GET /api/v1/admin/reconciliation/items` lists items oldest first, filtered by `status`, `kind`, `insurerId` and
`owner` (`me` for your own), 50 to a page with a `next` cursor. Each item shows its amount, reason, age, owner,
insurer, policy, the payment with what has been refunded, and its refunds.

- `POST .../items/:id/assign` with `staffId` (an active InsurShield administrator, or null) takes or releases it.
- `POST .../items/:id/resolve` with an `outcome` (`REFUNDED`, `ISSUED`, `ADJUSTED`, `NO_ACTION`, `WRITTEN_OFF`) and a
  `note` of at least 10 characters. `REFUNDED` needs a completed refund. Resolving never moves money.

All of it is for InsurShield administrators only (`reconciliation:read`, `reconciliation:manage`, `refund:propose`).

## Provider statements

`POST /api/v1/admin/reconciliation/statements` with `fileName`, `periodStart`, `periodEnd` and `csv`, the statement in
this provider-neutral format (amounts in kwacha, to the ngwee):

```
type,provider_payment_id,provider_refund_id,amount,currency,occurred_at
CHARGE,SI-C-123456-...,,1234.56,ZMW,2026-10-02T08:00:00.000Z
REFUND,SI-C-123456-...,SIRF-...,1234.56,ZMW,2026-10-05T09:30:00.000Z
REVERSAL,SI-C-123456-...,,1234.56,ZMW,2026-10-07T10:00:00.000Z
```

The whole file is read first: one bad line refuses it, naming every bad line, and nothing is stored. The same file
twice is the same import (by checksum), and each line is stored once whichever file it came in, so an overlapping
statement adds only its new lines. Each new line:

| Line | Result |
| --- | --- |
| Agrees with a confirmed payment, completed refund or reversed payment | `MATCHED` |
| No payment or refund InsurShield knows | `STATEMENT_UNMATCHED` item |
| Amount, currency or state differs | `STATEMENT_UNMATCHED` item (a reversal of a payment we still hold: `REVERSAL`) |
| A second charge for a payment already charged | `DUPLICATE` item |

Then every payment confirmed in the period that no statement line accounts for opens a `MISSING_FROM_STATEMENT`
item (payments from before batch 14 never reached a provider and are left out), which resolves itself as `NO_ACTION` when a later statement has the payment. Nothing here changes a payment or
moves money. In development, `GET /api/v1/admin/reconciliation/stand-in-statement?from=&to=` gives the statement the
stand-in would send, built from InsurShield's own records.

## Money adjustments

`POST /api/v1/admin/money-adjustments` with `insurerId`, a signed `amount` (positive pays the insurer more, negative
takes money back), a `kind` (`SETTLEMENT_CORRECTION`, `REVERSAL_RECOVERY`, `FEE_CORRECTION`, `OTHER`), a `reason` and,
optionally, the `reconciliationItemId` it settles. Nothing is written but a `MONEY_ADJUSTMENT` approval request. Once
a different administrator approves it, the adjustment is written, append-only (a database trigger refuses any edit
or delete, except recording once the settlement that took it), and its item resolves as `ADJUSTED`.

## Settlement

What InsurShield owes one insurer for one Lusaka calendar month (`SETTLEMENT_PERIOD`), drawn up only once the month
has ended:

- **Payments**: every confirmed payment for that insurer's quotes, confirmed before the month ended and not settled
  yet, whose policy is active, still being issued, or was issued and later cancelled on the customer's request. Earlier ones a previous settlement missed are picked up. Its
  premium and add-ons are the insurer's; its charges (the `CHARGE` lines, such as the RTSA fee) are shown apart.
- **Refunds**: completed refunds on cover that stood (live, or issued and later cancelled) come off. A refund for a policy that was never issued is
  not deducted, because that payment was never paid to the insurer.
- **Adjustments**: every approved adjustment not settled yet.
- **Commission**: `COMMISSION_RULE` basis points of the gross premium, rounded half up to the ngwee, from the rule
  version in force when the month began (recorded on the settlement).
- **Net payable** = gross premium - refunds + adjustments - commission.

| Route | Effect |
| --- | --- |
| `POST /api/v1/admin/settlements` | `insurerId` and `period` (`YYYY-MM`): draws up a `DRAFT`, replacing an earlier draft. |
| `POST /api/v1/admin/settlements/:id/finalise` | With a `reason`: a `SETTLEMENT_FINALISE` approval request; the settlement is `PROPOSED`. |
| `GET /api/v1/admin/settlements`, `.../:id`, `.../:id/export` | The list, one with its lines, and its CSV. |
| `GET /api/v1/insurer/settlements`, `.../:id`, `.../:id/export` | The insurer's own finalised settlements (`INSURER_ADMIN` and `FINANCE`). |

When a different administrator approves, every payment, refund and adjustment in it is marked with the settlement, so
no later settlement takes it again; if one was taken meanwhile, the approval is refused with `SETTLEMENT_STALE` and
the month is drawn up again. A rejected request turns it back into a draft. A finalised settlement and its lines never
change (database triggers); a later correction is an adjustment in a later month.

The CSV has the reference, insurer and month, one row per line (kind, reference, date, amount, fees), then the totals.

## The provider port and the stand-in

The port is `src/payments/provider/payment-provider.ts`: `initiate`, `status`, `cancel`, `refund` and
`verifyCallback`. Only the stand-in exists until DEC-008 names the real providers (batch 20). Production refuses to
start with it, through the provider gate.

The stand-in decides by the last four digits of the wallet:

| Wallet ends | Outcome |
| --- | --- |
| `0001`, or any other ending | confirms |
| `0002` | is declined |
| `0003` | stays pending until it expires |
| `0004` | confirms, and can then be reversed |

A card payment is sent to the stand-in's checkout page at `/api/v1/dev/payment-provider/checkout/:id`, where the
tester confirms or declines it and is sent back to `returnUrl`. In development and test,
`POST /api/v1/dev/payment-provider/events` with `providerPaymentId` and `type` (and `providerRefundId` for a refund
event) makes the stand-in send a signed callback through the real callback route. Its refunds are accepted at once and
complete when asked about, or when a `refund.completed` event is sent. Every `dev` route answers as absent in production.

Callbacks are signed with HMAC SHA-256 over the timestamp and the raw body, and refused when older than five minutes.
`PAYMENT_CALLBACK_SECRET` signs and verifies; `PAYMENT_CALLBACK_SECRET_PREVIOUS` is still accepted during a rotation.
Left unset outside production, the stand-in makes up a secret at each start.

## Settings

| Setting | Default | Use |
| --- | --- | --- |
| `PAYMENT_CHARGES` | the RTSA anniversary fee only | Approved charges added to the premium. Until a version is approved, the fee keeps the amount in `RTSA_ANNIVERSARY_FEE_NGWEE`. |
| `PAYMENT_PENDING_TIMEOUT` | 15 minutes | How long an attempt may stay open, and how long the price is held. |
| `ISSUANCE_DEADLINE` | 12 hours | When a paid policy is due from the insurer. |
| `COMMISSION_RULE` | 0 basis points | InsurShield's commission on gross premium in a settlement. |
| `SETTLEMENT_PERIOD` | monthly | The period a settlement covers. Only monthly for now. |

All of these are provisional until DEC-008 and the finance questions in the batch 14 plan are answered.
