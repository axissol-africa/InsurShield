# Deployment

The stack is deliberately host-agnostic. Nothing in the code names a cloud
provider: the database is reached through `DATABASE_URL`, documents through the
S3 API, and the API ships as a container. Moving from a laptop to AWS is a
change of environment variables, not a change of code.

| Concern | Local | Production (AWS) |
| --- | --- | --- |
| Database | Postgres 17 in Docker | Amazon RDS for PostgreSQL 17 |
| Documents | MinIO (S3-compatible) | Amazon S3 |
| Identity | Better Auth inside the API, sessions in Postgres | Better Auth inside the API, sessions in RDS PostgreSQL |
| API | `npm run dev:api` | Container on ECS / App Runner / Fly.io / Render |
| Frontend | Vite dev server | Static build at the same-site application hostname, for example S3 + CloudFront at `app.insurshield.zm` |

## Before going live

The deployment examples below depend on two open decisions:

1. **Where the API runs.** The Dockerfile runs anywhere that takes a container.
   ECS Fargate or App Runner keep it in the same VPC and region as RDS, which is
   the simplest network and compliance story. Fly.io has a Johannesburg region,
   the closest to Zambia.
2. **Region and data residency.** `af-south-1` (Cape Town) is the nearest AWS
   region to Zambia. InsurShield stores customer PII, consent records and
   insurance documents, so confirm what PIA and Zambian data-protection law
   require of where that data lives **before** provisioning. This is a
   regulatory question, not a technical one.

Follow the [operations runbooks](runbooks/README.md) for staging, production,
alerts, data protection and recovery. Use the candidate release gate described
below after the accountable owners approve the evidence.

## Building the images

Both are built from the repository root, not from `apps/api/`:

```bash
# the API that serves traffic
docker build -f apps/api/Dockerfile -t insurshield-api .

# a separate image that only applies migrations
docker build -f apps/api/Dockerfile --target migrator -t insurshield-migrator .
```

The build uses `turbo prune` to emit a backend-only workspace, so the React
frontend is never pulled into the API image. Both images hold only the
production dependencies; the `migrator` image adds the migrations in
`apps/api/drizzle/` and runs the migration entry point instead of the API.

Run migrations as a release step, before the new version takes traffic:

```bash
docker run --rm -e DATABASE_URL=... insurshield-migrator
```

This maps onto Fly's `release_command`, an ECS one-off task, or a Render
pre-deploy command. The image runs `node dist/db/migrate.js`, the build of
`apps/api/src/db/migrate.ts` that `npm run db:migrate` runs: it applies only
committed migrations, never generates one and never prompts. It exits 0 when the
database is up to date and 1, having changed nothing, when it refuses a database
it does not recognise or a migration fails. It requires PostgreSQL 17.

### A database created by the Prisma build

The migration that introduced Drizzle renames every money and rate column, so the
Prisma build of the API fails on a database once it is converted. Upgrading such a
database is an offline cutover: stop every old API process, back up the database,
run the migrator, then start the new build. Rolling back is restoring the backup.
If the migrator refuses because of the data, nothing has changed: correct the rows
of each column it names (the message gives each column and a count, never values)
and run it again.

## Environment variables

