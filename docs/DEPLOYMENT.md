# Deployment

The stack is deliberately host-agnostic. Nothing in the code names a cloud
provider: the database is reached through `DATABASE_URL`, documents through the
S3 API, and the API ships as a container. Moving from a laptop to AWS is a
change of environment variables, not a change of code.

| Concern | Local | Production (AWS) |
| --- | --- | --- |
| Database | Postgres 17 in Docker | Amazon RDS for PostgreSQL 17 |
| Documents | MinIO (S3-compatible) | Amazon S3 |
| Identity | Keycloak in Docker (dev mode, H2-free, Postgres-backed) | Keycloak container, same VPC, Postgres on RDS |
| API | `npm run dev:api` | Container on ECS / App Runner / Fly.io / Render |
| Frontend | Vite dev server | Static build on S3 + CloudFront, or any static host |

## Before going live

Two decisions are still open and neither is a code change:

1. **Where the API runs.** The Dockerfile runs anywhere that takes a container.
   ECS Fargate or App Runner keep it in the same VPC and region as RDS, which is
   the simplest network and compliance story. Fly.io has a Johannesburg region,
   the closest to Zambia.
2. **Region and data residency.** `af-south-1` (Cape Town) is the nearest AWS
   region to Zambia. InsurShield stores customer PII, consent records and
   insurance documents, so confirm what PIA and Zambian data-protection law
   require of where that data lives **before** provisioning. This is a
   regulatory question, not a technical one.

## Building the images

Both are built from the repository root, not from `backend/`:

```bash
# the API that serves traffic
docker build -f backend/Dockerfile -t insurshield-api .

# a separate image that only applies migrations
docker build -f backend/Dockerfile --target migrator -t insurshield-migrator .
```

The build uses `turbo prune` to emit a backend-only workspace, so the React
frontend is never pulled into the API image. The Prisma CLI is kept out of the
runtime image too — that is what the `migrator` target is for.

Run migrations as a release step, before the new version takes traffic:

```bash
docker run --rm -e DATABASE_URL=... insurshield-migrator
```

This maps onto Fly's `release_command`, an ECS one-off task, or a Render
pre-deploy command. `prisma migrate deploy` only applies committed migrations —
it never generates one and never prompts.

## Environment variables

`backend/.env.example` documents all of them. What changes in production:

```bash
NODE_ENV=production
PORT=4000
CORS_ORIGINS=https://app.insurshield.zm      # the real frontend origin, not localhost

# RDS requires TLS.
DATABASE_URL=postgresql://USER:PASSWORD@db.xxxx.af-south-1.rds.amazonaws.com:5432/insurshield?sslmode=require

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

### The one deliberate local/production difference

`S3_SSE` is the only setting that cannot be identical in both places. MinIO
answers `501 NotImplemented` to the server-side-encryption header, while S3
accepts it. It is therefore unset locally and set to `AES256` on AWS. S3 also
encrypts new objects at the bucket level by default, so this is a second layer
rather than the only protection.

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
the document bucket and returns `"status":"down"` if either is unreachable.

Both paths sit outside the `API_PREFIX`, so they are `/health`, not
`/api/v1/health`.

## Frontend

The frontend is a static build (`npm run build -w frontend` → `frontend/dist`).
Set `VITE_API_MODE=http` and point `VITE_API_BASE_URL` at the deployed API. Any
static host works; S3 + CloudFront keeps it in the same account as the rest.

Note that the frontend currently defaults to `VITE_API_MODE=mock`, which serves
everything from browser storage. It must be switched to `http` for a real
deployment.

## Keycloak

Keycloak is self-hosted, which is what makes the data-residency question
answerable: customer identity data stays in your VPC and your region, unlike a
hosted identity provider.

Before it leaves localhost, work through `_productionNotes` in
[`infra/keycloak/realm-insurshield.json`](../infra/keycloak/realm-insurshield.json).
The ones that matter most:

- `sslRequired` must become `all`, with TLS terminated in front of Keycloak.
- Turn off `directAccessGrantsEnabled` on `insurshield-web`. It exists only so
  local scripts can fetch a token with a password; browsers use Authorization
  Code with PKCE.
- Replace the `insurshield-api` client secret with a generated value in Secrets
  Manager.
- Point `redirectUris` and `webOrigins` at the real frontend origin. A wildcard
  host is an open redirect.
- Configure `smtpServer`, or password reset and email verification silently fail.

Run Keycloak against its own database (`KC_DB=postgres`), separate from the
application database, and back it up: losing the realm means losing every
customer login.

## Dependency advisories

`npm audit` reports high-severity advisories against `mysql2` and
`deepmerge-ts`. Both arrive through the Prisma **CLI**, which npm installs
automatically because `@prisma/client` declares it as an optional peer
dependency. This service is Postgres-only and never loads the MySQL driver.

`npm audit fix --force` would downgrade Prisma from 7.10 to 6.x — a major
version backwards — so it is deliberately not applied. Instead the runtime image
drops the CLI entirely (see `backend/Dockerfile`), which removes those packages
from what actually ships. The remaining advisories affect development tooling
only.

Re-check this when Prisma 8 reaches a stable release; npm's `latest` tag
currently points at an 8.0 release candidate, which is why the project pins
7.10.0.
