# Batch 3: Real API repair and shared safeguards

## Purpose

Replace remaining browser-only behaviour with the API as the source of truth, and put the missing safety checks at the
server boundary. This batch does not change the customer journey, insurer workflow, colours, or the selected payment
model. It makes existing screens reliable enough for later audit, document, notification and payment-provider work.

## Starting point

- Batch 2 is merged. Browser sessions use Better Auth and each quote request now keeps its own vehicle snapshot.
- The API already has the core endpoints for administrator figures, insurer portal work, quote requests, documents,
  claims, NCD and payments.
- Several screens still calculate or persist information in the browser, and some API writes do not yet share a
  consistent idempotency or rate-limit guard.
- The current PIA configuration is stored as basis points in `pia_config`; when the row is absent, the existing public
  API uses the regulatory default of 4%.

## Delivery order

Every numbered package starts by adding or adjusting a failing behaviour test, then applies the smallest durable fix.

### B3.1 Quote integrity and insurer portal

1. Refuse a final insurer premium lower than the PIA floor for the quote request's declared vehicle value. The refusal
   states the calculated minimum. The floor is annualised consistently for the selected cover duration; Batch 10 will
   later version the setting rather than changing this rule.
2. Load the signed-in insurer's own profile through `GET /insurer/profile`; remove the obsolete `coverGuides` field
   from insurer update requests. Cover guides stay on their existing product path until Batch 9.
3. Compute policy dates only on the server and ensure the customer confirmation uses the server policy number.
4. Make a requote carry the original request's computed dates, inspection photographs and ownership document. A fresh
   request cannot reach payment without those records.
5. Upload the White Book with a dedicated ownership-document kind and attach it to the quote request rather than
   treating it as a claim attachment.

### B3.2 Shared request safety

1. Add an idempotency record migration keyed by authenticated caller, endpoint and key, with a request-body hash.
   A repeat of the same request returns its recorded result; reuse of the key with a different body is refused.
2. Apply that guard to quote-request and claim submission. The browser retains one idempotency key for a submit
   attempt across network retries. The payment endpoint keeps its proven current key mechanism until Batch 14.
3. Add one shared API rate limiter, honouring the established `TRUST_PROXY_HOPS` rule and its on/off configuration.
   It protects public vehicle/directory/PIA/NCD-validation routes and upload, quote and claim submissions.
4. Make public NCD validation answer only whether a code is valid. Reject an invalid submitted NCD code with a useful
   reason. The customer-facing NCD quote calculation comes later in Batch 12.

### B3.3 Administration and data quality

1. Make the admin overview, revenue, recent policy list and customer lookup read the `/admin/*` endpoints, never
   browser-store demo data.
2. Stop HTTP reconciliation from creating demo insurers. Validate upload bytes, insurer website URLs and logo URLs on
   update as strictly as on create. Stop new quote deliveries to an insurer with an expired licence.
3. Keep NCD decisions valid: no return to `SUBMITTED`, no percentage over the automatic cap, and no unimplemented
   `notifyCustomer` flag before Batch 6.
4. Hide browser-only insurer reviews and ratings in HTTP mode until Batch 17, and remove the unsupported web `support`
   role until Batch 7 defines its permissions.
5. Narrow Better Auth account-link columns only after proving that no existing customer or staff row lacks `userId`.

### B3.4 Regression coverage and release checks

1. Add the corresponding API unit/e2e regressions and real-API web coverage beside the existing mock journey.
2. Add CI lanes for lint, type checks, unit tests, builds and API e2e; run the browser journey against a real API.
3. Update the decision register/spec wording only once the user accepts the proposed text for DEC-016 and DEC-019.

## Important boundaries

- No production payment gateway is added in this batch. The existing payment record remains a provider stand-in.
- No RTSA road-tax collection or disc issuance is included; it is deliberately deferred beyond MVP.
- The official insurer certificate remains the activation event for a paid policy. A payment callback must never create
  an active policy by itself.
- Documents remain private; a document uploaded by one party cannot be attached by another.

## Completion evidence

- Under-floor premium, duplicate submit, changed-body idempotency reuse, invalid NCD code, expired insurer licence,
  White Book attachment and requote carry-forward all have automated regression coverage.
- Admin and insurer pages receive their data from the documented API routes in HTTP mode.
- Lint, type checks, builds, API e2e and the real-API web journey pass.
- The database migration and its catalog/snapshot checks pass before the batch is proposed for merge.
