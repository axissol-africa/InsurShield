# InsurShield

Zambian motor-insurance marketplace: customers compare final quotes from every approved insurer, pay, and receive the insurer-issued policy certificate; insurers and the InsurShield administrator work from their own portals.

This is a monorepo managed with [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) and [Turborepo](https://turborepo.dev). Repository working rules are in [AGENTS.md](AGENTS.md), with additional instructions in each application.

| Workspace / folder | Contents |
| --- | --- |
| [`apps/web/`](apps/web/) | `@insurshield/web`: the web app (React 19 + Vite PWA). See [`apps/web/README.md`](apps/web/README.md), [`apps/web/ARCHITECTURE.md`](apps/web/ARCHITECTURE.md), and [web engineering rules](apps/web/AGENTS.md). |
| [`apps/api/`](apps/api/) | `@insurshield/api`: the API (NestJS 12 + PostgreSQL via Drizzle ORM). Implements the contract in [`apps/web/src/api/contracts.js`](apps/web/src/api/contracts.js). See [`apps/api/README.md`](apps/api/README.md) and [backend engineering rules](apps/api/AGENTS.md). |
| [`packages/`](packages/) | Shared packages consumed by both apps (currently empty). |
| [`docs/`](docs/) | [Deployment](docs/DEPLOYMENT.md), [insurer system integration](docs/INSURER_API_INTEGRATION.md), [customer entry / identity / consent flow](docs/CUSTOMER_ENTRY_IDENTITY_CONSENT_FLOW.md). |
| [`design/`](design/) | Original design references: the Stitch screen exports (`screens/<screen>/code.html` + `screen.png`) and the original design-system notes. The live design tokens are in `apps/web/src/index.css` and `apps/web/DESIGN.md`. |
| [`infra/`](infra/) | Local infrastructure configuration for PostgreSQL and Keycloak. Docker Compose remains at the repository root. |
| [`output/`](output/) | Versioned Word documents and Zoho backlog exports. |
| [`scripts/`](scripts/) | Repository scripts, including the Zoho backlog generator. |

## Quick start

Use Node.js 24.15 or newer in the Node 24 LTS line, npm 11.13 or newer in the npm 11 line, and Docker. Copy both
environment files and replace every `CHANGE_ME` (see [Configuration](#configuration)); then one command installs every
workspace, starts Postgres, MinIO and Keycloak, applies migrations and loads reference data:

```bash
cp .env.example .env && cp apps/api/.env.example apps/api/.env   # then replace every CHANGE_ME
npm run setup
```

Then run both apps together:

```bash
npm run dev
```

The frontend serves on http://localhost:5173 and the API on http://localhost:4000.
The frontend defaults to `VITE_API_MODE=mock` (browser storage, no backend
needed); set it to `http` in `apps/web/.env.local` to call the real API.

Or one at a time:

```bash
npm run dev:web   # frontend only
npm run dev:api   # backend only
```

Prototype credentials and the frontend-specific command list are in [`apps/web/README.md`](apps/web/README.md).

## Root commands

Every command below runs across all workspaces via Turborepo, which caches results and skips unchanged work.

| Command | What it does |
| --- | --- |
| `npm run dev` | Start frontend and backend in watch mode |
| `npm run build` | Build every workspace |
| `npm run test` | Run unit tests everywhere |
| `npm run test:cov` | Run tests with coverage |
| `npm run test:e2e` | Run end-to-end tests (Playwright for the frontend) |
| `npm run lint` | Lint every workspace |
| `npm run format` | Format every workspace that defines a `format` script |
| `npm run clean` | Remove build output, caches and `node_modules` |

### Local infrastructure

Postgres, MinIO and Keycloak run in Docker ([`docker-compose.yml`](docker-compose.yml)), with the settings in the root `.env`.

| Command | What it does |
| --- | --- |
| `npm run setup` | Install, start the services, migrate and seed — the one-shot first run |
| `npm run infra:up` | Start Postgres, MinIO and Keycloak |
| `npm run infra:down` | Stop them (add `-v` to the compose command to drop the data) |
| `npm run infra:logs` | Tail the service logs |
| `npm run db:migrate` | Apply the migrations in `apps/api/drizzle/` (`apps/api/src/db/migrate.ts`) |
| `npm run db:seed` | Load reference data, staff accounts and demo records (idempotent; `apps/api/scripts/seed.ts`) |
| `npm run db:studio` | Browse the database in Drizzle Studio |

| Service | Address | Credentials |
| --- | --- | --- |
| Postgres | `127.0.0.1:<POSTGRES_PORT>` | `POSTGRES_USER` / `POSTGRES_PASSWORD` from the root `.env` |
| MinIO console | `http://127.0.0.1:<MINIO_CONSOLE_PORT>` | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| Keycloak console | `http://127.0.0.1:<KEYCLOAK_PORT>` | `KEYCLOAK_ADMIN_USER` / `KEYCLOAK_ADMIN_PASSWORD` |

Target a single workspace with Turbo's filter, or npm's `-w`:

```bash
npx turbo run build --filter=@insurshield/web
npm run test -w @insurshield/api
```

## Adding a dependency

Always install into the workspace that needs it, from the root:

```bash
npm install axios -w @insurshield/web
npm install @nestjs/config -w @insurshield/api
npm install -D typescript -w @insurshield/api
```

## Configuration

Every setting comes from environment variables. `.env` files are local and git-ignored; each `.env.example`
documents its variables with `CHANGE_ME` placeholders, and the API and the seed refuse to run while one is left.
Error messages name a variable but never print its value.

### API (`apps/api/.env`, validated in [`apps/api/src/config/env.ts`](apps/api/src/config/env.ts))

| Variable | Required | Meaning |
| --- | --- | --- |
| `NODE_ENV` | no (`development`) | `development`, `test` or `production` |
| `PORT` | yes | Port the API listens on, 1–65535 |
| `API_PREFIX` | no (`api/v1`) | Route prefix; `/health` and `/health/ready` stay outside it |
| `CORS_ORIGINS` | yes | Comma-separated browser origins allowed to call the API |
| `DATABASE_URL` | yes | `postgres://` URL; only the parameters `sslmode`, `sslrootcert`, `sslcert`, `sslkey`, `application_name`, `schema` are accepted |
| `DATABASE_POOL_SIZE` | yes | Connections in the API's pool, 2–100 |
| `TEST_DATABASE_URL` | for e2e tests | A different database whose name ends in `_test`; the e2e and migration tests drop and recreate it |
| `SWAGGER_ENABLED` | no (`false`) | `true` serves Swagger UI at `/docs` |
| `KEYCLOAK_ISSUER` | yes | The realm's issuer URL; a token's `iss` must match it exactly |
| `KEYCLOAK_AUDIENCE` | yes | The audience the API expects in an access token |
| `KEYCLOAK_CLIENT_ID` | yes | Confidential client for administrative user management |
| `KEYCLOAK_CLIENT_SECRET` | yes | That client's secret; the same value as the root `.env` |
| `S3_ENDPOINT` | no | Object storage endpoint (MinIO locally); unset for AWS S3 |
| `S3_FORCE_PATH_STYLE` | no (`false`) | `true` for MinIO |
| `S3_REGION` | no (`us-east-1`) | Bucket region |
| `S3_BUCKET` | yes | Private bucket holding the documents |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | no | Static keys; omit both to use the instance or task IAM role |
| `S3_SIGNED_URL_TTL_SECONDS` | no (`300`) | Lifetime of a download link, at most 604800 |
| `S3_SSE` | no | Server-side encryption on upload: `AES256` or `aws:kms`; unset for MinIO |
| `S3_SSE_KMS_KEY_ID` | no | The KMS key for `S3_SSE=aws:kms` |
| `MAX_UPLOAD_BYTES` | no (`3145728`) | Largest accepted upload |

### Seed (`npm run db:seed`, read from the same `apps/api/.env`)

| Variable | Required | Meaning |
| --- | --- | --- |
| `SEED_STAFF_PASSWORD` | when Keycloak is configured | Password given to new staff accounts; `CHANGE_ME` is refused |
| `SEED_DEMO_DATA` | no (on) | `false` skips the demo records; never seed them in production |
| `SEED_RESET_DEMO` | no | `true` deletes the demo records and seeds them again, and frees the seeded NCD codes |
| `SEED_RESET_PASSWORDS` | no | `true` sets `SEED_STAFF_PASSWORD` on existing staff accounts too |

Without `KEYCLOAK_ISSUER` and `KEYCLOAK_CLIENT_SECRET` the seed loads only the reference data (PIA rate, insurers,
NCD codes) and skips the staff accounts and demo records. With them set but Keycloak unreachable, it loads the
reference data and then fails; run it again once Keycloak is up and it completes the rest.

### Local services (root `.env`, read by Compose)

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_TEST_DB`, `KEYCLOAK_DB`, `POSTGRES_PORT`,
`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `S3_BUCKET`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`, `KEYCLOAK_ADMIN_USER`,
`KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_CLIENT_SECRET` and `KEYCLOAK_PORT`, each described in
[`.env.example`](.env.example). Compose refuses to start while one is missing.

**Existing volumes keep their old credentials.** Postgres sets its password, and creates the test and Keycloak
databases, only when its data volume is new; Keycloak imports the realm, with its client secret, only when its
database is new. A `postgres-data` volume from an earlier checkout therefore still has the old Postgres password and
an old Keycloak database with the old `insurshield-api` client secret. Either put those old values in both `.env`
files, change them in Postgres (`ALTER ROLE`) and in the Keycloak admin console, or remove the volume
(`docker compose down -v`, which deletes all local data) and start again.

## Data and storage

The database schema is [`apps/api/src/db/schema.ts`](apps/api/src/db/schema.ts) (Drizzle ORM), with its
migrations in [`apps/api/drizzle/`](apps/api/drizzle/), modelled on the API contract. Two rules run through it:

- **Files never go in the database.** The `documents` table holds metadata and an
  object-storage key; the bytes live in a private bucket and are served as
  short-lived signed URLs. MinIO locally, S3 in production — the same code path.
- **Money is integer ngwee, never a float.** Amounts are stored as `bigint` minor units of ZMW and rates as
  basis points, so premiums reconcile exactly with the insurer's own quotation document; the API sends Kwacha
  and percentages.

### Upgrading a database created by the Prisma build

`npm run db:migrate` recognises a database the earlier Prisma build migrated and converts it in one transaction,
renaming every money and rate column (`"premium"` → `"premiumMinor"`, …). An older API build fails on a converted
database, so the cutover is offline:

1. Stop every API process of the old build.
2. Back up the database.
3. Run `npm run db:migrate` (or the migrator image).
4. Start the new build.

To roll back, restore the backup. If `db:migrate` refuses because of the data, nothing has changed: correct the rows
of each column it names (the message gives the column and a count, never values) and run it again.

A checkout that ran `prisma generate` still holds the old client in `apps/api/src/generated`; delete that folder
after switching to this version, because nothing ignores it now, so a build would compile it and a commit could
include it.

## Deployment

See [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In short: the API ships as a
container built from the repo root, the database is reached through
`DATABASE_URL`, and documents through the S3 API — so local Docker and AWS
(RDS + S3) differ only in configuration.

```bash
docker build -f apps/api/Dockerfile -t insurshield-api .
docker build -f apps/api/Dockerfile --target migrator -t insurshield-migrator .
```

## Conventions

- **One lockfile.** `package-lock.json` lives only at the repo root; workspaces must not have their own.
- **Keep shared tooling versions aligned.** Both workspaces currently share one hoisted copy of `vitest`. If the two packages pin different major versions of a test or build tool, npm hoists one and nests the other, and the nested copy can bind to the wrong instance at runtime. Bump them together.
- **Shared code goes in `packages/`.** Create `packages/<name>` with its own `package.json`, then depend on it as `"@insurshield/<name>": "*"` — npm links it automatically and Turbo orders builds accordingly.
- **Commit migrations.** `apps/api/drizzle/` (SQL, journal, snapshots and the expected catalogs) is committed; an applied migration is never edited.
- **Secrets stay out of the repo.** `.env` and `apps/api/.env` are ignored; each `.env.example` documents its variables with `CHANGE_ME` placeholders.
