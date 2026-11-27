# Operations runbooks

These procedures support [requirements section 12](../requirements-spec.md#12-mvp-release-acceptance), especially acceptance items 4–10 and 12–13. They supplement [Deployment](../DEPLOYMENT.md); they do not approve a production environment or close DEC-011.

| Procedure | Use |
| --- | --- |
| [Environment operation](environment-operation.md) | Staging and production readiness, release handoff, encryption evidence |
| [Backup and recovery](backup-and-recovery.md) | Recovery objectives, matched database/object backups, isolated restore, return to service |
| [Incident response](incident-response.md) | Alert routing, escalation, security and privacy incidents |
| [Exercise evidence](exercise-evidence.md) | Record a nonproduction exercise and its limitations |
| [Customer journey verification](customer-journey-verification.md) | Browser, accessibility and mobile performance evidence |

## Evidence and approval

Use these labels on every operational record:

- **Observed:** a dated check against a named environment and artifact, with result and evidence reference.
- **Approved:** a decision reference, accountable approver, approval date and applicable environment/scope.
- **Pending:** missing approval, measurement, configuration or evidence. Pending is not a pass.

Code and a local test can demonstrate behavior; they cannot establish deployed infrastructure settings, legal compliance, data residency, staffed on-call coverage or a provider's restore capability. Deployment examples are not evidence that resources exist. Do not copy credentials, customer data, signed URLs, raw incident payloads or backup contents into this repository.

DEC-011 assigns privacy, hosting, retention, security and audit obligations to Legal/Compliance/Security. Its outcome remains blank in the [decision register](../requirements-spec.md#15-scope-and-decision-register). Obtain approved decisions for hosting/residency (including backup replicas), retention and disposal, encryption/key management, lawful processing and breach response. Record service-owner approval of RPO/RTO under NFR-REL-005. Missing decisions remain visible blockers to operational go-live approval; these documents do not supply substitute policies.

## Ownership and handoff

Before use, record named primary and backup contacts in the restricted operational directory. Do not invent personal contacts in the repository.

| Role | Responsibility |
| --- | --- |
| Operations lead / incident commander | Coordinates response, assigns actions, maintains timeline, accepts handoffs |
| Application owner | Release/schema compatibility, workflow correctness, safe job recovery |
| Database and storage operators | Backup integrity, recovery points, object versions, access and encryption evidence |
| Security lead | Containment, forensic preservation, credential/session compromise |
| Legal/Compliance owner | Approved legal procedure, notification decisions, retention/hold obligations |
| Finance and insurer integration owners | Reconcile external financial/issuance effects before replay |
| Service owner / go-live approver | Approves objectives, downtime, return to service and residual risks |

A handoff names the incident/change ID, current impact, UTC timeline, environment and release digest, evidence links, actions completed, actions pending, next decision, and the receiving owner. The recipient acknowledges ownership; sending a message alone is not a completed handoff. Escalation routes and response intervals come from the approved on-call policy.
