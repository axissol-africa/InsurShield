# Batch 12: Product choice and the request model

## Purpose

Move the customer journey from broadcasting one generic request to every
insurer to a customer choosing one to five eligible, approved product
versions. A request is then delivered once to each distinct insurer, while
each selected product version receives its own insurer response and quote.

This implements Batch 12 in the approved roadmap. It deliberately stops
before Batch 13's queue states, inspection scheduling and rich comparison, and
before Batch 14's real payment provider and issuance workflow.

## Current evidence

- Approved product versions already hold immutable customer terms, inspection
  rules, rates and allowed durations in
  `apps/api/src/db/schema.ts:524-575`; comparison mappings are version-scoped
  at `644-669`.
- The current request model still holds one cover type/duration and broadcasts
  to every active insurer (`quote-requests.service.ts:56-120`), with one
  recipient per insurer (`schema.ts:766-801`). Requotes repeat that broadcast
  (`quote-requests.service.ts:128-182`).
- The quote table permits only one quote per insurer/request
  (`schema.ts:803-839`), so it cannot represent two chosen products from one
  insurer. Payments already reference a concrete insurer quote id
  (`schema.ts:858-880`), but the public payment DTO still names an insurer
  (`payments/dto/payment.dto.ts:7-24`).
- The web quote submitter sends the legacy cover-type payload
  (`apps/web/src/features/quote-journey/submitRequest.js:40-99`) and the
  customer contract indexes replies by insurer name (`apps/web/src/api/contracts.js:79-116`).

## Required outcome

1. A signed-in customer supplies common risk answers, receives only currently
   eligible products from insurers that may take new business, and sees a
   clearly labelled non-binding estimate where the product permits one.
2. The customer selects one to five distinct product versions, including two
   products from the same insurer. They complete only the selected products'
   extra questions, required documents and declarations.
3. Submission validates the full selection inside one transaction, writes one
   request and its selected-version rows, creates one recipient and one Batch
   11 delivery per distinct insurer, and records every action in the audit log.
4. Insurers reply and extend quotes **per selected product version**. Customers
   see and select quotes by quote id, and payment identifies that exact quote
   id.
5. Existing requests, quotes, payments and policies remain readable and
   payable by quote id. Requotes and renewals of legacy records return to the
   product list instead of widening to all insurers.

## Prerequisites closed by this batch

Before exposing product selection, the API must make these rules executable
rather than inferring them from prose in a cover guide:

- **One current version per product.** The selection reader must resolve a
  single approved, effective version for a durable product identity. Ambiguous
  overlapping approved versions are a configuration error, not a random choice
  for a customer.
- **Governed requirements.** Eligibility rules, extra questions, required
  documents and declarations need typed, versioned product configuration. A
  cover-guide paragraph must never become an undocumented server validation
  rule.
- **One insurer-standing decision.** Directory, selection submit, quote reply,
  extension and payment must use the same active/licensed/compliance check.
  Licence/evidence expiry is temporary unavailability; an explicit platform
  suspension/deactivation/deletion creates permanent cancellation marks.
- **Exact versioned relationships.** A versioned quote must reference a chosen
  version on the same request and insurer. Application validation and database
  constraints must prevent cross-request or cross-insurer references.

## Data and contract design

### Additive migration

Create a new request-to-product-version table. Each row records:

- `quoteRequestId`, `productVersionId`, `insurerId`, and immutable
  customer-readable version identifiers (product code, name and cover type);
- selection-time product terms needed for a durable customer view (cover guide,
  inspection rule and timing); and
- a cancellation mark (`cancelledAt`, reason) used when InsurShield suspends an
  insurer after a customer has submitted.

The request itself gets an explicit model discriminator so a damaged
versioned request with zero chosen-version rows cannot be mistaken for a
legacy request. Existing rows remain legacy; the system never guesses their
product from an insurer name.

