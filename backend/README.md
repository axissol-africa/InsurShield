# InsurShield backend

NestJS API over PostgreSQL (Prisma) with S3-compatible object storage for
documents. Part of the InsurShield monorepo — see the [root README](../README.md).

The REST surface it implements is specified in
[`frontend/src/api/contracts.js`](../frontend/src/api/contracts.js); the
server-to-server rules are in [`docs/INSURER_API_INTEGRATION.md`](../docs/INSURER_API_INTEGRATION.md).

## Local development

Node.js 24 LTS and Docker are required. From the **repo root**:

```bash
npm run setup      # install, start Postgres + MinIO, migrate, seed
npm run dev:api    # http://localhost:4000
```

`npm run setup` is the long form of:

```bash
npm install
npm run infra:up            # docker compose up -d
npm run db:migrate -w backend
npm run db:seed -w backend
```

Copy `.env.example` to `.env` first; it is already pointed at the Compose
services. Check the API is wired up with:

```bash
curl localhost:4000/health        # process is alive
curl localhost:4000/health/ready  # Postgres and the bucket are reachable
```

`/health/ready` returns `{"status":"up","dependencies":{"database":"up","storage":"up"}}`
when everything is connected. Use `/health` for load-balancer liveness checks —
it never touches a dependency.

## Local services

| Service | URL | Credentials |
| --- | --- | --- |
| Postgres | `localhost:5432` | `insurshield` / `insurshield`, database `insurshield` |
| MinIO API | `localhost:9000` | `insurshield` / `insurshield-dev-secret` |
| MinIO console | http://localhost:9001 | same as above |

Both are defined in [`docker-compose.yml`](../docker-compose.yml) at the repo root.
The `insurshield-documents` bucket is created private on first boot.

## Database commands

Run from `backend/`, or with `-w backend` from the root.

| Command | What it does |
| --- | --- |
| `npm run db:migrate` | Create and apply a migration from schema changes (development) |
| `npm run db:deploy` | Apply existing migrations without generating one (production) |
| `npm run db:seed` | Load reference data — PIA rate, insurers, NCD codes. Idempotent |
| `npm run db:reset` | Drop, re-migrate and re-seed. **Destroys all local data** |
| `npm run db:studio` | Open Prisma Studio to browse the data |
| `npm run db:generate` | Regenerate the Prisma client (also runs on install) |

### Changing the schema

Edit [`prisma/schema.prisma`](prisma/schema.prisma), then:

```bash
npm run db:migrate -- --name describe_your_change
```

This writes a new folder under `prisma/migrations/` — **commit it**. The
generated client in `src/generated/` is *not* committed; it is rebuilt on every
install and by `npm run db:generate`.

Prisma 7 no longer reads the connection URL from `schema.prisma`. Migration
commands take it from [`prisma.config.ts`](prisma.config.ts); the running app
connects through the `pg` driver adapter in
[`src/prisma/prisma.service.ts`](src/prisma/prisma.service.ts).

## Identity

Sign-in and sign-up run on [Keycloak](https://www.keycloak.org/), self-hosted
alongside the API. This API issues no tokens and never sees a password: it
verifies Keycloak's access tokens against the realm's JWKS, pinning both the
issuer and the audience.

Keycloak owns credentials, sessions and realm roles. This service owns the
domain rows and joins to them on the token's `sub`, stored as `keycloakId`.

| Concern | Lives in |
| --- | --- |
| Password, session, MFA, password reset | Keycloak |
| Realm roles (`super_admin`, `admin`, `insurer_user`, `customer`) | Keycloak |
| `StaffUser.insurerId`, consent records, everything domain | Postgres |

The realm is defined in [`infra/keycloak/realm-insurshield.json`](../infra/keycloak/realm-insurshield.json)
and imported on boot, so every environment is reproducible. Its
`_productionNotes` list what must change before this leaves localhost.

| Service | URL | Credentials |
| --- | --- | --- |
| Keycloak admin console | http://localhost:8080 | `admin` / `admin` |
| Realm | `insurshield` | |
| Seeded staff | `admin@insurshield.zm` | `insurshield-dev` |
| Seeded insurer portals | `insurer@<insurer>.zm` | `insurshield-dev` |

Staff are provisioned by the seed through Keycloak's Admin API using the API's
own service account, then linked to a `StaffUser` row. Customers are different:
they sign up in Keycloak directly, and their `Customer` row is created on their
first authenticated call. A staff role in a token with no matching row is
refused rather than honoured, so an account cannot promote itself.

### Phone verification — parked

Keycloak provides TOTP but **not SMS OTP**, and the customer flow calls for an
SMS code to a Zambian mobile at registration and password reset. That work is
parked: the `OtpChallenge` model, the `OtpPurpose` enum and
`Customer.phoneVerifiedAt` are commented out in
[`prisma/schema.prisma`](prisma/schema.prisma) and dropped from the database.

Until it returns, a customer provisioned from Keycloak gets a placeholder
`phone` of `pending:<keycloak-sub>`, namespaced so the unique constraint holds.
Nothing reads it as a real number.

To restore: uncomment the three blocks, run `npm run db:migrate`, and decide
between handling OTP in this API or deploying an SMS SPI into Keycloak.

## Browsing the database

`npm run db:studio` opens Prisma Studio, which is schema-aware and good for
quick edits. For a full SQL client, connect DBeaver (or any Postgres tool) to
the Compose database while `npm run infra:up` is running:

| Setting | Value |
| --- | --- |
| Host | `localhost` |
| Port | `5432` |
| Database | `insurshield` |
| Username | `insurshield` |
| Password | `insurshield` |
| SSL | off (local only) |

In DBeaver: **Database → New Database Connection → PostgreSQL**, fill in the
above, and let it download the driver if prompted. The tables are under
**insurshield → Schemas → public → Tables**.

Table names are snake_case (`quote_requests`, `insurer_quotes`), because the
schema maps Prisma's camelCase models with `@@map`. Column names stay camelCase
and therefore need double quotes in raw SQL:

```sql
select name, "ratePercentage" from insurers order by name;
```

Connecting to RDS later uses the same steps with the RDS endpoint and **SSL
mode: require**.

## Documents

Uploaded files never go into Postgres. [`StorageService`](src/storage/storage.service.ts)
writes them to a private bucket and the database stores only metadata and the
object key (the `Document` model). Downloads are always short-lived signed URLs
— `S3_SIGNED_URL_TTL_SECONDS`, 300s by default. The bucket is not publicly
readable; an unsigned request returns 403.

Locally this is MinIO. In production it is S3, through the same code path.

## Configuration

Every variable is validated at boot by [`src/config/env.ts`](src/config/env.ts);
a missing or malformed value stops startup with a list of what is wrong, rather
than failing later inside a request. See [`.env.example`](.env.example) for the
full set.

## Checks

```bash
npm run build
npm run lint
npm test
```
