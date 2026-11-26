# Batch 16: Claims, No Claim Discount and later inspections

Source of order and decisions: [Batch 16 in the roadmap](roadmap.md#batch-16-claims-ncd-and-later-inspections),
[requirements sections 4.5, 4.9, 4.10 and 8](../requirements-spec.md), and the inspection boundaries in
[Batch 13](batch-13-quote-workflow-queues-inspections.md). Batch 15 supplies the rules workspace, help-desk
handoff, canonical portfolio and retention guards. Use one branch with separate, testable parts.

## Part 1: Claim intake and insurer updates

1. Build on `apps/api/src/customer/claims.service.ts` and `claims.repository.ts`. Resolve an owned policy and its
   vehicle and insurer on the server. Check the Lusaka incident day against issued cover, including coverage
   and applicable cancellation boundaries. Keep typed values if submission fails. An expired policy may still
   accept notice for an incident while cover was in force. For a deleted insurer, return a support reference and
   the configured help-desk contact. A suspended insurer can still service existing cover.
2. Define the claim lifecycle in a pure domain function. Preserve `NOTIFIED` and `RECEIVED_BY_INSURER` and add
   review, evidence required, approved, declined and closed. Acknowledgement records the insurer reference.
   Evidence submission responds to an open request and returns it for review. Closing follows an approved or
   declined decision. Use row locks, preserve historical acknowledgements, and record status history, customer
   notifications and secure evidence references atomically. Settlement remains with the insurer.
3. Add governed reporting, response and evidence rules using `settings/domain/rules.ts`; record the applied due
   date and late-review flag. Late notice needs a reason and goes to insurer review. Confirm rule values and the
   coverage/evidence matrix before production. Apply the same reporting window to insurer deletion eligibility in
   `insurers/insurers.repository.ts`. Recheck claims, existing policies and retention against closure rather than
   treating every claim ever notified as open. Keep historical evidence governed by its retention period.
4. Extend the existing customer claim detail and insurer queue, using the API contracts already in
   `apps/web/src/api`. Show the claim and insurer references, status, timestamped updates and required action.
   Limit the customer action to supplying the requested evidence. Preserve the existing layout and responsive
   components. Current claim list and acknowledgement routes keep serving legacy records.

**Acceptance.** Owned policy and incident checks distinguish early, late and in-window notices. Another account or
insurer cannot see or change the record. Valid transitions record an actor and notification, and stale or duplicate
commands never produce a second update. Requested evidence remains private, scanned and immutable. Closure releases
only the open-claim legal hold. Deleted insurer refusal preserves the form and includes support contact and reference.

## Part 2: No Claim Discount

1. Reuse the governed `NCD_POLICY` from Batch 10 in `customer/ncd.service.ts`, `customer/ncd.repository.ts` and the
   insurer's decision path. Verify ownership of the reported policy and its vehicle, retain the signed declaration,
   support verification before decision, and audit and notify every transition.
2. Issue one protected insurer/policy/vehicle-bound code per approval, with the approved tier and expiry. Enforce
   that binding at validation, quote and payment. Preserve historical policies and already redeemed legacy codes.
   Define an explicit rule for outstanding pre-Batch-16 codes. Lock redemption and reject inconsistent or competing uses.
3. Extend the existing NCD views with required evidence, status and reason. Use the API-calculated discount throughout.

**Acceptance.** Tests exercise configured tiers and validity, rejected and expired codes, identity and policy/vehicle
mismatches, parallel redemption, and old policy and payment replay. An insurer cannot access another insurer's application.

## Part 3: After-payment and claim inspections

1. Extend the existing `apps/api/src/inspections` state machine with explicit purchase and claim links and purpose.
   Reuse approved scheduling, photo slots, and outcomes. Use the policy/product snapshot when an after-payment
   inspection is required and create it exactly once after confirmed payment. An insurer starts a claim inspection on
   an owned claim. Keep earlier quote and payment readiness rules working.
2. Store signed, scanned pre-loss and post-loss evidence under distinct historical records and retention relationships.
   Show linked evidence groups to the servicing insurer and only the customer's own documents to the customer.
   Published evidence remains immutable even if later evidence is uploaded in the same slot.
3. Reuse customer and insurer inspections pages and notifications. Show purpose, related reference, latest status and next action.

**Acceptance.** A retried payment creates at most one after-payment inspection. Prior evidence and historical reports
remain byte-identical. Claim evidence is associated with the correct claim and allowed parties. Existing quotation and
payment-stage inspection tests continue to pass.

## Part 1 delivery details

- `CLAIM_REPORTING` starts with 14 calendar days to report and 7 calendar days for the initial response target.
  Both are provisional. The setting also holds covered-type exclusions and evidence by claim type. The intake
  lookup exposes the effective settings and stores the rule version, late flag and response date with the claim.
- `POST /claims` uses the policy's own insurer and vehicle. Coverage and dates are checked against the incident
  day. A claim outside the reporting window still starts as a first notice, with a late reason and a visible
  late-review flag for insurer review. Historical first notices remain readable and keep their original identifiers.
- The customer and insurer share the claim timeline. A new verified claim needs the insurer's reference at
  acknowledgement. It can then progress through review, requested evidence, decision and closure. New evidence is
  attached to its timeline update and cannot replace an earlier document. Customers receive status notifications.
  Updates require the displayed timeline revision, so an old decision or upload cannot apply to a new evidence round.
  Account closure waits while an evidence request needs the customer, and insurers cannot request evidence from a closed account.
- Migration 0047 preserves existing values, makes the new timeline append-only, and removes the open-claim legal
  hold once the claim is closed. Other holds and retention periods still apply. The insurer deletion check also
  protects policies through the last reporting day and accounts for open service requests. Submission of new service
  requests and claim updates checks that the insurer can still service the policy.

## Verification and rollout

- Additive catalog-backed migrations and fresh plus legacy adoption tests per part. Preserve existing nullable legacy
  links and provide an explicit customer fallback for claims that cannot be linked to historical policy data.
- API unit, real PostgreSQL E2E, permission coverage, API typecheck, lint and build. Customer/insurer Playwright
  journeys and targeted web unit tests cover both happy paths and refusals.
- The reporting and evidence rules, NCD policy and later-inspection outcomes require business approval before go-live.
  Keep provisional values visible in governed settings and include their approval in the Batch 20 release gate.