Keep `quote_request_recipients` unique by `(quoteRequestId, insurerId)`: it is
one delivery recipient, not one quote. Add nullable `productVersionId` to
`insurer_quotes`, remove the global `(quoteRequestId, insurerId)` uniqueness,
and replace it with two partial unique indexes:

- `(quoteRequestId, productVersionId)` where `productVersionId IS NOT NULL`;
- `(quoteRequestId, insurerId)` where `productVersionId IS NULL`.

This preserves the one-quote legacy invariant while allowing one quote for
each selected version. Keep quotation-document uniqueness. The migration keeps
the existing request/reference uniqueness only for legacy rows; versioned
offers may share an insurer-level reference because quote ID plus
request/version is their authoritative identity.

Create customer-owned, 30-day draft records for common answers and the current
selection. Structured columns own identity, status and timestamps; JSON is
limited to configuration-driven answer values. Draft documents must be linked
only after ownership/kind/scanning checks and must be removed or expire with the
draft.

### Public and authenticated API

- Reuse the Product repository's current-approved directory query and the
  Batch 10 estimate service. Add a customer-facing eligibility service that
  validates common answers, insurer standing, version status/effective dates,
  allowed duration and the product's published rules in one place.
- Expose a rate-limited directory/eligibility response containing only
  customer-safe version details, comparison mappings, inspection information
  and estimates that are allowed to be shown. It must never leak an insurer's
  drafts, secrets, staff-only review comments or provisional internal rules.
- Add draft create/read/update/delete endpoints scoped to the authenticated
  customer. Every resume and submit recomputes eligibility rather than trusting
  saved browser state.
- Replace the legacy generic submit DTO with a required, versioned selection
  contract. A body without selected versions gets an explicit
  `RELOAD_REQUIRED` message: “InsurShield has been updated; reload the page.”
  The new web against an old API fails closed through DTO validation.
- Add product-version-scoped insurer reply/extension DTOs. Replies without a
  version are allowed only for legacy requests; a new request refuses them with
  the same reload message.
- Replace payment lookup by insurer name with `insurerQuoteId`, then resolve
  ownership, request association, expiry, suspension/unpayable marks and
  current insurer standing on the server. The amount remains server-derived.

### Journey and portal behaviour

1. **Common answers:** vehicle, vehicle value, usage, cover start/duration,
   drivers/risk data and optional validated NCD code.
2. **Eligible products:** show approved versions with benefits, comparison
   values, excess/add-ons, inspection rule and allowed estimate. A common
   answer change re-evaluates the list, removes ineligible picks with a
   reason, and asks the customer to confirm the updated selection.
3. **Selection and completion:** choose one to five versions; deduplicate
   selected-version questions/documents and identify which selected product
   needs any missing document. A customer may remove that product rather than
   upload the document.
4. **Submit and tracking:** show one request but distinct product-version
   replies. Pending, cancelled and unavailable products must not obscure other
   selected versions.
5. **Insurer portal:** one recipient request can show several selected versions
   for that insurer; an officer enters/extends each quote separately.
6. **Payment:** customer selects a quote id. No insurer name is accepted as a
   proxy for a quote.

## Delivery sequence

### B12.1 — Foundation, schema and eligibility (first implementation slice)

1. Introduce shared selected-product and eligibility domain types/schemas.
2. Add the additive Drizzle migration, generated catalogue/snapshot, repository
   methods and server tests for selected-version and legacy uniqueness.
3. Build the single eligibility evaluator and customer-safe directory response,
   reusing the Batch 9/10 product data and estimate service. Cover insurer
   standing, effective dates, withdrawn versions, duration, usage and cover
   type. It must resolve the one current version and reject ambiguous product
   configuration before returning any customer-facing choice.
4. Add authenticated 30-day draft APIs and expiry job registration, without
   replacing the live submit flow yet.

### B12.2 — Selected-version submit and delivery

1. Replace broadcast recipient selection with a server-validated selection of
   one to five distinct versions. Collapse selected versions by insurer only for
   recipients and Batch 11 deliveries.
2. Store selected-version snapshots, recipient rows and audit/state history in
   the same transaction; enqueue one delivery fact per insurer.
