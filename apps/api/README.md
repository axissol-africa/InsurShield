# InsurShield backend

NestJS API over PostgreSQL (Drizzle ORM) with S3-compatible object storage for
documents. Part of the InsurShield monorepo — see the [root README](../../README.md).

The REST surface it implements is specified in
[`apps/web/src/api/contracts.js`](../web/src/api/contracts.js); the
server-to-server rules are in [`docs/INSURER_API_INTEGRATION.md`](../../docs/INSURER_API_INTEGRATION.md).

## Local development

Node.js 24.15 or newer and Docker are required. From the **repo root**, copy both environment files and replace
every `CHANGE_ME` (the [root README](../../README.md#configuration) lists each variable):

```bash
cp .env.example .env && cp apps/api/.env.example apps/api/.env
npm run setup      # install, start Postgres + MinIO, migrate, seed
npm run dev:api    # http://localhost:4000
```

`npm run setup` is the long form of:

```bash
npm install
npm run infra:up            # docker compose up -d
npm run db:migrate -w @insurshield/api
npm run db:seed -w @insurshield/api
```

Check the API is wired up with:

```bash
curl localhost:4000/health        # process is alive
curl localhost:4000/health/ready  # Postgres and the bucket are reachable
```

`/health/ready` returns `{"status":"up","dependencies":{"database":"up","storage":"up"}}`
when everything is connected. Use `/health` for load-balancer liveness checks —
it never touches a dependency.

## Local services

| Service | Address | Credentials |
| --- | --- | --- |
| Postgres | `127.0.0.1:<POSTGRES_PORT>` | `POSTGRES_USER` / `POSTGRES_PASSWORD`, database `POSTGRES_DB` |
| MinIO API | `127.0.0.1:<MINIO_API_PORT>` | `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` |
| MinIO console | `http://127.0.0.1:<MINIO_CONSOLE_PORT>` | same as above |

All are defined in [`docker-compose.yml`](../../docker-compose.yml) at the repo root and take their values from
the root `.env`. The `S3_BUCKET` bucket is created private on first boot. See the
[root README's development-database reset](../../README.md#resetting-a-development-database-for-better-auth) before
switching an existing checkout to Better Auth.

## Database commands

Run from `apps/api/`, or with `-w @insurshield/api` from the root.

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Apply the migrations in `drizzle/` through [`src/db/migrate.ts`](src/db/migrate.ts), in development and production alike |
| `npm run db:seed` | Load reference data, credential users, staff accounts and demo records ([`scripts/seed.ts`](scripts/seed.ts)). Idempotent |
| `npm run db:studio` | Open Drizzle Studio to browse the data |

`db:migrate` recognises an empty database, a Drizzle-managed one with pending migrations, and one the earlier
Prisma build created (which it converts, see the [root README](../../README.md#upgrading-a-database-created-by-the-prisma-build));
it refuses anything else without changing it. Always apply migrations with it, never with `drizzle-kit migrate`.

### Changing the schema

Edit [`src/db/schema.ts`](src/db/schema.ts), then generate the migration and read it before committing it:

```bash
npm exec -w @insurshield/api -- drizzle-kit generate --name describe_your_change
```

This writes a SQL file and a snapshot under `drizzle/` — **commit both**. Write a migration that renames a column
or changes its type by hand. `db:migrate` also compares the database with the expected catalog in
`drizzle/catalog/<migration>.json` after each migration (see [`src/db/migrator.ts`](src/db/migrator.ts)), so a new
migration needs its catalog file as well. [`test/schema.e2e-spec.ts`](test/schema.e2e-spec.ts) takes the
migrations from `drizzle/meta/_journal.json`; build the API, then run that spec alone with `REGENERATE_CATALOGS=1`
to write the file (it needs `TEST_DATABASE_URL`, like every e2e spec, and in this mode the e2e setup leaves the
shared test database unmigrated, so run no other spec with it), run it again without the flag, and read the diff
of `drizzle/catalog/` before committing it: only the new migration's file should appear.

```bash
npm run build -w @insurshield/api
REGENERATE_CATALOGS=1 npm exec -w @insurshield/api -- vitest run --config ./vitest.config.e2e.ts test/schema.e2e-spec.ts
npm exec -w @insurshield/api -- vitest run --config ./vitest.config.e2e.ts test/schema.e2e-spec.ts
```

Never edit an applied migration.

## Identity

[Better Auth](https://www.better-auth.com/) runs inside this API and stores email-and-password credentials and
database-backed sessions in PostgreSQL. The identity endpoints live below
`/<API_PREFIX>/identity`; the application endpoints remain `GET /auth/me` and `POST /auth/consent`.
`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `TRUST_PROXY_HOPS` and an explicit `NODE_ENV` are required at startup.
See [the root configuration table](../../README.md#configuration) for every setting and the deployment guide for the
same-site and proxy requirements.

The browser authenticates with the HTTP-only session cookie that Better Auth sets. It is `SameSite=Lax`, becomes
`Secure` on HTTPS, and has a fixed seven-day lifetime. The API does not accept a browser bearer token. The cookie
is sent only with credentialed requests to a same-site API origin, so the deployed frontend and API must be under the
same site and the API's `CORS_ORIGINS` must include the frontend origin.

| Concern | Lives in |
| --- | --- |
| Credential hash, session, account recovery token and rate-limit records | PostgreSQL Better Auth tables |
| Staff role and insurer tenancy | `staff_users` in PostgreSQL |
| Customer profile, consent records and all product data | PostgreSQL domain tables |

`customers.userId` and `staff_users.userId` link the domain rows to the Better Auth user. A user with no matching
domain row, or more than one, is refused; roles are never inferred from a browser request. The seed creates the
staff and demo credential users from `SEED_STAFF_PASSWORD` and only links rows it created itself.

### Verification and recovery — deferred delivery

The application has no email or SMS provider configured yet. Password-reset and email-verification links are
available only in local development and test flows; production keeps those routes unavailable until a delivery
provider and verified sender are configured. Sign-in does not currently require verified email or phone ownership.
Adding either channel later requires a new design for registration, verification, recovery and abandoned contact
reservations rather than a source-only toggle.

## Browsing the database

`npm run db:studio` opens Drizzle Studio, which is schema-aware and good for
quick edits. For a full SQL client, connect DBeaver (or any Postgres tool) to
the Compose database while `npm run infra:up` is running:

| Setting | Value |
| --- | --- |
| Host | `127.0.0.1` |
| Port | `POSTGRES_PORT` |
| Database | `POSTGRES_DB` |
| Username | `POSTGRES_USER` |
| Password | `POSTGRES_PASSWORD` |
| SSL | off (local only) |

In DBeaver: **Database → New Database Connection → PostgreSQL**, fill in the
above, and let it download the driver if prompted. The tables are under
**insurshield → Schemas → public → Tables**.

Table names are snake_case (`quote_requests`, `insurer_quotes`). Column names
are camelCase, as the earlier Prisma schema created them, and therefore need
double quotes in raw SQL. Money columns hold ngwee and end in `Minor`; rates hold
basis points and end in `Bps`:

```sql
select name, "rateBps" from insurers order by name;
```

Connecting to RDS later uses the same steps with the RDS endpoint and **SSL
mode: require**.

## Documents

Uploaded files never go into Postgres. [`StorageService`](src/storage/storage.service.ts)
writes them to a private bucket and the database stores only metadata and the
object key (the `documents` table). Downloads are always short-lived signed URLs
— `S3_SIGNED_URL_TTL_SECONDS`, 60s by default. The bucket is not publicly
readable; an unsigned request returns 403. A link is only ever signed for a
document whose scan came back clean.

Locally this is MinIO. In production it is S3, through the same code path.

## Configuration

Every variable is validated at boot by [`src/config/env.ts`](src/config/env.ts);
a missing or malformed value stops startup with a list of what is wrong, rather
than failing later inside a request. See [`.env.example`](.env.example) and the
[root README's Configuration table](../../README.md#configuration) for the full set.

## Checks

```bash
npm run build
npm run lint
npm test
npm run test:e2e   # needs TEST_DATABASE_URL and a current build
```
