# Payments

How InsurShield takes a payment for an accepted quote. Batch 14 builds this in parts; this page covers what part 1
delivered and grows with the later parts (issuance, refunds, reconciliation and settlement).

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
`POST /api/v1/dev/payment-provider/events` with `providerPaymentId` and `type` makes the stand-in send a signed
callback through the real callback route. Every `dev` route answers as absent in production.

Callbacks are signed with HMAC SHA-256 over the timestamp and the raw body, and refused when older than five minutes.
`PAYMENT_CALLBACK_SECRET` signs and verifies; `PAYMENT_CALLBACK_SECRET_PREVIOUS` is still accepted during a rotation.
Left unset outside production, the stand-in makes up a secret at each start.

## Settings

| Setting | Default | Use |
| --- | --- | --- |
| `PAYMENT_CHARGES` | the RTSA anniversary fee only | Approved charges added to the premium. Until a version is approved, the fee keeps the amount in `RTSA_ANNIVERSARY_FEE_NGWEE`. |
| `PAYMENT_PENDING_TIMEOUT` | 15 minutes | How long an attempt may stay open, and how long the price is held. |
| `ISSUANCE_DEADLINE` | 48 hours | When a paid policy is due from the insurer. Used from batch 14 part 2. |

All three are provisional until DEC-008 and the finance questions in the batch 14 plan are answered.
