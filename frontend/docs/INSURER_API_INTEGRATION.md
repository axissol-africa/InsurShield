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

## Required safeguards

- Authenticate server-to-server with OAuth client credentials or mTLS; never from the browser.
- Sign webhook payloads and verify the signature, timestamp and insurer identity.
- Use idempotency keys for quote, paid-policy and claim delivery; retries must not create duplicates.
- Store documents in private object storage and issue short-lived download URLs.
- Log delivery attempts, acknowledgements and status changes for audit and support.
- Deactivation stops new deliveries immediately but keeps prior quotes, claims and policies readable.
