# Batch 10: Rule settings, comparison taxonomy and product estimates

## Purpose

Replace prototype-only pricing and comparison constants with authoritative,
versioned platform configuration.  An insurer's approved product version owns
its own rate and estimate visibility; InsurShield staff own platform-wide rule
values and the vocabulary customers use to compare products.

This batch deliberately prepares the data and APIs for product choice in Batch
12.  It does not change the current one-request-to-insurer customer journey or
make an estimate a binding quote.

## Outcomes

- Administrators can maintain typed, effective-dated rule versions.  Every
  version is either **provisional** or **confirmed**, and every change is
  audited.
- The PIA minimum rate is represented by the same rule-version model while
  retaining its existing two-person approval action, endpoint and historical
  records for backwards compatibility.
- Product drafts include a base rate and an explicit `showEstimate` decision.
  The approved product version is immutable, so a later rate needs a revision
  and a new approval.
- A public, rate-limited estimate endpoint returns a non-binding estimate only
  for currently approved/effective products that allow estimates.  It applies
  the product rate and approved usage loading, then clamps the result to the
  applicable PIA floor.  It never applies NCD, taxes, fees or a client-supplied
  insurer rate.
- Administrators publish comparison taxonomy items; insurers map approved
  product versions to those items with a customer-readable value.  The API
  preserves the mapping snapshot with the product version for Batch 12's
  product comparison.
- Current cover-period calculation remains authoritative on the server.  A
  product may allow only a subset of the existing Q1/Q2/Q3/Q4 durations; this
  is made available now and enforced when Batch 12 submits selected products.

## Rule model

`platform_rule_versions` is append-only by `(key, versionNumber)`. A rule has:

- a typed key (PIA floor, quote reply deadline, NCD policy, driver questions,
  risk questions, add-ons, usage loadings or document retention),
- a JSON value validated against that key's server-side schema,
- an effective-from date, optional effective-until date, and
- a provisional/confirmed status, maker, confirmer and audit information.

JSON is limited to variable configuration payloads; product identity, rates,
taxonomy items and product-to-taxonomy mappings remain structured relational
records.  The effective rule at a time is the confirmed version with the most
recent effective-from date.  A missing confirmed rule uses a clearly labelled,
seeded provisional default only outside production; production release checks
will be able to refuse unresolved provisional settings.

The existing `pia_config` remains the fast, backwards-compatible current read.
On approved PIA-floor execution, the same transaction updates the rule version,
the current PIA row, its existing history and its audit record. Pending Batch 8
approval payloads continue to use `piaRatePercentage`.

## Estimate algorithm

All money is integer ngwee. For a product version and vehicle value:

1. validate the product is approved, currently effective, active and licensed;
2. validate the requested duration is permitted by the product;
3. calculate annual base premium from `vehicleValueMinor × rateBps / 10,000`;
4. apply the confirmed usage loading in basis points;
5. prorate by the selected calendar-quarter duration; and
6. take the maximum of that result and the PIA floor for the same duration.

The response identifies its product version and rule-version inputs and says
that it is an estimate, not a quote. Insurer-entered final premiums continue to
be checked against the PIA floor on the server. NCD handling remains with the
future selected-product quote flow rather than allowing an estimate to silently
undercut the floor.

## Safe migration and compatibility

- Add columns/tables only. Existing approved product versions receive a
  provisional rate from their insurer's historical `rateBps` and disabled
  estimate visibility until an insurer revises and obtains approval.
- Keep `/config/pia`, Batch 8 approvals and `pia_config_history` working.
- Do not delete web demo constants until their API-based consumers migrate;
  mock mode mirrors the typed contract.
- Existing quote requests, quotes and policies retain their stored prices and
  dates. Batch 12 will add chosen product/version snapshots to new requests.

## Tests and completion evidence

- Unit tests for each typed setting schema, effective-date selection, estimate
  rounding/floor/duration cases, and taxonomy mapping validation.
- API tests for permissions, tenant isolation, stale/inactive/unlicensed
  product refusal, provisional-versus-confirmed rule behaviour, PIA maker/
  checker separation, and concurrent revisions.
- Browser tests for insurer product pricing fields, administrator settings and
  taxonomy management, and graceful estimate unavailable states.
- API and web build, lint, typecheck, unit and targeted end-to-end tests pass.

## Explicit boundaries

- Batch 11 owns external adapter delivery.
- Batch 12 owns the customer product directory, eligibility filtering,
  selection of one to five products and chosen-product questions.
- Batch 13 owns insurer quote SLA queues and final quote comparison.
- Batch 14 owns taxes, fees, payment and settlement calculations.
