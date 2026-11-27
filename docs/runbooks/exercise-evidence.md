# Nonproduction recovery exercise evidence

Copy the template below into the approved restricted evidence store. Keep customer data, secrets and deployment object keys out of Git.

## Local exercise on 26 November 2026

An isolated PostgreSQL 17 database used the application schema through
`0052_batch_19_governance` and one synthetic document record. A disposable
versioned MinIO bucket held an original object and its later replacement.
A custom-format `pg_dump` and the selected object version made up the
backup. `pg_restore` restored into a fresh database. Reading the archived
object from a separate bucket by the restored key matched the record's byte
count and SHA-256 checksum. The latest source version failed the checksum
comparison as expected.

Capture took about 0.38 seconds. Restore and verification took about 0.59
seconds. These measurements cover one 50-byte synthetic object and an
otherwise empty schema. The staging exercise still needs approved recovery
targets, a representative workload, managed backups, key access and
application smoke tests. The local database and buckets contained synthetic
data only.

## Scope and authority

| Field | Evidence / value |
| --- | --- |
| Exercise ID, date, operators and independent reviewer | PENDING |
| Scenario and agreed service scope | PENDING |
| Approved procedure/change reference | PENDING |
| Source synthetic dataset description and digest | PENDING |
| Destination DB/bucket resource identities and owner | PENDING — restricted references only |
| Proof destinations are disposable and not production/project DBs | PENDING |
| Network, inbound callback and outbound provider isolation | PENDING |
| API/job startup containment and reviewer | PENDING |
| DEC-011 approval references / unresolved scope | PENDING |
| Approved RPO/RTO, definitions and owner | PENDING |

## Recovery manifest and encryption

| Field | Evidence / value |
| --- | --- |
| Recovery-set ID, manifest digest and restricted location | PENDING |
| Source DB backup/archive identifiers and usable coverage | PENDING |
| PostgreSQL version, migration history/hash | PENDING |
| Application, frontend and migrator artifact digests | PENDING |
| Configuration/secret version references; recovery-key access evidence | PENDING — no secret values |
| DB point and matched bucket/version inventory | PENDING |
| Required/matched/missing/ambiguous object counts | PENDING |
| Checksums, sizes, delete markers and scan/deletion state comparison | PENDING |
| Missing-checksum exceptions and approved alternative evidence | PENDING |
| Transit encryption evidence for every hop | PENDING |
| At-rest evidence for DB, objects/versions, backups, replicas and logs | PENDING |
| Provider resource regions and approved residency comparison | PENDING |
| Restored-data retention/hold and post-point deletion reconciliation | PENDING |

## Timeline and measurements

Record UTC instants, elapsed durations and evidence sources. Use the [objective definitions](backup-and-recovery.md#objectives-and-approvals); do not subtract unrelated tool timestamps and call the result RTO.

| Event | UTC instant / duration | Evidence |
| --- | --- | --- |
| Simulated disruption / RTO start | PENDING | PENDING |
| Detection and owner acknowledgement | PENDING | PENDING |
| Restore authority granted | PENDING | PENDING |
| Latest verified mutually consistent recovery point | PENDING | PENDING |
| Restore start and tool completion | PENDING | PENDING |
| Offline consistency checks complete | PENDING | PENDING |
| Isolated application validation and reconciliation complete | PENDING | PENDING |
| Service owner accepts agreed restored scope / RTO end | PENDING | PENDING |
| Observed recovery-point gap (disruption minus verified point) | PENDING | PENDING |
| Observed total recovery time (acceptance minus disruption) | PENDING | PENDING |
| Approved objectives met? | NOT EVALUATED until targets and evidence exist | PENDING |

## Validation results

Use PASS, FAIL or NOT RUN, with evidence and limitations. Every negative-path check must be confined to synthetic disposable resources.

| Check | Result / evidence / limitation |
| --- | --- |
| Matched schema/artifact starts on the disposable validation copy | NOT RUN |
| Liveness and DB/bucket readiness | NOT RUN |
| Required document bytes match manifest and available DB checksums | NOT RUN |
| Missing/wrong-version object is detected and prevents acceptance | NOT RUN |
| Private objects and cross-customer/insurer access remain restricted | NOT RUN |
| Identity/MFA/session behavior and compromise response decision | NOT RUN |
| Quarantined, tombstoned and pending-deletion objects remain unavailable | NOT RUN |
| Privacy/legal holds and audit continuity remain intact | NOT RUN |
| Synthetic business totals and representative relationships agree | NOT RUN |
| Pending jobs/callbacks reviewed; external outcomes reconciled before replay | NOT RUN |
| Backup/restore failure alert reaches primary or fallback owner | NOT RUN |
| Incident handoff accepted by named recipient | NOT RUN |
| Encryption/key recovery checks pass in the named environment | NOT RUN |

## Findings, acceptance and cleanup

For each failure or unperformed check, record impact, accountable owner, required correction, agreed due date and retest evidence. Distinguish a synthetic matching test from an actual PostgreSQL/provider restore; neither proves the other's behavior. Local plaintext fixtures cannot prove production encryption, recovery scale, residency or retention compliance.

Record reviewer acceptance of the evidence, service-owner acceptance of measured recovery scope, and any remaining go-live blockers. Keep original results after a retest; link the superseding result.

List disposable resource IDs, authorised cleanup scope, any preservation holds, cleanup operator/time and confirmation evidence. Verify cleanup affected only exercise resources. Retain the evidence and manifests for the approved period in the restricted store; do not destroy source backups, incident evidence, production data or local project databases.
