# Insurer system integration

## Goal

InsurShield sends one standard motor-insurance request to each active insurer. Each insurer continues underwriting, pricing, policy issue and claim handling in its own system.

## Onboarding

1. An InsurShield super-admin creates the insurer profile and supplies the insurer's API base URL, public signing key, claims callback URL and supported products.
2. The insurer receives a client ID and a securely stored client secret or mutual-TLS certificate. These never reach the browser.
3. The integration is tested in a sandbox using representative quote, document and claim payloads before the insurer is activated.

## Quote flow

1. `POST /v1/quote-requests` is sent to every **Active** insurer with the customer consent record, customer contact details, vehicle details, RTSA alignment, cover period, inspection-photo URLs and a unique `requestId`.
2. The insurer returns `202 Accepted` immediately and processes the request in its existing rating system.
3. The insurer posts one final response to `POST /v1/insurer-quotes` (or InsurShield polls the insurer) containing `requestId`, insurer reference, final premium, currency, validity date, terms, policy requirements and a signed document URL/PDF.
4. InsurShield validates the insurer identity, deduplicates by `requestId + insurerReference`, stores the response and presents that exact premium and document to the customer.

## Claim flow

1. InsurShield records the customer claim notification and creates `claimNumber`.
2. `POST /v1/claim-notifications` delivers the complete form, attachments, customer/vehicle data and `claimNumber` to the selected insurer.
3. The insurer acknowledges with its own claim reference and status. InsurShield shows both references to the customer and lets the insurer mark it received.

## Paid policy delivery flow

1. An insurer sends its final quote against a unique `requestId`, for example `QR-1789112933616`.
2. When the customer pays for that exact quote, InsurShield verifies the payment server-side and creates one **paid-policy awaiting insurer issue** record. Payment alone must never create an official certificate.
3. InsurShield sends `POST /v1/policies/paid` to the insurer's configured policy callback. The payload includes `requestId`, the insurer's original quote reference, paid premium, customer and vehicle details, cover dates, RTSA fee where applicable, and secure quote-document URLs.
4. The insurer reviews the paid request in its own policy system, creates its official certificate, then posts `POST /v1/policies/issued` with `requestId`, insurer policy number, certificate URL and issue timestamp.
5. InsurShield validates the insurer response, marks the policy active, and makes that same certificate available to the customer. Idempotency uses `requestId + insurerPolicyNumber`, so retries cannot issue duplicate policies.
6. The insurer portal retains the original `QR-...` reference under **Paid policies**, so its team can reconcile the paid policy with the quote sent from its own system.

In the prototype, steps 3–5 happen inside the insurer portal: the paid quote appears under **Paid policies** and the insurer uploads the certificate there, which activates the policy in the shared local store. In production this must happen only from the backend after a verified payment callback and a signed insurer response; it must never be triggered by browser code.

## Renewals and service requests

Both are portal-only for now; nothing is sent to an insurer's own system.

- A **renewal** is a new quote request like any other. The portal shows "Renewal of POL-…" with the previous insurer
  and end date, and the insurer quotes, asks, inspects or declines it with the usual actions.
- A **service request** is a customer asking about a policy the insurer issued: a correction, a replacement document,
  a cancellation or help. The insurer's administrators, support staff and legacy insurer users work them under
  **Service requests** in the portal; every insurer role that reads policies can read them. A new request is also
  emailed to the insurer's staff who can work it.

## Versioned product terms and cover guides

Each insurer manages its own customer-facing product terms before it receives a quote request. This is the product
catalogue foundation for the later multi-product quote flow; it does not change the current legacy quote-delivery
contract yet.

1. An authorised insurer administrator creates a product draft at `POST /api/v1/insurer/products`. A draft includes a
   stable product code, a customer-facing name, `COMPREHENSIVE` or `THIRD_PARTY` cover type, structured cover-guide
   terms, inspection rule, effective dates and the first version number.
2. The administrator can update only that draft with `PATCH /api/v1/insurer/products/:productId/versions/:versionId`.
   To correct a submitted, rejected, approved or withdrawn version, they use `POST .../revise`, which creates the
   next draft version and preserves the earlier terms.
