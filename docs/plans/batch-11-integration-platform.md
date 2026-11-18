# Batch 11: Integration platform

## Purpose

Create one secure, observable path for work the platform sends to, and receives
from, external systems. This batch does not integrate a live RTSA, insurer, or
payment provider: their production credentials and contracts are not yet
available. It makes those integrations safe to add without changing customer
workflows or relying on browser code.

## Starting point

- Batch 3 supplies request idempotency and the shared API rate limiter.
- Batch 6 supplies a durable database job runner with retry, lease and backoff
  handling.
- `integration_deliveries` exists but is insurer-only, unused, and cannot be
  used by payment or RTSA work.
- Insurer onboarding records connection metadata but deliberately never stores
  the client secret, because no encryption key management exists.
- The RTSA development adapter returns a fixed Toyota Hilux for every unknown
  plate. That is useful only for a prototype and is unsafe to carry forward.

## Delivery slices

### B11.1 — Durable integration outbox

1. Widen `integration_deliveries` additively. A delivery has a target type,
   optional insurer, stable idempotency key, correlation ID, retry state,
   attempt history, and a manually resolved exception state.
2. Use the existing `jobs` table to run one delivery fact. The unique delivery
   key and job key prevent repeated user actions and a retry from producing
   duplicate requests.
3. Keep delivery payloads as minimum necessary integration data. Never save a
   client secret, signed URL, raw card/mobile-money data, or a full provider
   response.
4. Add an operations reader and a manual-fallback action. Operators can see
   why a delivery failed and record that an authorised person completed the
   hand-off outside the integration.

### B11.2 — Keys, signatures and callbacks

1. Encrypt insurer client secrets at rest with an application-server-only
   AES-256-GCM envelope key. The secret is write-only: responses, audit rows,
   logs and browser state never contain it.
2. Sign outbound payloads with a timestamp and body digest. Verify inbound
   callbacks before parsing their business content; reject stale, malformed,
   replayed and duplicated events.
3. Put callback idempotency on the provider event ID plus source identity. A
   provider retry receives the original accepted result rather than creating
   another policy, quote or claim transition.

### B11.3 — Adapter boundaries and operations

1. Replace the fixed RTSA result with an explicit manual-entry-required
   adapter. It remains behind the existing lookup rate limit, and production
   may operate in manual mode until RTSA authorises a live connection.
2. Define the insurer-API adapter behind the same delivery service. The insurer
   portal remains the normal, supported path when direct API delivery is not
   enabled.
3. Expose scoped integration health and exception lists to platform
   administrators and to the insurer that owns the delivery. Both views omit
   secrets and raw provider payloads.

## Security and integrity rules

- Direct integrations are server-to-server only. No browser receives a client
  secret or signs an integration request.
- Outbound endpoints must be HTTPS in live mode and may not target loopback,
  link-local or private network addresses. This prevents server-side request
  forgery through an administrator field.
- A completed delivery cannot be sent again. A failed delivery can be retried
  only as the same delivery, with the same idempotency key.
- A manual fallback is a terminal, audited outcome, not a hidden deletion of a
  failure.
- RTSA unavailable means manual entry; the system never invents vehicle data.
- A real provider is configured only after sandbox contract verification with
  that provider. Batch 14 will reuse this platform for a payment gateway.

## Acceptance checks

1. Enqueuing the same integration fact twice creates one delivery and one job.
2. A retriable external failure backs off; an exhausted one enters the
   exception queue and is visible to authorised operations users.
3. Manual fallback is authorised, audited and cannot be applied twice.
4. A stored client secret round-trips only inside the server; tampering or a
   wrong key fails closed.
5. Signed callback verification rejects a wrong signature, stale timestamp and
   replay without invoking business handling.
6. An unknown RTSA lookup returns a clear manual-entry-required response, not
   a placeholder vehicle.
7. Insurer and platform operations views are tenant-scoped and never expose
   secrets or full request/response bodies.

## Deliberate boundaries

- No live RTSA, insurer, payment, SMS, or road-tax connection in this batch.
  Each requires a signed provider agreement, sandbox credentials, contract
  mapping, timeout policy and operational owner.
- No automatic policy issue from a payment. Batch 14 will use this platform
  only after a verified payment callback and an insurer-issued certificate.
- No browser-to-provider calls, even for the prototype.

## Verification

Targeted unit and API tests cover encryption, callback verification, retries,
idempotency, manual RTSA fallback, permissions and tenant isolation. The API
typecheck, lint, production build and relevant end-to-end suites run before
the batch is submitted for review.