3. Apply Decision 24 cancellation marks to selected-version rows alongside the
   existing recipient/quote marks and notify the customer through Batch 6.
4. Make legacy tabs fail safely on new writes while retaining all historic
   reads.

### B12.3 — Per-version insurer reply, customer view and payment identity

1. Migrate insurer quote create/list/extend behaviour to `productVersionId` and
   preserve legacy replies.
2. Update customer API responses, contracts, mock mode and customer screens to
   render quotes by id/version rather than insurer name.
3. Change payment DTO/service/client to require `insurerQuoteId`; preserve
   payment of historic quotes and refuse invalid, expired, cancelled,
   withdrawn/superseded or unpayable quotes with a clear reason.

### B12.4 — Requote, renewal and user journeys

1. Requote and renewal start from the product list; carry common answers and
   eligible documents/photos forward, then revalidate current versions.
2. If a selected product changed, withdrew or no longer qualifies, retain
   other eligible choices and explain the removal. If none remain, do not
   create a request.
3. Replace legacy customer forms and comparison/payment screens in HTTP and
   mock mode together, maintaining accessible progress, errors, empty states
   and mobile layouts.

## Cutover and rollback

- Deploy the migration first, then the API, then the web. The migration is
  additive, but once the new API writes selected-version data, rolling back to
  the old API is unsafe; recovery is the pre-migration backup/runbook.
- Existing rows without selected-version rows are legacy records. They remain
  listable, their existing quotes remain payable by quote id, and an old quote
  cannot be silently recast as a new product choice.
- New submissions/replies/payment requests never infer a product version from
  insurer name. They fail closed with the reload message if an old client is
  detected.
- Application checks and foreign-key/trigger constraints prevent a versioned
  quote from being attached to a chosen version belonging to another request or
  insurer.

## Testable acceptance criteria

- The directory hides draft, rejected, withdrawn, ineffective, inactive,
  unlicensed or otherwise ineligible versions and never exposes staff-only
  data.
- Exactly one to five distinct selected versions are accepted; a sixth,
  duplicate, stale or ineligible version is refused.
- Two versions of one insurer produce one recipient/delivery, two independent
  replies and two customer-visible quotes; paying one names and pays only its
  quote id.
- A changed common answer removes only invalid selections, states why, and
  forces confirmation before submit.
- Required selected-product documents/declarations are checked server-side;
  missing documents identify the owning product.
- Legacy requests can list and pay their existing quote by id. New writes from
  old web bodies, replies without a version, and old insurer-name payments
  receive the reload refusal.
- A version withdrawn between directory and submit is refused. Suspension after
  submit cancels only that insurer's selected versions, makes its unpaid quotes
  unpayable permanently, and leaves other choices usable.
- Requote/renewal never broadcasts to all insurers. It returns to current
  eligibility and does not widen recipients.

## Verification

For each slice: add focused unit and API integration tests first, regenerate
the migration catalogue, then run API typecheck/lint/build/E2E and web
lint/unit/build plus both browser journeys. Before the Batch 12 PR, add
cross-tenant, race/idempotency, expired-draft, duplicate-submit, legacy-data
and mobile accessibility smoke tests. Review the migration with a database
backup/rollback rehearsal before it reaches a shared environment.

Specifically exercise a populated legacy upgrade, a repeat migration, cross-
customer and cross-insurer selected-version access, duplicate submissions,
same-priced sibling quote payment replay, failed delivery retry, cancellation
followed by insurer restoration, expiry of a saved draft, and old-web/new-API
or new-web/old-API refusal paths.

## Explicit boundaries

- Batch 13 owns richer quote queue states, insurer SLA handling, inspections
  before quote/payment and full comparison UX.
- Batch 14 owns payment-provider callbacks, taxes/fees settlement and policy
  issuance. Batch 12 only establishes exact quote identity for payment.
- Batch 15 owns the full renewal experience; Batch 12 only makes recipients
  and eligibility correct.
