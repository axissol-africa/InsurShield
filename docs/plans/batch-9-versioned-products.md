# Batch 9 — Versioned insurer products and publication

## Purpose

Batch 9 replaces the prototype-only insurer cover-guide library with an API-backed product catalogue. An active, verified insurer can prepare a product for each cover type, submit a complete version, and see an administrator's decision. Customers can read only currently approved versions. This batch establishes the product record that later quote, pricing, inspection and payment work will reference.

## Scope

This implements roadmap Batch 9, `US-VEN-003`, `US-ADM-004`, the product and cover-guide portion of `FR-IP-005` and `FR-ADM-002`, plus the product-level representation of `FR-INS-001`.

### B9.0 Delivery gate

Before product work is released, repair the failed Batch 8 API E2E checks and keep the CI suite deterministic. The changes must be regression-only: they do not change the Batch 8 staff-MFA, approval or support-reset contract.

### B9.1 Product catalogue and immutable versions

- Add a stable insurer-product record, scoped to one insurer and one cover type, with a product code and customer-facing name.
- Add immutable product versions with a sequential version number, draft/submitted/approved/rejected/withdrawn state, effective dates, creator/reviewer information, decision comments and timestamps.
- Store the canonical cover guide on the version: plan name, plain-language summary, benefits, exclusions, claim-contact information, conditions and quote-validity information. The API validates the same mandatory information that the insurer-facing editor requires.
- Move inspection rule, blocking stage and method onto the product version. A product with no inspection requirement has no method or blocking stage; a required or optional inspection names the supported method and stage.
- Keep the existing insurer-level fields and current quote records intact. They remain legacy compatibility data until Batch 12 introduces request-to-product-version links. No migration rewrites historical quotes.

### B9.2 Insurer product workflow

- Add insurer-scoped product endpoints. Only an insurer administrator for the owning, active, licensed and evidence-verified insurer can create or change a draft.
- A submitted version is frozen. Editing an existing submitted, approved, rejected or withdrawn version creates the next controlled draft instead of mutating history.
- Submission refuses incomplete cover-guide data, invalid effective-date ranges, missing inspection information and a product whose insurer no longer has standing to take new business.
- Insurer users can list their product history and read the administrator's decision and comments, but never another insurer's data.

### B9.3 Administrator review and customer catalogue

- InsurShield administrators can list submitted product versions, approve with an effective date, reject with a required reason, or withdraw an approved version with a recorded reason.
- Approval records the reviewer, decision time, comments and effective dates in the product version and immutable audit trail. A future-effective version is not customer-visible until its start date; an expired or withdrawn version is never returned from the public catalogue.
- Expose a public, rate-limited product directory containing only current approved product versions from insurers that may take new business. It provides the consistent cover-guide and inspection fields that Batch 12 will use for product selection.
- Product changes are auditable with safe metadata only. Product terms stay historical: publishing a later version never edits the one a customer may have seen.

### B9.4 Web and mock parity

- Replace the insurer portal's browser-store cover-guide save with the product API. The editor clearly distinguishes a local draft, submitted version, approved/effective version and returned version.
- Add an administrator product-review surface beside the existing insurer approval inbox.
- Keep the mock adapter on the same contract and migrate persisted prototype state safely. Existing insurer-level demo guides do not become approved server products merely by upgrading a browser.
- Do not redesign the customer home page or start the multi-product request journey in this batch.

## Explicit boundaries

- Batch 10 owns rates, loadings, NCD rules, durations, comparison taxonomy, eligibility and estimates. Batch 9 stores no product-specific price calculation.
- Batch 11 owns insurer/RTSA integrations.
- Batch 12 adds product selection, request recipient/version links, one-to-five selection and quote/version references. Existing one-quote-per-insurer behavior stays unchanged here.
- B9 does not add product documents as a new upload kind. The structured cover guide holds the customer-facing terms for this milestone; protected policy-term documents are extended only when their document lifecycle is specified.
- Product approval is a governed administrator decision, but it is not a Batch 8 maker/checker action. Batch 8's dual-approval scope remains PIA and insurer-lifecycle actions.

## Data and lifecycle rules

1. A product identity is never deleted while it has a version; withdrawal stops future catalogue visibility and preserves history.
2. Version numbers are unique per product and allocated transactionally.
3. `DRAFT → SUBMITTED → APPROVED` is the normal path; an administrator may instead reject a submitted version. An approved version can be withdrawn. A new correction always starts a new draft.
4. A submitted version is immutable. An insurer cannot edit another insurer's product or use an old version number to overwrite history.
5. A customer catalogue query returns only approved, currently-effective versions whose insurer is active, licensed and allowed to take new business.
6. A public product view contains no onboarding evidence, administrator comments, internal identifiers, secrets or other insurer-only metadata.

## Verification

- API tests cover tenancy, insurer standing, required-field validation, version allocation, state transitions, effective dates, withdrawal, directory filtering, concurrency and audit rows.
- Web tests cover saving/submitting a guide, version status display, admin approval/rejection and mock/HTTP contract parity.
- Run lint, typecheck, builds, unit tests and focused API E2E tests. Run the full E2E suite after the baseline CI regression fixes; report any infrastructure-only limitation separately.