3. `POST .../submit` sends a complete draft to the InsurShield review queue. Submission is refused unless the insurer
   is active, licensed and has verified onboarding evidence.
4. Platform administrators list `GET /api/v1/admin/products?status=SUBMITTED` and approve, return or withdraw a
   version through the matching `approve`, `reject` and `withdraw` actions. Every decision is audited with the actor,
   time and comment or reason.
5. Customers and future quote-selection screens read only `GET /api/v1/products/directory`. It returns approved,
   currently effective terms from insurers that may accept new business; it never exposes insurer evidence, reviewer
   comments or internal workflow data.

The inspection method and timing belong to the product version, rather than the insurer profile. A version that does
not require an inspection has neither an inspection method nor timing. A later quote request will store the exact
product-version identifier it was made from, so changing terms cannot rewrite what a customer previously saw.

## Signing and delivery rules

These are the exact byte formats an insurer has to reproduce. "Canonical JSON" means JSON with object keys sorted by
Unicode code unit (plain `<` comparison, not a locale sort), no whitespace, and `undefined` members left out. The
reference implementation is `apps/api/src/common/json/canonical-json.ts`.

### Requests InsurShield sends to the insurer

- Sent as `POST` to the insurer's API base URL plus a fixed path per delivery kind: `/quote-requests`,
  `/paid-policies`, `/claim-notifications`, `/vehicle-lookups`, `/payment-confirmations` or `/policies`. Any other
  target is refused before sending.
- Headers: `content-type: application/json`, `idempotency-key`, `x-insurshield-client-id`,
  `x-insurshield-timestamp` (Unix seconds), `x-insurshield-signature`, and `x-correlation-id` when there is one.
- Signature: HMAC-SHA256 with the insurer's client secret over `<timestamp>.<canonical JSON body>`, encoded as
  base64url without padding.
- The body sent is the canonical JSON itself, so the insurer can verify the raw bytes it received.
- A retry of the same delivery carries the same `idempotency-key`. Treat a repeated key as the same request.
- InsurShield does not follow redirects. A `3xx` answer is a failed delivery that needs an operator. Only `2xx`
  counts as delivered; `408`, `429` and `5xx` are retried with backoff, other `4xx` answers are not.
- A live (non-sandbox) integration must use HTTPS. A base or callback URL that names a loopback, private,
  link-local or other non-public address, or `localhost` or a `.local` name, is refused when the integration is
  saved. On every send the host name is resolved again, and the request is refused if any answer is not public.

### Callbacks the insurer sends to InsurShield

- `POST /api/v1/integrations/callbacks/insurers/:insurerId` with a JSON object body.
- Headers: `x-insurshield-event-id` (unique per event, at most 200 characters), `x-insurshield-event-type` (at most
  120 characters), `x-insurshield-timestamp` (Unix seconds, within 5 minutes of InsurShield's clock),
  `x-insurshield-signature`, and optionally `x-correlation-id`.
- Signature: made with the insurer's private key matching the public signing key on record, SHA-256 with RSA or
  ECDSA (Ed25519 keys are not supported yet), base64url encoded, over the canonical JSON of
  `{ "body": <body>, "eventId": "<event id>", "eventType": "<event type>", "timestamp": "<timestamp>" }`.
  The event id and type are inside the signed message, so they cannot be changed or reused under another id.
- Sending the same event id again with the same content is accepted as a replay and changes nothing. The same event
  id with different content is refused with `409`.
- Callbacks for an insurer that has been deleted are refused.

## Required safeguards

Renewals use the existing quote process. The prior policy reference is shown in the insurer portal. Policy
service requests, responses and cancellation approvals use the portal during Batch 15. The partner API and
webhook contract retain their existing message formats.

- Authenticate server-to-server with OAuth client credentials or mTLS; never from the browser.
- Sign webhook payloads and verify the signature, timestamp and insurer identity.
- Use idempotency keys for quote, paid-policy and claim delivery; retries must not create duplicates.
- Store documents in private object storage and issue short-lived download URLs.
- Log delivery attempts, acknowledgements and status changes for audit and support.
- Deactivation stops new deliveries immediately but keeps prior quotes, claims and policies readable.