`apps/api/.env.example` documents all of them, and the [README's Configuration table](../README.md#configuration)
lists them. `NODE_ENV` is required—there is no application default. What changes in production:

```bash
NODE_ENV=production
PORT=4000
CORS_ORIGINS=https://app.insurshield.zm      # the real frontend origin, not localhost

# Cookie-session identity. Generate a distinct, high-entropy secret for each
# environment and store it in the secret manager.
BETTER_AUTH_SECRET=replace-with-at-least-32-random-characters
BETTER_AUTH_URL=https://api.insurshield.zm
# 1 for one load balancer; 2 only when CloudFront is in front of that load
# balancer. The API must be reachable only through those trusted proxies.
TRUST_PROXY_HOPS=1
AUTH_RATE_LIMIT=on

# Use the approved trust roots and require database hostname verification.
DATABASE_URL=postgresql://USER:PASSWORD@db.xxxx.af-south-1.rds.amazonaws.com:5432/insurshield?sslmode=verify-full

# Real S3: drop the MinIO-only settings.
# S3_ENDPOINT            — remove entirely
# S3_FORCE_PATH_STYLE    — remove entirely
S3_REGION=af-south-1
S3_BUCKET=insurshield-documents-prod
S3_SSE=AES256                                 # MinIO rejects this; S3 requires it be valid

# S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY — omit both on AWS. With no static
# keys the SDK uses the task or instance IAM role, which is what you want.
```

Hold the database password and any insurer client secrets in AWS Secrets
Manager or SSM Parameter Store and inject them at task start. Never bake them
into an image or commit them.

## Identity and reverse proxy

Better Auth runs inside the API and stores its sessions in PostgreSQL. The browser receives an HTTP-only,
`SameSite=Lax` session cookie from `/<API_PREFIX>/identity`. In production it is a secure cookie, so the web app and
API must be served on the **same site** (for example `https://app.insurshield.zm` and
`https://api.insurshield.zm`) over HTTPS. An unrelated frontend domain is not supported: its browser requests would
not reliably carry the session cookie.

`VITE_API_MODE=http` and `VITE_API_BASE_URL=https://api.insurshield.zm` must be set when building the frontend.
Set `CORS_ORIGINS` to the exact frontend origin and ensure credentialed CORS requests are allowed. Do not add a
wildcard origin.

The reverse proxy or load balancer must:

- Forward `/<API_PREFIX>/identity/*` unchanged, including the original HTTP method, request body and
  `Content-Length` header. Do not buffer, strip or rewrite identity request bodies.
- Forward `Cookie`, `Origin` and `X-InsurShield-User` request headers, and pass every `Set-Cookie` response header
  back to the browser without rewriting away its security attributes.
- Set the standard forwarding headers itself. The API trusts precisely `TRUST_PROXY_HOPS` proxy hops to derive the
  client address for consent records and identity rate limits; it must not be publicly reachable around those
  proxies. Set `0` only for direct local development.

The identity session has a fixed seven-day lifetime; API reads do not silently renew it. Password-reset and
email-verification delivery must stay disabled in production until a verified mail provider and sender are available.

Production checks PostgreSQL's `sslmode=verify-full`, HTTPS identity and
browser origins, and HTTPS for configured mail and object-storage endpoints.
Supply the approved CA material where the platform trust store does not
already trust the provider certificate. Record transport and encryption
settings for the selected environment in the release evidence.

### Object-storage encryption

`S3_SSE` is the only setting that cannot be identical in both places. MinIO
answers `501 NotImplemented` to the server-side-encryption header, while S3
accepts it. It is therefore unset locally and set to `AES256` on AWS. S3 also
encrypts new objects at the bucket level by default, so this is a second layer
rather than the only protection.

### Upload scanning

Set `MALWARE_SCANNER=clamd` and supply the private or loopback IP in
`CLAMD_ADDRESS` and the TCP port in `CLAMD_PORT`. Keep the daemon on the
same host or protect a remote hop with approved encrypted transport. The
native ClamAV TCP protocol sends file bytes without transport encryption.
Configure the daemon's `StreamMaxLength` to cover `MAX_UPLOAD_BYTES`, and
verify signature updates and alert delivery in staging. An unavailable
daemon or an inconclusive response prevents the upload from being accepted.

## AWS resources to provision

- **RDS PostgreSQL 17**, private subnets, not publicly accessible. Enable
  automated backups and point-in-time recovery — this is insurance data.
- **S3 bucket** with *Block all public access* on, default encryption on, and
  versioning on. The application only ever issues signed URLs; nothing in the
  bucket should be world-readable. Consider a lifecycle rule to transition old
  inspection photos to Infrequent Access.
- **Security group** allowing 5432 only from the API's security group.
- **Secrets Manager** entries for the database URL and insurer credentials.
- **CloudWatch** log group for the container, with a retention policy.

## Health checks

Point the load balancer at `GET /health` — it is cheap and touches nothing.
Use `GET /health/ready` for deploy gates and alerting; it verifies Postgres and
the document bucket, returning `200` only when both are reachable. If either is
unreachable, it returns `503` with `"status":"down"` and the state of each dependency.

Both paths sit outside the `API_PREFIX`, so they are `/health`, not
`/api/v1/health`.

## API observability

Collect the JSON event payloads from the API process logs. Use
`http.request.completed` and `http.request.failed` for request diagnostics
and `http.client.completed` for outbound mail and insurer HTTP calls.
Use the response's `X-Correlation-Id` to look up a reported issue.
Request and client span records include trace and span IDs for linking work
across the handlers and adapters that emit them.

Build traffic, error and latency dashboards from the `http.metrics`
delta windows. Use each window's duration and combine the route, method
and status-class series across instances. Treat `__overflow__` as a combined
series and monitor reported dropped logs. The latency buckets include two
and five seconds for the API and quote acknowledgement targets. Keep logs
access-controlled.
Operations must configure and exercise alerts with the on-call owner before
release. See the [incident response runbook](runbooks/incident-response.md).

## Frontend

Build the static release artifact with `npm run build:release -w @insurshield/web`
and publish `apps/web/dist`. Set `VITE_API_MODE=http` and `VITE_API_BASE_URL`
to the deployed HTTPS API base URL or an explicit same-origin path served
through the gateway. When using separate hostnames, serve both from the same
site for session cookies. The regular development build supports browser storage
for demonstrations.

The release build provides Brotli and gzip variants for HTML, JavaScript
and CSS. Configure the host or CDN to negotiate these encodings, set the
original content type and return `Vary: Accept-Encoding`. The public URLs
continue to use their original extensions. Keep the prior release's
fingerprinted assets available during rollout, and serve HTML and `sw.js`
with revalidation. The worker keeps one prior set of scripts and styles for
open offline tabs and serves the current HTML on new navigations.

## Release evidence

Create a restricted evidence file from [the pending template](../scripts/release-gate.example.json).
Record the full commit SHA of the candidate and include the exact API image,
migrator and frontend artifact identifiers in the linked evidence.
Give each criterion in [requirements section 12](requirements-spec.md#12-mvp-release-acceptance)
a named accountable approval and traceable evidence. Keep the evidence file
and the linked records in a release system writable only by authorised reviewers.

An approved criterion has `status` set to `passed`, a named `approvedBy`,
a UTC ISO timestamp `approvedAt`, and an `evidence` array of HTTPS links.
Use links without embedded credentials, query strings or temporary access tokens.
For criterion `12.11`, record any formally accepted high or critical defect in
`acceptedDefects` with its `reference`, `severity`, `owner`, documented
`workaround`, `approvedBy`, `approvedAt` and `evidence`. Link the defect
register and use an empty `acceptedDefects` list when there are no exceptions.

Pass the commit from the trusted build record when checking the candidate:

```bash
npm run release:check -- "$RELEASE_EVIDENCE_FILE" "$RELEASE_COMMIT_SHA"
```

The command blocks on incomplete, invalid or mismatched evidence. The release
owner verifies that links resolve to authentic approvals and results, then uses
the result to decide whether to promote the artifacts. The API also checks for
stand-ins and verifies every active platform rule before opening its production
port. A production request that depends on an expired approval cannot use a
provisional rule. Configure and confirm new rule versions before older ones end.
For a new production database, prepare and review the one-time rule
provisioning migration with the accountable approvers before the first API
start. Record the approved values, effective dates, responsible identities
and audit references in the restricted release evidence. Verify on staging
that it creates the confirmed versions the startup check expects.

## Dependency advisories

Run `npm audit --omit=dev` before a release: it lists the advisories in what the
images ship. Upgrade an affected package in its own change, with the checks run
again, rather than with `npm audit fix --force`, which may move a package back a
major version.
