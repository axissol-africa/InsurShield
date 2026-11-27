# Staging and production operation

Read [Deployment](../DEPLOYMENT.md) for supported build and migration commands, same-site identity, proxy headers and environment variables. This runbook deliberately adds no deployment command or new configuration flag.

## Staging

1. Record the staging account/project, network, database and bucket identifiers in a restricted change record. Verify they differ from production and from developers' project databases. Use separate secrets, access roles and sandbox integration accounts.
2. Record the application commit and image digest, frontend build, migrator digest, PostgreSQL version and applied migration history. Use the supported PostgreSQL 17 deployment baseline. Test the exact artifacts proposed for production.
3. Use synthetic data. Any use of copied personal data needs a separately approved scope, controls and disposal procedure; it is not part of the synthetic exercise in these runbooks.
4. Verify same-site HTTPS, exact CORS origins, credentialed sessions, proxy header forwarding and the configured trusted proxy path. Confirm the API cannot be reached around that path. Confirm frontend HTTP mode; mock mode is not an integration test.
5. Verify staff MFA and permissions, customer isolation, denied cross-insurer access, protected document download and rejection of expired sessions. Exercise sandbox timeouts, duplicate callbacks, financial reconciliation and manual fallback. Capture safe test identifiers and results, not cookies or document URLs.
6. Demonstrate alert delivery and named-owner acknowledgement. Run the [recovery exercise](exercise-evidence.md). Record untested infrastructure properties separately from passing functional checks.
7. Hand the exact artifact set, results, outstanding issues and approval references to the production release owner. Staging success alone is not permission to deploy.

## Production readiness and change sequence

1. Confirm approved hosting/residency, encryption/key access, legal procedure, retention, RPO/RTO and contacts. Link evidence for requirements section 12 and formal go-live approval. Record unresolved critical/high defects and any formal acceptance with workaround and owner.
2. Identify the environment by provider resource identity, not its friendly name alone. Confirm least-privilege operator access and independent recovery access. Never expose connection strings or secret values in the change log.
3. Verify a usable database backup and matching object recovery set, including access to encryption keys. Record the last successful restore exercise and its scope. Define the rollback boundary before a schema change: an old image may not work with a new schema.
4. Follow the approved change plan using the existing migrator and deployment procedure. Record migration output, applied history and artifact digests. Do not generate migrations during deployment. For incompatible cutovers, stop old writers as required by Deployment. Do not assume an application rollback reverses data changes.
5. Check `/health` for process liveness and `/health/ready` for database and bucket reachability, outside the API prefix. The latter checks `SELECT 1` and bucket HEAD; success does not prove object retrieval, correct contents, encryption, permissions or integration health.
6. Execute approved synthetic smoke tests through the real proxy: sign-in/session behavior, authorised and denied access, controlled document upload/download and relevant sandbox-safe workflow checks. Do not create financial effects in production without a separately approved test arrangement.
7. Observe the approved monitoring window and acceptance thresholds. If checks fail, stop traffic promotion and invoke the rollback or [recovery](backup-and-recovery.md) decision. Record owner acceptance before restoring normal traffic and background work.

## Encryption and hosting evidence

NFR-SEC-004 requires approved encryption in transit and at rest. Collect dated evidence against the actual environment; never infer it solely from `.env.example`, a successful handshake or a cloud default.

| Boundary | Demonstrable evidence | Approval / environment facts still required |
| --- | --- | --- |
| Browser to edge/API | Certificate chain and hostname verification, HTTPS behavior, cookie flags, proxy route test | Approved TLS policy, termination points, certificate renewal owner |
| Edge to API | Network path/configuration and negotiated transport on that hop | Approved end-to-end design; any unencrypted internal hop requires explicit review |
| API to PostgreSQL | Actual connection TLS negotiation and peer validation; connection/certificate configuration with secrets redacted | Approved trust roots and authentication mode; `sslmode=require` in a sample is not proof of hostname validation |
| API to object storage | Actual HTTPS endpoint and certificate validation, controlled private-object request | Approved endpoints, transport policy and network restrictions |
| Database and backups at rest | Provider encryption settings for database, snapshots, logs/archives and replicas; successful restore/decrypt check | Approved algorithm/key service, key ownership, recovery permissions, retention and region |
| Bucket and object versions | Bucket policy/configuration, object-version encryption metadata, public-access controls, successful authorised read | Approved encryption mode/key, version lifecycle, replica location and disposal rules |
| Logs and evidence | Storage/access policy, encryption settings, retention configuration and restricted evidence access test | Approved contents, locations, readers and retention period |

The storage adapter supports `S3_SSE` and a KMS key setting, but configuration does not prove all historic versions are encrypted or recoverable. Local MinIO without the production SSE setting is not production at-rest evidence. Versioning does not by itself establish independent backup or protection against privileged deletion. Retain evidence references for key availability and restore permissions without copying key material.

## Runtime constraints

The [job runner](../../apps/api/src/jobs/job-runner.service.ts) starts through normal API startup and may write to the database. Network isolation alone does not stop internal retention or queued work. No dedicated recovery pause flag is established by these runbooks. Restore operators must keep API processes stopped during offline validation; application smoke tests use a disposable copy whose jobs and outbound effects have been reviewed and contained. Production worker suspension/resumption must be documented in the environment's approved operational procedure.
