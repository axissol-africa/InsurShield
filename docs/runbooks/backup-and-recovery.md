# Backup and recovery

This procedure supports NFR-REL-005 and section 12 acceptance. It describes operator steps, not an executed restore. Use an approved provider-specific procedure after the hosting decision; do not point a restore tool at a local project database or a live production database as an experiment.

## Objectives and approvals

**Recovery point objective (RPO)** is the maximum acceptable loss of committed business data expressed as time. For an exercise, record the simulated disruption time and the latest verified, mutually consistent database/object recovery point. Their difference is the observed recovery-point gap. A recent snapshot or configured backup interval alone does not prove that gap: check archive coverage, object availability and representative transactions.

**Recovery time objective (RTO)** is the maximum acceptable elapsed time from service disruption to validated restoration of the agreed service scope. Measure the exercise from simulated disruption to the service owner's acceptance of that scope, including detection, authorisation, provisioning, data restore, validation, reconciliation and traffic recovery. Also record restore-tool duration separately; it is not the whole RTO. If a contract uses a different start/end definition, record it explicitly and report both measures.

| Objective record | Required value |
| --- | --- |
| Service scope and degraded-service definition | Approved journeys/dependencies and acceptable restrictions |
| RPO and RTO targets | Approved durations, business owner, decision reference and approval date; otherwise PENDING |
| Backup/PITR coverage and cadence | Provider configuration and observed usable coverage; demonstrate support for approved RPO |
| Backup/version retention and disposal | Legal/Compliance-approved rule, holds/exceptions and owner; DEC-011 reference |
| Exercise frequency | Approved schedule, responsible operator and next exercise date |
| Restore access and key recovery | Named primary/backup operators and tested recovery procedure |

No numeric RPO/RTO, backup-retention period or exercise frequency is approved by this document.

## Capture a recoverable set

1. Inventory state: PostgreSQL (including identity, audit, jobs and workflow records), private object storage, deployed artifacts, migration history, configuration versions and access to required secrets/keys. Preserve configuration/secret version references separately; do not include plaintext secrets in a backup manifest.
2. Verify automated backups/PITR as configured in the selected environment and verify their usable range. Record successful completion and failure alerting, not just a configured schedule. Ensure backups and replicas meet the approved location and access policy.
3. Choose and document a consistency method. A controlled backup window can stop all writers, uploads, callbacks, retention and lifecycle activity, drain in-flight work, and capture a database snapshot plus the corresponding object-version inventory. A live PITR design instead needs demonstrated version coverage and mapping at the chosen recovery point. Database and object operations are not one atomic transaction; unresolved differences block acceptance of a complete recovery set.
4. Keep a restricted manifest: recovery-set ID, source environment identity, capture window in UTC, DB backup/snapshot or archive identifiers, recovery timestamp, PostgreSQL version, migration history/hash, application and migrator digests, configuration version references, and manifest integrity digest. Record bucket identity and region, each required storage key, selected object version ID, size, available checksum, encryption metadata and relevant delete marker. Storage keys can contain business references; keep the manifest out of general tickets and Git.
5. Verify independent recoverability and access controls. Document whether a credential compromise could delete both primary data and its recovery copies. Record protected-copy/immutability controls only when configured and tested. Apply approved lifecycle and hold rules to backups and noncurrent object versions; application deletion alone does not prove their erasure.

## Match database and object versions

The [storage adapter](../../apps/api/src/storage/storage.service.ts) writes and signs downloads by key; it does not persist or request a provider object version ID. Consequently, the latest bucket version is not an authoritative match for an earlier database recovery point.

For the selected database point, inventory referenced documents and their `storageKey`, `sizeBytes`, available `checksumSha256`, scan status and deletion state. Select versions from the recovery manifest/provider history, never merely the newest object or nearest timestamp. Verify bytes against the stored checksum when present. If a checksum is absent, record the gap and the approved alternative integrity evidence; an ETag is not assumed to be a SHA-256 digest. Review missing objects, overwritten versions, delete markers and orphan uploads explicitly.

Restore selected bytes into a new private bucket under the expected keys and verify the resulting current objects, since the application reads by key. Preserve the source version inventory and do not remove original versions/delete markers. Do not turn quarantined content into clean content or make tombstoned/pending-deletion documents available. Keep completed erasure, closed-account state, legal/privacy holds and audit evidence consistent with the recovery point and any later obligations. Restoring an older backup must not silently undo a lawful deletion or release a hold; Legal/Compliance and the application owner decide the reconciliation procedure before access resumes.

## Isolated restore

1. Open an exercise/incident record, choose the recovery set and obtain the required restore authority. For a drill, confirm synthetic data and newly created disposable resources. Record destination resource identities and prove they are not production or a developer's existing project database.
2. Keep API processes stopped. Isolate restored resources from customers, outbound payment/insurer/mail integrations and inbound callbacks. Use separate credentials and private storage. Prevent background lifecycle operations on the recovery copies through the approved infrastructure procedure.
3. Restore PostgreSQL into the new destination using the selected provider procedure. Record selected point, backup/archive coverage, tool versions, output and errors. Do not run migrations automatically against the only restored copy. First inspect migration history and select its compatible application artifact.
4. Restore the matched object set and validate manifest coverage, hashes/size where available, private access and encryption. Missing required evidence means a partial recovery, even if the database is healthy.
5. Perform offline/read-only checks: schema/history match, representative business records and relationships, money totals and reconciliation state, document references, audit continuity, identity/permissions, holds, tombstones and pending jobs. Record counts and safe references rather than personal contents. Never “repair” append-only audit records by overwriting them.
6. Preserve the validated restore copy. Use a separate disposable copy for application startup and synthetic smoke tests. Review queued jobs, expiring leases, retention intent and outbound deliveries before boot; startup may execute them. Contain external effects with approved sandbox adapters and credentials. If containment cannot be demonstrated, leave the API stopped and report application validation as unperformed.
7. Compare observed RPO/RTO to approved targets. If targets are pending, report measured durations without a pass verdict. Complete the [exercise evidence](exercise-evidence.md) and record defects, owners and retest requirements.

## Production recovery and return to service

The incident commander coordinates an approved maintenance boundary and routes to the named environment operators. Preserve the original environment and evidence. Restore into new isolated resources first; confirm artifact/schema compatibility and a matched object set before proposing cutover.

Reconcile payments, refunds, settlements, insurer issuance and callbacks against external records since the chosen recovery point. A database restore can lose idempotency records while an external provider has already completed the action. Do not bulk replay jobs or infer an unpaid/unissued outcome from restored database state alone. Finance and integration owners approve the specific replay/manual-resolution plan.

Security decides whether restored sessions, credentials and signing secrets remain trustworthy; follow the approved revocation/rotation process before access. Reconcile post-recovery-point privacy obligations with Legal/Compliance. Verify routing, TLS, permissions, document access and service checks. The service owner accepts measured loss, outstanding exceptions and the rollback boundary before traffic and workers resume in the approved order. Keep enhanced observation for the approved period, then record closure and follow-up exercise actions.

Dispose of temporary restores only after evidence acceptance and according to the approved retention/hold procedure. Record exact resource IDs and deletion evidence. Do not delete original backups or incident evidence as exercise cleanup.
