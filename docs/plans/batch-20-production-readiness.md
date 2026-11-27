# Batch 20 production readiness and release gate

Sources [Roadmap](roadmap.md#batch-20-production-readiness-and-release-gate), [release acceptance](../requirements-spec.md#12-mvp-release-acceptance), and [customer journeys](../user-stories.md#us-cus-001---start-the-correct-journey).

## Delivery

1. Add safe request logs, route-level aggregates, trace context and request IDs. Document collection and alerts for the selected hosting environment. Keep customer data, secrets and provider payloads out of diagnostic output.
2. Prepare staging and production runbooks, an isolated recovery exercise, and the breach-response handoff to Legal and Compliance. Check database and object recovery together. Record actual recovery times against approved targets when they exist.
3. Verify the customer entry points on small screens, with the keyboard, reduced motion and a constrained connection. Add repeatable browser coverage and fix verified defects within the existing design. Record the browsers and conditions each test actually covers.
4. Maintain a release checklist for all 14 criteria in requirements section 12. Require named sign-off and specific evidence tied to the release candidate. Keep the provider gate and prevent provisional platform rules from being used in production. Exercise a real scanner adapter in controlled tests before qualifying a deployment.
5. Measure the cold mobile entry from the compiled bundle. Defer authenticated and later journeys, check route-load failure and offline recovery, and compare the first-load size and render time under the same test profile. Review dependency advisories against the current lockfile and use the smallest supported patches.

## Decisions and evidence needed before release

- **Hosting and recovery** require an approved host and region, a data-residency decision, verified encryption and key controls, signed recovery targets, and a drill on the selected staging setup.
- **Provider readiness** requires the contracted/payment and RTSA interface decisions, authenticated sandbox access and approved contract evidence. The existing manual insurer workflow can cover launch insurers only where the agreement allows it. Assess email, object storage and scanning against the approved deployment and the data they process.
- **Policy and launch** require confirmation of effective rule versions, privacy and legal statements, client UAT, the unresolved-defect register and explicit go-live approval. Track accountable reviewers and references in the release evidence file. Use synthetic data for local exercises.
- **Dependency triage.** The installed audit on 27 November reported zero high or critical entries and seven moderate tooling entries after the patches. Review the residual findings for the deployed artifact. [Dependency security evidence](batch-20-dependency-security-evidence.md)
- **Mobile performance.** Later journeys and optional code now load on demand. Compiled browser checks enforce an initial JavaScript budget and verify recovery from interrupted or outdated route downloads. Verify the deployed artifact against the agreed launch profile. [Customer journey verification](../runbooks/customer-journey-verification.md)

## Verification

Run release-gate unit tests, API tests for production rules and diagnostics, browser journey checks and the isolated database recovery procedure. Verify supported browser versions, accessibility and performance with the agreed launch profile and record the result. Verify production at-rest encryption, alerts and provider contracts from staging evidence before signing off the candidate.

- [Customer journey verification](../runbooks/customer-journey-verification.md)
- [Local recovery exercise and staging evidence template](../runbooks/exercise-evidence.md)
