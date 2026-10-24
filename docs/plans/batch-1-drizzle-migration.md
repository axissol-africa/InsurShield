# Batch 1: Prisma to Drizzle, loan-ledger architecture and rules

Worktree `/Users/aubreyzulu/InsurShield-drizzle`, branch `feature/drizzle-migration`, branched from
`feature/insurer-dashboard-shadcn` at `cbef7b5` (the API exists only on that branch: 86 files ahead of `main`).
Revision 8 (2026-10-24), after plan reviews r1–r8. Edits are marked [r<n> <id>]; ids are Codex `C<n>-` and
reviewer agent `R<n>-` (round 1 without a number).

## 0. Decisions (user, 2026-10-24)

- "we need to migrate from prisma to drizzle. check out the loan ledger code base structure and copy all the rules
  and architecture, update nestjs, and refactor everything accordingly. also copy what's in the AGENTS.md file."
  Reference project: `/Users/aubreyzulu/loan-ledger-service` (package `ngwee`).
- D1 Layout: **loan-ledger layout, keeping the InsurShield domain rules.** Each module becomes
  `controller → service → repository`, with a pure `domain/` folder and `dto/`. No port interfaces with a single
  implementation. InsurShield rules that loan-ledger does not cover stay: insurer tenancy, state machines,
  idempotency, outbox, strategies, ports at external-provider boundaries (Keycloak, S3, insurers).
- D2 Schema: **baseline and conversion in this batch.** Money becomes integer minor units (`bigint` ngwee) and
  system timestamps become `timestamptz`.
- D3 Extras in: e2e tests against a real test database; configuration rules (no credentials in Compose or code,
  `CHANGE_ME` placeholders); Swagger UI at `/docs`. Not chosen: pinning Node in `.nvmrc`.
- "Update NestJS" is an explicit request, so it overrides the root rule "avoid dependency upgrades during structural
  changes". It is a minor update (12.1.0 → 12.2.0). [r1 R-M3]

## 1. Contract of this batch

Guaranteed:

1. The API serves the same HTTP contract to `apps/web` as at `cbef7b5`: routes, field names, Kwacha amounts as
   numbers with two decimals, rates as percentages, enum wire strings, ISO timestamps with milliseconds, and the
   error body `{ code, message, details }`. Exceptions: the new refusals of guarantee 8 and the Lusaka month
   buckets (C9). [r3 R3-L9]
2. No Prisma code or dependency is left in the running API, the image or the scripts.
3. Money is integer ngwee in storage and in every calculation; rates that multiply money are basis points.
4. A fresh database, an already-migrated Drizzle database, and a fully migrated Prisma-era database all reach the
   same final schema through `npm run db:migrate`, unless their data breaks a new constraint (a negative or `NaN` amount;
   a negative, `NaN` or above-100% rate), which is refused naming every failing column and its number of rows; any other state is refused. A refusal
   changes no schema, data or history row (a sequence counter may advance). [r6 C6-M2]
5. Converted values are exact: money ×100, rates ×100, and every timestamp keeps the instant the Prisma build read
   from it (`@prisma/adapter-pg` reads `timestamp(3)` as UTC wall time and writes DateTime arguments in UTC; 0001
   converts with `AT TIME ZONE 'UTC'`). [w1a gate]
6. A Prisma build pointed at a converted database fails loudly on any money query; it is never told it succeeded.
7. Tenancy and ownership are enforced in the services: an insurer user reaches only its insurer's records, a
   customer only their own, and document links follow guarantee 8.
8. Existing defects fixed (C8): document links only for principals related to the document; insurer-scoped,
   single NCD redemption; concurrent transitions and unique clashes answer `409`, not `500`; a reused payment key
   with a different request answers `409`; any other unique clash or deadlock answers `409 CONFLICT` or
   `503 TRY_AGAIN`, never `500`; database errors never put query parameters in logs or responses. `503 TRY_AGAIN`
   means the failed database operation was rolled back or never started (a connection was not obtained); a
   connection lost mid-statement answers `500`, because the outcome is unknown. [r3 R3-M3; W1b redesign]

Not guaranteed, with the reason:

- **Idempotent quote submission and claim notification.** The web generates a new key per call and never retries
  (`apps/web/src/api/http/index.js:37,70`, `newIdempotencyKey()`), so server-side replay would protect nothing
  without a web change. Batch 2 designs both sides together. The unused `IdempotencyInterceptor` is deleted; the
  `idempotency_records` table stays as it is. [r2 R2-M4, R2-M5, C2-M4]
- **A payment replay detects a changed mobile number.** Only its last four digits are stored; the comparison covers
  the stored fields (guarantee 8, P6 detail). [r2 C2-M2, R2-L1]
- **Admin totals above K70 trillion** may be refused with `500` rather than rounded: a Kwacha number is sent only when
  it parses back to the same ngwee exactly, which holds for every two-decimal value below 2^46 Kwacha (about
  K70.37 trillion). [r2 C2-M7, r3 C3-M4, r4 C4-M1, R4-L1]
- **Privileges, ownership and database-wide objects match.** The catalog check compares structure: relation ACLs,
  owners, roles and event triggers are not compared (default privileges and publications in `public` are). [r8 R8-L2]
- **A Prisma build keeps working on tables without money.** It may, but it is not supported (C5).
- **Correcting timestamps a non-UTC session's column default wrote before the migration.** The Prisma build already
  read them as UTC; the migration keeps what it read and cannot know the zone of a past session. [w1a gate]
- **Log redaction for Prisma errors in the W1b–W2 working tree.** No Prisma remains at the end (guarantee 2), and
  the mixed tree is never run against a kept database or committed on its own. [W1b fix-1 C-H1, R-L-a]
- **A repeated upload after `TRY_AGAIN` leaves no unreferenced object.** The bytes are stored before the record
  (storage cannot join a database transaction); an unreferenced object is never served, because `GET /documents/:id`
  reads the record. The orphan sweep belongs to batch 2. [W1b gate r1]
- **Business dates as `date`, snake_case column names, module ownership of writes, a PIA floor check, an
  append-only trigger on consent records** → batch 2.

## 2. Coordinator choices, for approval

- C1 Rates that multiply money (`insurers."ratePercentage"`, `pia_config."piaRatePercentage"`) become basis points;
  the wire keeps percentages. The NCD discounts `quote_requests."ncdPercentage"` and `ncd_codes."percentage"` are
  whole-percent integers and stay. The rules file says so. [r1 C-M2, r2 C2-M8, R2-M6]
- C2 Conversion between wire and stored values happens only in DTO mapping, through `src/common/money.ts`.
- C3 Configuration keeps `@nestjs/config` with the zod schema in `src/config/env.ts` (it already reports every
  problem at once) and adopts loan-ledger's rules: no values echoed; `CHANGE_ME` refused; no host, port or database
  name defaults in code (`PORT`, `CORS_ORIGINS` and the Keycloak settings become required); a `_test` guard on
  `TEST_DATABASE_URL`; pool settings refused in URLs. [r1 C-M8]
- C4 The package manager stays npm workspaces (root rule), not loan-ledger's Yarn.
- C5 **Offline cutover.** 0001 is a breaking change for a Prisma build, an approved exception to "the build before
  a migration keeps working on the schema after it". 0001 renames every converted column (`"premium"` →
  `"premiumMinor"`, …), so an old build fails with "column does not exist" on any money query. Cutover for a
  Prisma-era database: stop every old API process, back up, run `npm run db:migrate` (adopts and converts in one
  transaction), start the new build. Rollback is restoring the backup. If
  `db:migrate` refuses for data, nothing has changed: correct the rows each named column counts (the same predicate
  in a `SELECT … WHERE`; the message carries no values) and run it again. [r8 R8-L7] [r7 R7-L6] Evidence that no such database exists here:
  no deployment (`docs/DEPLOYMENT.md` "Before going live"); the Postgres on :5432 has no InsurShield database
  (`psql -l`); no InsurShield Docker volume (`docker volume ls`), all on 2026-10-24. Teammates' machines are not
  known. W4 runs the `cbef7b5` build once against a converted database (start, `/health/ready`, a read, a write)
  and records what happens. [r1 C-M1, R-H3; r2 R2-L9]
- C6 Physical column names stay camelCase as Prisma created them; only converted columns are renamed. Business
  dates stay timestamps (now `timestamptz`).
- C7 Seed scripts move to `apps/api/scripts/` and keep `tsx` (Node's type stripping cannot resolve the `.js`
  specifiers the schema uses). `dotenv` goes: the Drizzle config and scripts use `process.loadEnvFile`. Root
  `engines.node` becomes `>=24.15`. [r1 R-M9]
- C8 Existing defects fixed in this batch, each with a failing test first: guarantee 8. [r1 C-H3, R-H4, R-M2,
  C-M7, R-M4, R-L7]
- C9 Admin monthly buckets use the Lusaka calendar month, by the rule "today is the calendar date in Lusaka".
  Today they use the server process's time zone (`admin.service.ts:110–115`): UTC in the Docker image, so a payment
  between 22:00 and 24:00 UTC on a month's last day moves to the next month. [r2 R2-L6]

## 3. What exists today (verified how)

| Fact | Verified how |
| --- | --- |
| NestJS 12.1.0 installed, 12.2.0 latest (released 2026-10-19); `@nestjs/jwt` 12.0.2 → 12.0.3, cli/schematics 12.0.5 → 12.0.10 | `node_modules/*/package.json`, `npm view` |
| Prisma 7.10 with `@prisma/adapter-pg`; client generated by `postinstall` into git-ignored `src/generated/prisma` | `apps/api/package.json:31`, `.gitignore`, `src/prisma/prisma.service.ts` |
| 24 active models, 18 active enums, 783-line schema, 6 migrations | `prisma/schema.prisma` [r1 C-L1] |
| Physical names are Prisma's: quoted camelCase columns, `<table>_<cols>_key` unique **indexes**, `<table>_<col>_fkey` foreign keys with `ON UPDATE CASCADE`, `DEFAULT CURRENT_TIMESTAMP`, `TIMESTAMP(3)` | init `migration.sql` [r1 C-M2, R-M6] |
| `PrismaService` is injected by 9 services, `health.controller`, `pia.controller`, `common/auth/auth.guard.ts` (staff lookup, customer find-or-create) and the unused interceptor. Enum-only importers: `common/contract.ts`, `contract.spec.ts`, `documents/documents.controller.ts`, `insurer-portal/dto/portal.dto.ts`, `insurers/dto/insurer.dto.ts`; `insurers.service.ts` also imports `Prisma` types; `prisma/seed.ts` constructs a `PrismaClient` and `prisma/demo-data.ts` imports its type [r3 C3-L3] | grep [r2 C2-L1, R2-L4] |
| Prisma features used: nested `include`/`select` (some filtered), nested `create` (quote recipients and shots, insurer contact), nested `contact.upsert`, `$transaction` callback (payments) and array form (admin: 14 counts and aggregates; insurer portal), `aggregate _sum`, `_count`, `upsert`, `updateMany` as a conditional update, `findUniqueOrThrow`/`findFirstOrThrow`, compound-unique lookup, `mode: 'insensitive'`, `some` filter; DTO fields and whole rows spread into `data` and responses (`insurers.service.ts:68,128`). No `createMany`, `connect` or Prisma error-code handling: every unique violation is a `500` today | reads [r1 R-L2] |
| Money `numeric(14,2)`: `quote_requests."vehicleValue"`, `insurer_quotes."premium"`, `payments."amount"`, `policies."premium"`, `claim_notifications."estimatedLoss"` (nullable). Rates `numeric(5,2)`: `insurers."ratePercentage"`, `pia_config."piaRatePercentage"` | init migration |
| JSONB: `idempotency_records."responseBody"`, `integration_deliveries."requestPayload"`, `"responseBody"`, `audit_logs."before"`, `"after"`. `insurers."benefits"` nullable `TEXT[]`; the service writes `[]` when absent; the contract says `string[]` | init migration:136,443–477; `insurers.service.ts:132`; `contracts.js:71` |
| UUID ids and `@updatedAt` are set by the Prisma client; the database has no default for them | init migration:119–138 |
| Float arithmetic on money (payments tolerance, admin sums in JS) | `payments.service.ts:73`, `admin.service.ts:116` |
| Payments store `providerReference = "MM-" + last 4 digits`; the policy reuses the quote's document (`quoteDocumentId: quote.documentId`) | `payments.service.ts:95,117` [r2 C2-M2, C2-H2] |
| `IdempotencyInterceptor` is registered nowhere; payments use the unique `payments."idempotencyKey"` (random UUID when the header is missing); submit and claims ignore the header; the web makes a new key per call and has no retry | grep; `payments.controller.ts:38`; `apps/web/src/api/http/index.js:37,57,70`, `apiClient.js:35–43` [r2 R2-M5] |
| `GET /documents/:id` signs any document with no principal check. `DocumentsService.record(id)` is also called internally by 12 response builders: `customer.service.ts:124,506,509,602,684`, `insurer-portal.service.ts:117,199,270,273,323,358`, `inspections.service.ts:122`. No web code calls `GET /documents/:id`. `requireExists` checks only existence before attaching a quote document (`insurer-portal.service.ts:153`), certificate (`:304`), inspection shot (`customer.service.ts:203`) or claim attachment (`:624`). `policies."certificateDocumentId"` has no unique index | reads [r2 R2-H1, R2-H2, C2-M3] |
| `/health` is liveness with no dependency; `/health/ready` checks Postgres and storage; Docker `HEALTHCHECK` calls `/health` | `health.controller.ts:20–34`, `Dockerfile:83` |
| Second final quote → `409 ALREADY_QUOTED` | `insurer-portal.service.ts:140–144` |
| Drizzle's migrator (0.45.4) creates `drizzle.__drizzle_migrations` outside its transaction, reads the last row outside it, then applies every migration whose `folderMillis` is greater than the last row's `created_at`, in one transaction. `readMigrationFiles` only reads files (hash = SHA-256 of the file bytes) | `loan-ledger-service/node_modules/drizzle-orm/pg-core/dialect.js:44–72`, `migrator.js` [r2 R2-M1] |
| `payments."quoteRequestId"` has an immediate foreign key to `quote_requests`, so inserting a payment takes `FOR KEY SHARE` on the request row; `policies` has no unique index on `"quoteRequestId"` | init migration:677; schema [r3 R3-H2, C3-M1] |
| `customers.email` and `customers.phone` are unique as well as `"keycloakId"`; quote request ids come from `newReference('QR')` on submit, but from `` `QR-${Date.now()}` `` on requote and renewal, so two in one millisecond collide (now `409 CONFLICT`) | `schema.prisma:154–157`, `customer.service.ts:215,340,442` [r5 R5-L2] [r3 R3-M3] |
| The API e2e config has no global setup, env loading or `fileParallelism: false` | `vitest.config.e2e.ts` [r2 R2-M3] |
| Credentials hard-coded in `docker-compose.yml` and `infra/keycloak/realm-insurshield.json:89`; `apps/api/.env.example` has `?schema=public` | files |
| The web e2e suite runs against the mock adapter | `apps/web/playwright.config.js:79–82` |
| Admin month buckets use the process time zone | `admin.service.ts:105–118` |
| User's web dev server runs on :5173 from the main checkout; this batch works only in the worktree | `lsof` |

## 4. Scope

In: rules files (drafted in the worktree); additive dependencies in W0 (NestJS 12.2.0 line, `drizzle-orm` 0.45.4,
`drizzle-kit` 0.31.11, `pg` 8.23.1, `pg-connection-string` 2.14.1, `@nestjs/swagger` 12.0.3), removals in W3;
`src/db/`, `drizzle/` 0000 and 0001, `src/db/migrate.ts`; every module refactored; money helpers; guarantee 8;
config rules, `.env.example` files, Compose and realm from `.env`, Swagger, e2e harness and tests, Dockerfile, docs.

Out: the "not guaranteed" list in section 1. Web changes: none. The web shows `message` for any `code`
(`apps/web/src/api/http/`), so the new codes need no web change; P2 checks and lists this.

## 5. Stop point and exit criteria

- Every package reviewed by Codex and an independent reviewer agent, with a security hunt; confirmed findings fixed,
  each with a failing test first; review rounds converge per the convergence rules (contract in section 1).
- `git grep -il prisma -- apps/api packages README.md docs ':!docs/plans'` lists only `apps/api/drizzle/prisma-era/**`, `apps/api/test/fixtures/prisma-era/**`,
  `apps/api/src/db/migrate.ts` and its catalog reader, `apps/api/test/{migrate,schema}*.e2e-spec.ts`, and the C5 note
  in `README.md` and `docs/DEPLOYMENT.md`. [r2 C2-L2, R2-L3; r3 R3-L6]
- Green, with numbers: `npm run lint`, `npm run test`, `npm run build`, `npm exec -w @insurshield/api -- tsc --noEmit`,
  `npm run test:e2e -w @insurshield/api` against a throwaway Postgres, and `npm run test:e2e -w @insurshield/web` once
  at the end (a browser run, with the user's permission).
- The commit proposal (small commits, Lore trailers) approved by the user. No push.

## 6. Packages

File ownership is by wave; a later wave takes a file over only after its earlier owner has finished.

Every W2 package (P4–P8) keeps a request's writes in one `db.transaction` and, after it commits, does nothing that
can answer `503 TRY_AGAIN` (a second transaction, a read, building the response); the package's review checks this
(`apps/api/AGENTS.md` "Database"). [W1b fix-2 R-L1]

| Package | Owner scope (files) | What it delivers | Depends on | Tests |
| --- | --- | --- | --- | --- |
| P0 Rules and deps (coordinator, W0) | `AGENTS.md`, `apps/api/AGENTS.md`, root and `apps/api/package.json` (dependency additions, NestJS bump, `engines`), `package-lock.json`, this plan | Rules; dependencies | — | `npm ci`; existing build and unit tests still green |
| P1 Database and config (W1a) | `apps/api/src/config/**`, `apps/api/src/db/**`, `apps/api/drizzle/**`, `apps/api/drizzle.config.ts`, `apps/api/src/common/money.ts(+spec)`, `apps/api/src/common/domain/**`, `apps/api/src/common/contract.ts(+spec)`, `apps/api/drizzle/prisma-era/**`, `apps/api/test/fixtures/prisma-era/**`, `apps/api/test/scratch-database.ts`, `apps/api/.gitattributes`, `apps/api/test/{schema,migrate}*.e2e-spec.ts`, `apps/api/vitest.config.e2e.ts` (W1a only), `apps/api/.env.example` | P1 detail | P0 | T-M*, T-S*, T-D*, T-C1, T-W2 |
| P2 Platform and harness (W1b) | `apps/api/src/main.ts`, `apps/api/src/app.setup.ts` (new), `apps/api/src/app.module.ts`, `apps/api/src/swagger.ts`, `apps/api/src/common/filters/**`, `apps/api/src/common/errors/**`, `apps/api/test/{global-setup,helpers,builders,jwks,storage-fake}.ts`, `apps/api/test/{swagger,error-filter,harness}.e2e-spec.ts`, deletion of `apps/api/test/app.e2e-spec.ts`, `apps/api/vitest.config.ts`, `apps/api/vitest.config.e2e.ts` (from W1b), `apps/api/nest-cli.json`, root `.env.example`, `docker-compose.yml`, `infra/**` | P2 detail | P1 | T-E*, T-W1, T-F1 |
| P3 Auth, documents, health (W1b, parallel with P2) | `apps/api/src/common/auth/**`, `apps/api/src/auth/**`, `apps/api/src/documents/**`, `apps/api/src/storage/**`, `apps/api/src/health/**`, `apps/api/test/{auth-guard,auth-service,documents-access,documents-upload,health}.e2e-spec.ts`, `apps/api/test/builders/documents.ts` | P3 detail | P1; its e2e specs run after P2's harness lands | T-A*, T-G1, T-DOC1, T-DOC3–4, T-H1–2, T-ATT1 (repository level) |
| P4 Customer (W2) | `apps/api/src/customer/**`, `apps/api/test/customer*.e2e-spec.ts`, `apps/api/test/builders/customer.ts` | Repository, domain (cover period, renewal window, plate matching), service, DTO mapping; attach paths for shots and claim attachments through `assertAttachable` | W1 | T-Q*, T-R*, T-O1, T-DOC2 (shots, claims), T-HTTP1 (customer) |
| P5 Insurer portal (W2) | `apps/api/src/insurer-portal/**`, `apps/api/test/insurer-portal*.e2e-spec.ts`, `apps/api/test/builders/insurer-portal.ts` | Same, insurer filter in every query; conditional transitions; attach paths for quotation and certificate through `assertAttachable` | W1 | T-T*, T-I1, T-X1–3, T-DOC2 (quotation, certificate), T-HTTP1 (portal) |
| P6 Payments (W2) | `apps/api/src/payments/**`, `apps/api/test/payments*.e2e-spec.ts`, `apps/api/test/builders/payments.ts` | P6 detail | W1 | T-P*, T-HTTP1 (receipt) |
| P7 Admin, insurers, PIA (W2) | `apps/api/src/admin/**`, `apps/api/src/insurers/**`, `apps/api/src/pia/**`, `apps/api/test/{admin,insurers,pia}*.e2e-spec.ts`, `apps/api/test/builders/admin.ts` | Sums in SQL decoded with `BigInt`; Lusaka month buckets (C9); basis points; insurer and contact in one transaction; explicit response mapping (no row spread); name clash → `409` | W1 | T-AD*, T-X4, T-HTTP1 (admin, insurers, PIA) |
| P8 Inspections, vehicles (W2) | `apps/api/src/inspections/**`, `apps/api/src/vehicles/**`, `apps/api/src/app.controller*.ts`, `apps/api/src/app.service.ts`, `apps/api/test/{inspections,vehicles}*.e2e-spec.ts`, `apps/api/test/builders/inspections.ts` | Same | W1 | T-V1, T-IN1 |
| P9 Removal, seed, image, docs (W3) | `apps/api/scripts/**`, deletion of `apps/api/prisma/`, `apps/api/prisma.config.ts`, `apps/api/src/prisma/`, `apps/api/src/generated/`, `apps/api/src/common/interceptors/**`; takes over `apps/api/src/documents/documents.service.ts` (to delete `requireExists`), root and `apps/api/package.json`, `package-lock.json`, `apps/api/src/app.module.ts`, `apps/api/.gitignore`, `turbo.json`; `apps/api/Dockerfile`, `README.md`, `apps/api/README.md`, `docs/DEPLOYMENT.md`, `.gitignore` | Prisma removed; idempotent seed on Drizzle; migrator image runs `src/db/migrate.ts`; README Configuration table, cutover note (C5), note that old Postgres and Keycloak volumes keep old passwords and the old client secret | P3–P8 | T-SEED1, T-DOCKER1 |

### P1 detail

- `src/db/schema.ts` in its final (post-0001) form: Prisma's physical names, `uniqueIndex` for Prisma's unique
  indexes, foreign keys with Prisma's names and `onUpdate: 'cascade'`, `timestamp(…, { withTimezone: true,
  precision: 3, mode: 'date' })`, money `bigint(…, { mode: 'number' })`, `"benefits"` nullable `text().array()`,
  JSONB as `jsonb`. Ids `$defaultFn(randomUUID)`; `"updatedAt"` `$defaultFn(() => new Date())` and
  `$onUpdate(() => new Date())`; every `onConflictDoUpdate` sets `"updatedAt"` explicitly. Enums use tuples in
  `src/common/domain/`.
- `drizzle/0000_baseline.sql`: DDL equal to the six Prisma migrations (hand-checked, not `drizzle-kit pull`).
- `drizzle/0001_minor_units_timestamptz.sql`, written by hand: for each converted column `RENAME COLUMN` then
  `TYPE … USING`; every timestamp `TYPE timestamptz(3) USING x AT TIME ZONE 'UTC'`; `CHECK` money `>= 0 AND <=
  99999999999999`, rates `0..10000`. Then the snapshot is made consistent so `drizzle-kit generate` reports no
  change. Column map:

  | Table | Old column | New column | Unit |
  | --- | --- | --- | --- |
  | `quote_requests` | `"vehicleValue"` numeric(14,2) | `"vehicleValueMinor"` bigint | ngwee |
  | `insurer_quotes` | `"premium"` numeric(14,2) | `"premiumMinor"` bigint | ngwee |
  | `payments` | `"amount"` numeric(14,2) | `"amountMinor"` bigint | ngwee |
  | `policies` | `"premium"` numeric(14,2) | `"premiumMinor"` bigint | ngwee |
  | `claim_notifications` | `"estimatedLoss"` numeric(14,2) null | `"estimatedLossMinor"` bigint null | ngwee |
  | `insurers` | `"ratePercentage"` numeric(5,2) | `"rateBps"` integer | basis points |
  | `pia_config` | `"piaRatePercentage"` numeric(5,2) | `"piaRateBps"` integer | basis points |

- `src/db/migrate.ts`, the only migration entry point (`db:migrate`, the migrator image, the e2e setup; built
  `dist/db/migrate.js`), runs `main()` unconditionally; its functions live in `src/db/migrator.ts`, which the tests
  import [w1a R-L2, gate]. It does
  not call Drizzle's `migrate()`; it uses `readMigrationFiles` and applies migrations itself, so every path is one
  transaction on one dedicated `pg.Client`. Steps: [r2 C2-H1, R2-M1; r3 C3-H1, R3-H1, C3-M2, R3-M1, R3-L8]
  1. Set `statement_timeout=0`, `lock_timeout=0` and `transaction_timeout=0` [w1a R-L5], wait for `pg_advisory_lock`, then set `lock_timeout=60s`.
     [r4 R4-L7]
  2. `BEGIN`; read three independent facts, then decide from the whole table below (design review of the whole
     flow after r5 R5-M1; a state is never recognised from one fact alone):
     - **H_P**: does `public._prisma_migrations` exist, and is its content *valid* (exactly one finished, not
       rolled-back row for each of the six names, checksum = SHA-256 of the `drizzle/prisma-era/` file in LF or CRLF
       form, other rolled-back rows allowed)? Values: absent / valid / invalid.
     - **H_D**: `drizzle.__drizzle_migrations` rows. Values: none (schema or table absent, or no rows) / prefix *k*
       (rows equal, in order, the first *k* journal entries as `(hash, created_at = folderMillis)`, nothing extra) /
       invalid.
     - **C**: the application catalog of `public` (the reader below; it never lists `_prisma_migrations`). Values:
       empty / equals the Prisma catalog / equals the catalog after Drizzle prefix *k* / other.

     | H_P | H_D | C | Decision |
     | --- | --- | --- | --- |
     | absent | none, and no `drizzle.prisma_migrations_archive` | empty | Fresh: create `public` if absent, then apply every migration [w1a R-L4] |
     | absent | prefix *k* | after prefix *k* | Managed: apply migrations *k+1* onward (none when *k* is the last) |
     | valid | none, and no `drizzle.prisma_migrations_archive` | Prisma catalog | Prisma-era: create Drizzle's schema and table, move `public._prisma_migrations` to `drizzle.prisma_migrations_archive`, record 0000 as applied, apply 0001 onward |
     | any other combination | | | Refuse, naming the facts that do not match. Among them: a history table with a failed or no Prisma row and an empty `public` (R5-M1); both histories; an invalid history of either kind; a catalog that matches no expected one. A catalog refusal lists up to 10 differing records by kind and qualified name with "missing", "extra" or "different", never their definition text [w1a C-M1, gate] |

  3. Applying, for each accepting row: create `public`, the `drizzle` schema and `drizzle.__drizzle_migrations`
     where absent, with Drizzle's own statement copied exactly (`id SERIAL PRIMARY KEY, hash text NOT NULL,
     created_at bigint`, `dialect.js:47–51`) [r7 R7-L4]; for the Prisma-era row move
     the Prisma history and record 0000; before 0001, count for each of the seven converted columns the rows that would
     break its constraint, computed on the converted value (`round(x * 100)`) against the constants in
     `src/common/domain/money-limits.ts`, passed as parameters: below 0, above `MAX_NGWEE` (money) or `MAX_RATE_BPS`
     (rates), or `NaN`; NULL `estimatedLoss` passes; refuse naming every failing column and count [r7 R7-L2, r8 R8-L5];
     for each migration to apply run its statements and insert its `(hash,
     folderMillis)` row.
  4. Read the three facts again and require the invariant below; otherwise roll back. Then `COMMIT`. [r6 C6-L1]

     Invariant after every `COMMIT`: H_P = absent, H_D = prefix *n* (the whole journal), C = the final catalog. That
     is the Managed row with nothing to apply, so every successful run is followed by a run that does nothing.
     Refusals change nothing: the transaction rolls back. [r5 R5-M1]
  The catalog reader has two levels. [r6 C6-M1, r7 C7-M1]
  - **Schema level, complete by construction:** every object PostgreSQL records as living in `public` — the rows of
    `pg_depend` with `refclassid = 'pg_namespace'::regclass`, `refobjid = to_regnamespace('public')` and `deptype`
    `'n'` or `'a'` — described with `pg_identify_object` as `(type, identity)`, never OIDs. With `public` absent,
    `to_regnamespace` is NULL and C = empty (a cast `'public'::regnamespace` would raise `3F000`) [r8 R8-L1]. The
    `'a'` records are default privileges and schema publications in `public`; none is expected [r8 C8-L3, R8-L2]. The set must equal the expected set exactly, so an extra collation, text-search object, operator,
    domain, function, view or any kind added in a later PostgreSQL release is refused without the reader knowing
    the kind. Checked on PostgreSQL 17 on 2026-10-24: a collation, a text-search configuration, a domain, a
    function, a view, tables and an enum all appear by name.
  - **Outside dependants:** the members are the set plus everything reachable from it through `'i'` and `'a'`
    dependencies (a table's columns, row and array types, constraints, indexes, defaults, owned sequences, TOAST
    table). Any `pg_depend` row whose referenced object is a member and whose dependent object is not is refused,
    named by `pg_identify_object`; none is expected. A member whose catalog is not one the table level describes
    (`pg_class`, `pg_constraint`, `pg_type`, `pg_proc`, `pg_attrdef`, `pg_trigger`, `pg_policy`, `pg_rewrite`), such
    as a table's publication membership or a statistics object in another schema, gets its own `(type, identity)`
    record, so it is compared too; none is expected. Checked on PostgreSQL 17 on 2026-10-24. [w1a R-L6] This catches a table in another schema inheriting from a
    `public` table, a cast on a `public` enum, and a view in another schema over any `public` column. Checked on
    PostgreSQL 17 on 2026-10-24: a correctly built schema gives no rows, and each of those three gives its rows.
    [r8 R8-L3]
  - **Table level:** for each table in that set, its columns, constraints, indexes, non-internal triggers, policies
    (`pg_policy`) and rules (`pg_rewrite` other than the `_RETURN` rule of a view or materialised view), as below;
    policies and rules are expected to be none. Relation records also carry `relpersistence`, `relrowsecurity`,
    `relforcerowsecurity`, `relreplident` and `reloptions`; column records carry `attcollation`, `attidentity` and
    `attgenerated`. Any trigger, internal ones included, with `tgenabled <> 'O'` is refused, so foreign keys switched
    off by `DISABLE TRIGGER ALL` are seen. [r7 R7-L3, r8 R8-L4]
  - `_prisma_migrations` and what belongs to it (its row and array types, primary key and index) are left out at
    both levels; the history fact H_P reads it instead. [r7 R7-L1]

  Definition records for the members and the table level come from `pg_class`, `pg_attribute`, `pg_attrdef`,
  `pg_constraint`, `pg_index`, `pg_trigger`, `pg_proc`, `pg_type`, `pg_enum`, `pg_policy` and `pg_rewrite`: sorted,
  deparsed with a fixed `search_path`, compared by qualified name, argument signature and definition text, never by
  OID, with dropped column slots and column positions ignored (the Prisma-era database has dropped columns). Columns
  carry type, precision, `attnotnull` and default; constraints of types `p`, `u`, `f`, `c` and `x` their definitions;
  enums their ordered values. The `_prisma_migrations` exclusion above is the only one. [r5 R5-L1, r8 R8-L8] It never needs `pg_dump`. Expected catalogs are made on PostgreSQL 17,
  the Compose version; a server of another major version is refused with a message saying so.
  [r4 C4-M2, R4-L5] Expected catalogs live in `drizzle/catalog/`: one for the
  Prisma schema (built from the six Prisma migrations) and one after each Drizzle migration. The final one is built
  independently of the hand-written SQL, by `drizzle-kit push` of `src/db/schema.ts` to an empty scratch database
  (T-S5). A test regenerates each and fails if a committed file differs. `drizzle/prisma-era/` holds the six Prisma
  migration files, the only copy (shipped in the migrator image; the tests read them there);
  `apps/api/.gitattributes` pins `drizzle/**` to LF so Drizzle's hashes are the same on every checkout. [r3 R3-L7,
  r4 R4-L2]
- `src/db/database.module.ts`: `DATABASE` token (global), `Database` and `Transaction` types, pool with
  `-c DateStyle=ISO -c TimeZone=UTC -c statement_timeout=10000 -c lock_timeout=5000`, size `DATABASE_POOL_SIZE`.
- `src/db/errors.ts`: `isRetryableDatabaseError` (lock and statement timeouts `55P03`, `57014`, deadlock `40P01`,
  serialization `40001`, pool timeout), `isUniqueViolation(error, constraint?)`, both walking `.cause` with
  loan-ledger's loop guard; `describeDatabaseError` returning only SQLSTATE and constraint name.
- `src/common/money.ts`: `kwachaToNgwee` exact via the decimal string, refusing more than two decimals and values
  outside `MIN_NGWEE`..`MAX_NGWEE`; `ngweeToKwacha`; `parseKwacha(string)`, the exact
  decimal-to-ngwee parser with no range limit, which `kwachaToNgwee` wraps with the 0..`MAX_KWACHA` bound;
  `sumToKwacha(string)` for SQL sums (parsed with `BigInt`; it returns a Kwacha number only when `parseKwacha` of
  that number's string gives back the same ngwee, otherwise it throws); `percentToBps`, `bpsToPercent`; `divideRoundHalfUp` in `BigInt`.
- `src/common/domain/money-limits.ts`: `MIN_NGWEE = 0n`, `MAX_NGWEE = 99999999999999n`, `MAX_KWACHA =
  999999999999.99` (derived from `MAX_NGWEE`), `MAX_RATE_BPS = 10000`; `kwachaToNgwee`, the pre-0001 count and the
  tests use these, and 0001's hand-written CHECKs are compared with them by T-D4 [r8 R8-L5]. `MAX_KWACHA` is used by DTO `@Max` decorators in W2 so an
  oversized amount answers `400 VALIDATION_FAILED`, never `500`. [r2 C2-M6, R2-L12]
- `test/scratch-database.ts`: creates and drops a uniquely named `<test database base>_<spec>_<n>_test` on the test
  server for each migration spec, after the same identity checks [r3 C3-L1], so T-S* and T-D* never touch the shared e2e database. [r2 R2-M3]
- `vitest.config.e2e.ts` (W1a): loads env, calls `useTestDatabase()`, `fileParallelism: false`; P2 extends it.
- `src/config/env.ts`: `DATABASE_POOL_SIZE` (2–100), `SWAGGER_ENABLED`, `testDatabase()`, `useTestDatabase()`;
  refuses `CHANGE_ME`, pool settings and NUL bytes in URLs; no host or port defaults (C3); no value in any message.
- `test/fixtures/prisma-era/`: a `_prisma_migrations` fixture and a data fixture (the migration SQL itself is read
  from `drizzle/prisma-era/`), covering every converted column, NULL vs empty vs populated `"benefits"`, SQL NULL vs JSON `null`.

### P2 detail

- `src/app.setup.ts`: `configureApp(app, config)` with the API prefix, validation pipe, CORS, error filter and
  Swagger; `main.ts` and the e2e helpers both call it. `app.module.ts` registers `DatabaseModule`. [r2 R2-M2]
- `test/jwks.ts`: a local JWKS HTTP server on a random port with a key generated per run; the e2e config points
  `KEYCLOAK_ISSUER` at it, so the real verifier runs. No production code or variable accepts a test key.
- `test/storage-fake.ts`: an in-memory `StorageService`, bound with `overrideProvider` in the testing module only.
- `test/builders.ts`: builders inserting rows through the Drizzle schema (insurer with contact and staff user,
  customer, vehicle, quote request with recipients, insurer quote with document, payment, policy, claim, NCD code,
  document with uploader, inspection). Each later package adds what it needs in its own `test/builders/<pkg>.ts`
  (shots, claim attachments and inspection photos in P3's `documents.ts`; NCD applications in P5's; PIA config in
  P7's). [r4 R4-L3] Specs set up state only through builders. [r3 R3-M2]
- Global setup: verifies `current_database()` equals the `_test` name, drops `public` and `drizzle`, recreates
  `public`, runs `src/db/migrate.ts`. Each W2 package uses its own `insurshield_<pkg>_test` database in one throwaway container.
- P2's own specs use a test-only controller registered in the testing module (for T-E1) and never call routes
  behind P3's guard. [r2 R2-M2]
- Error filter: `isRetryableDatabaseError` → `503 TRY_AGAIN` with `Retry-After: 1`; an unhandled
  `isUniqueViolation` → `409 CONFLICT` with a generic message and no constraint name or value in the response (the
  server log may carry the constraint name, never values); logs
  `describeDatabaseError` for database errors, the stack only for others. [r3 R3-M3]
- Compose and `infra/`: credentials from the root `.env` (`${VAR:?…}`); a test database in `infra/postgres/` init;
  the realm's API client secret from `${KEYCLOAK_CLIENT_SECRET}`, verified on a throwaway Keycloak.

### P3 detail: document access [r2 C2-H2, R2-H1, R2-H2, C2-M3]

- `DocumentsService.record(id)` stays unchanged for the 12 internal callers, which have already scoped the parent
  record. `GET /documents/:id` calls a new `recordFor(principal, id)` that allows:

  | Principal | May read |
  | --- | --- |
  | `SUPER_ADMIN`, `ADMIN` | any document |
  | the uploader (customer or staff) | that document |
  | a customer | quotation (`insurer_quotes."documentId"`) on their own quote request; quote document and certificate on their own policy; shots of their own request; attachments of their own claim; photos of their own inspection |
  | an insurer user | quotation from its insurer; quote document and certificate of its insurer's policy; shots of a request sent to its insurer (a `quote_request_recipients` row); attachments of a claim for its insurer; photos of an inspection for its insurer |
  | anyone signed in | an `INSURER_LOGO` uploaded by staff (a customer's upload of that kind stays its uploader's) [W1b R-L1] |

  Anything else answers `404`, as if the document did not exist.
- `assertAttachable(tx, principal, documentIds, kind)`: locks the document rows (`FOR UPDATE`, in sorted id order so
  two requests cannot deadlock) [r4 R4-L11], then requires the
  principal uploaded it, its kind matches, and no row references it (`insurer_quotes`, `policies` quote document
  and certificate, `inspection_shots`, `inspection_photos`, `claim_attachments`); otherwise `409
  DOCUMENT_NOT_ATTACHABLE`. A request naming one document id twice is refused with `400` before any check. A
  policy taking over its quote's document in the payment transaction is not an attach
  and does not call it. `requireExists(id)` stays until W2 has moved every caller, then P9 deletes it.
- Guard: staff lookup and customer find-or-create on Drizzle; concurrent first requests create one customer
  (`INSERT … ON CONFLICT DO NOTHING` with no conflict target, so every unique index arbitrates, then select by
  `"keycloakId"`). Only when no row has that `"keycloakId"` (its email or phone belongs to another customer) does it
  answer `409 ACCOUNT_CONFLICT`. [r3 R3-M3, r4 R4-M1]

### P6 detail: payments [r2 C2-M2, R2-L1; r3 R3-H2, C3-M1, R3-L10]

Steps, in this order:

1. Look up a payment with the key (outside any transaction): another customer's → `403` as today; the same
   customer's with the same `quoteRequestId`, insurer, `"amountMinor"` (premium + fee) and `method` → the original
   receipt; any difference → `409 IDEMPOTENCY_KEY_REUSED`.
2. Load the customer's quote request and the chosen quote (`404` if not theirs).
3. `BEGIN`; lock the quote request `FOR UPDATE` **before** inserting anything, so no transaction holds the foreign
   key's `KEY SHARE` lock on it while waiting for the row lock (insert-first would deadlock).
4. Insert the payment. Its unique `"idempotencyKey"` arbitrates two requests with one key even on different quote
   requests: the second insert waits, then fails with a unique violation; the service rolls back and repeats step 1
   in a new statement.
5. Then, still in the transaction: already paid (a policy exists for the request) → `409 ALREADY_PAID`; quote expired
   → `409 QUOTE_EXPIRED`; amount ≠ premium + fee in ngwee → `409 AMOUNT_MISMATCH`. Any refusal rolls back, so the key
   stays unused.
6. Insert the policy. If the request carries an NCD code **issued by the insurer being paid** (the documented rule that a code discounts only its insurer's quote,
   `customer.service.ts:751–756`, a docstring that no code enforces today), redeem it with `UPDATE … WHERE code = $1 AND "insurerId" = $2 AND
   "redeemedAt" IS NULL`, which must touch exactly one row, otherwise roll back with `409 NCD_CODE_UNAVAILABLE`. A
   code of another insurer is left unredeemed (today it is consumed) and the payment proceeds, as today. [r5 C5-L1] `COMMIT`. [r4 R4-L10]

## 7. Waves

| Wave | Packages | Migrations and landing steps | What must be true before it starts |
| --- | --- | --- | --- |
| W0 | P0 | — | Plan reviewed and approved by the user |
| W1a | P1 | 0000 and 0001 built and verified on scratch databases only. Both reviewers review both migrations and `migrate.ts` (with the "safe to apply" focus) before W1b. | W0 green |
| W1b | P2 and P3 in parallel (disjoint files; P3's e2e specs run once P2's harness lands) | — | W1a reviewed |
| W2 | P4, P5, P6, P7, P8 in parallel | — | W1b reviewed. The tree still holds Prisma code for unconverted modules; it compiles, no test exercises it (fixtures insert directly), and the mixed tree is never run against a kept database |
| W3 | P9 | — | W2 reviewed; the only Prisma importers left are P9's own files (`app.module.ts`, `src/prisma/`, `src/generated/`, `prisma/`, the interceptor). W3 exits with none [r2 C2-M1] |
| W4 | Coordinator | Whole verification; the one-off old-build check (C5); commit proposal. When the user later creates a kept database, they start `/land-a-migration`. | W3 reviewed |

## 8. Dependants

| Changed thing | Caller or dependant | Behaviour changes? | Updated by / proved by |
| --- | --- | --- | --- |
| `PrismaService` / `PrismaModule` | 9 services, `health.controller`, `pia.controller`, `auth.guard`, `app.module` | Replaced by repositories | P3–P8; deleted in P9 |
| Generated enums | The enum-only importers in section 3 | Same values from domain tuples | P1 (contract, T-W2), P3–P9 |
| Seven money and rate columns | Responses with `premium`, `amount`, `vehicleValue`, `estimatedLoss`, `ratePercentage`, `piaRatePercentage`; admin totals and buckets | Wire values identical | T-HTTP1 |
| Timestamp columns | All `*At` fields and business dates in responses | Same instants and ISO strings | T-S2, T-HTTP1 |
| Error body | `apps/web/src/api/http/*` | Shape unchanged; new codes `TRY_AGAIN`, `CONFLICT`, `ACCOUNT_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `NCD_CODE_UNAVAILABLE`, `DOCUMENT_NOT_ATTACHABLE` | T-E1; P2's note |
| `payments."idempotencyKey"` | Pay | Different request under a used key → `409` | T-P3, T-P5 |
| `GET /documents/:id` | API clients (no web caller) | Unrelated principals → `404` | T-DOC1 |
| `DocumentsService.record` | 12 internal response builders | Unchanged | Module e2e specs (document URLs present) |
| Attach paths (4) | Insurer quote, certificate, shots, claim attachments | Unrelated or reused documents → `409` | T-DOC2, T-ATT1 |
| Admin month buckets | Admin dashboard chart | Lusaka month (C9) | T-AD1 |
| `/health`, `/health/ready` | Docker `HEALTHCHECK`, load balancers | Unchanged | T-H1, T-H2 |
| Root scripts, `postinstall` | Developers, README | `db:migrate` → `src/db/migrate.ts`; seed; `drizzle-kit studio` | P9, T-SEED1 |
| Compose, realm import | Developers' containers and volumes | Need a root `.env`; existing volumes keep old passwords and client secret | P2, P9 README |
| Dockerfile targets | Deployment docs | Migrator runs `src/db/migrate.ts`; runtime drops OpenSSL | P9, T-DOCKER1 |
| Prisma-era databases | Teammates (unknown) | Offline cutover (C5) | T-D1–T-D5 |

## 9. Tests per rule

| Test id | Rule | What fails without it |
| --- | --- | --- |
| T-M1 | Kwacha ↔ ngwee exact at the boundaries (0, 0.01, 0.1, 0.29, 1.005 refused, 999,999,999,999.99, one ngwee more refused) and for 10,000 seeded random two-decimal values | Float drift reaches the database [r2 R2-L10] |
| T-M2 | Half-up rounding in one function | Two modules round differently |
| T-M3 | Percent ↔ basis points exact (0.01 ↔ 1, 5.25 ↔ 525, 100 ↔ 10000) | A rate changes by a float error |
| T-S1 | The catalog after 0000 equals the catalog after the six Prisma migrations | The baseline differs from a Prisma-era database |
| T-S2 | 0001 on the populated fixture converts money and rates exactly, keeps NULLs and every timestamp's instant, run with session `TimeZone=Africa/Lusaka` as a startup option, and on a database whose own setting is `Africa/Lusaka`; a stored `2026-04-02 22:00:00` reads back as `2026-04-02T22:00:00.000Z` [w1a gate] | Values shift 100× or by two hours |
| T-S3 | `drizzle-kit generate` after 0001 reports no change | Schema file and migrations drift |
| T-S4 | Prisma's query shape (`SELECT "premium" FROM insurer_quotes`) fails after 0001 | An old build reads ngwee as Kwacha |
| T-S5 | The final catalog after a fresh install and after adoption each equal the catalog of `drizzle-kit push` of `src/db/schema.ts`; every timestamp column is `timestamptz(3)`, every money column `bigint`; inserting a negative or oversized amount or a rate of 10001 fails | A conversion or constraint missing from 0001 goes unnoticed [r2 C2-M5, r3 C3-M3] |
| T-D1 | After each of the three accepting rows (fresh, managed with a pending migration, Prisma-era) a second run is recognised as Managed and applies nothing. `db:migrate` on a Prisma-era fixture adopts and converts; JSONB and `"benefits"` unchanged; `_prisma_migrations` is archived in `drizzle`; a second run exits 0 and recognises the database as Drizzle-managed | Upgrade loses data; an adopted database is refused later [r3 C3-H1, R3-H1] |
| T-D2 | Every "refuse" combination of the decision table, refused without change; an existing `drizzle.prisma_migrations_archive`; row-level security enabled with no policy, an unlogged table, a generated column, a column with another collation, an identity column, a changed replica identity or `reloptions`, forced row-level security [r7 R7-L3, R7-L5]; outside dependants: a table in another schema inheriting from `public.payments`, a cast on a `public` enum, a view in another schema over a converted and over a timestamp column; a default privilege in `public`; a schema publication; a foreign-key trigger disabled; a database with no `public` and no histories is accepted as Fresh [r8 R8-L1–L4]; a valid Prisma-era or Managed database plus one extra collation, policy, rule, text-search configuration, operator, domain or function (positive controls that the two-level reader refuses each kind: policies and rules at table level, the rest at schema level) [r8 C8-L1]; including `public` holding only `_prisma_migrations` with a failed row and with no rows; a missing, failed or altered Prisma migration; an extra table, function, trigger, view, domain or extension (Prisma-era and Drizzle-managed); Drizzle rows with an unknown hash, an altered `created_at`, a gap or an extra row; both histories; a `public` holding only a leftover enum; a Drizzle-managed database whose `public` was dropped or drifted | A drifted database is accepted or a migration skipped [r3 C3-M2, R3-M1] |
| T-D3 | Plain `drizzle-kit migrate` on a Prisma database fails and leaves only an empty `drizzle.__drizzle_migrations`; `db:migrate` afterwards adopts | A stray command blocks adoption forever [r2 R2-M1] |
| T-D6 | The expected catalog files equal what the reader produces from the six Prisma migrations, from each Drizzle prefix, and from `drizzle-kit push`; a missing or different file fails; only `REGENERATE_CATALOGS=1` rewrites them [w1a R-L9] | Stale expected catalogs |
| T-D4 | A failure injected at each step of the applying sequence (after creating `drizzle`, after moving the Prisma history, after recording 0000, inside 0001, at the final check) rolls everything back; for each of the seven converted columns, a Prisma-era fixture with a negative or `NaN` value (rates also 100.01) is refused naming every failing column and count, with every value unchanged; a NULL `estimatedLoss` passes; the columns counted, and their bounds parsed from the final catalog's CHECK definitions, equal the constants in `money-limits.ts` [r7 R7-L2, r8 R8-L5] | Half-adopted database; data silently altered [r6 C6-M2] |
| T-D5 | Fresh install, then a second `db:migrate`, does nothing; a second run started while a first holds the lock for over 60 s waits and then does nothing | Fresh and repeat runs refused [r2 C2-H1, r3 R3-L8] |
| T-C1 | Config refuses `CHANGE_ME`, a non-`_test` test database, the same database for dev and test, pool settings and NUL bytes in URLs, missing host and port settings; no message contains the value | Tests wipe the dev database; secrets in logs |
| T-E1 | A lock wait beyond 5 s (held from a second connection) → `503 TRY_AGAIN`; a connection not obtained (refused, timed out, ended while connecting), for a query or a transaction, through the production pool → `503 TRY_AGAIN`; a connection lost mid-statement → `500`; a storage error → `500` with its stack; an unknown error → `500 INTERNAL_ERROR`; for any failed query (with or without a SQLSTATE) neither body nor log contains the statement or its parameters [W1b C-H1/R-M1] | Driver text and customer data leak |
| T-W1 | Swagger served only when `SWAGGER_ENABLED=true` | Docs exposed in production |
| T-W2 | `contract.ts` maps every enum value both ways, as before | Wire strings change |
| T-F1 | The e2e setup refuses to reset a database whose `current_database()` differs from the `_test` name | A misconfigured run wipes another database |
| T-A1–4 | Tokens with a wrong signature, issuer, audience or past expiry → `401`; a valid one passes (P3) | Forged tokens accepted |
| T-G1 | Five concurrent first requests from a new Keycloak customer (inserts released together by a barrier) create one customer and all answer `200`; a new `sub` with another customer's email → `409 ACCOUNT_CONFLICT` | Duplicate customers, `500`, or a false conflict [r4 R4-M1] |
| T-U1 | An unhandled unique violation (a test-only route) → `409 CONFLICT` with no constraint name or value in the body and no value in the log | `500` on clashes [r3 R3-M3, r4 C4-L2] |
| T-DOC1 | Each row of the P3 access table, positive and negative: a customer gets the certificate of their own policy and the quotation on their own request, not another customer's; an insurer user gets a shot on a request sent to it and a claim attachment for its claim, not another insurer's; admins get any; uploaders get theirs; logos for all | Leaked links, or legitimate links broken |
| T-DOC2 | Through each attach endpoint: a document uploaded by someone else, of the wrong kind, or already attached → `409 DOCUMENT_NOT_ATTACHABLE`; one id twice in a request → `400`; a fresh own upload succeeds | Hijacked attachments, `500` on reuse |
| T-ATT1 | One certificate attached to two policies concurrently (forced interleaving) → one success | Shared certificate [r2 C2-M3] |
| T-DOC3–4 | Upload stores metadata and bytes; size and type limits unchanged; an upload over `MAX_UPLOAD_BYTES` is cut off while it streams (multipart limits: one file, no more than the limit), answering the same `400 FILE_TOO_LARGE` [W1b R-M2] | Upload regressions; memory exhaustion from one large body |
| T-H1 | `/health/ready` reports database and storage reachability | Readiness lies |
| T-H2 | `/health` answers with the database down | Restarts on an outage |
| T-HTTP1 | For fixtures with known values (premium K1,234.56, rate 5.25%, `estimatedLoss` null and K0.01, `benefits` NULL → `[]`, timestamps with milliseconds), every affected endpoint returns those wire values and exactly the expected keys (no `rateBps` or other stored names). One table per module | Missing ÷100, bigint strings, leaked columns [r2 R2-L11] |
| T-O1 | A customer reading or changing another customer's request, quote, policy, claim, NCD application or inspection → `404` | Customer isolation break |
| T-Q1 | Quote submission creates the request, recipients and shots atomically | Partial requests |
| T-R1 | Renewal cases of the existing renewal spec | Renewal regressions |
| T-T1 | An insurer user sees and changes only its own requests, quotes, policies, claims, NCD (another insurer's ids → `404`) | Tenancy break |
| T-I1 | Second final quote → `409 ALREADY_QUOTED`, including two concurrent submissions | Duplicate or `500` |
| T-X1 | Two concurrent certificate uploads for one policy → one activation, the other `409` | Double issue |
| T-X2 | Two concurrent NCD approvals → one code, the other `409` | Second code or `500` |
| T-X3 | Forbidden transitions → specific `409` | Status overwritten |
| T-X4 | Two insurers created with one name together → one, the other `409` | `500` |
| T-P1 | Amount equals premium + fee in ngwee; K0.01 off → `409 AMOUNT_MISMATCH`; over `MAX_KWACHA` → `400`. Each module tests its own amounts over `MAX_KWACHA` → `400` with nothing stored (`vehicleValue` in P4, `estimatedLoss` in P4, premium in P5, fee in P6) | Wrong amount accepted, or `500` [r3 R3-L11] |
| T-P2 | Two concurrent payments for one request with different keys → one policy, the other `409 ALREADY_PAID` | Double charge |
| T-P3 | Same key, same request → original receipt; changed amount, method, insurer or request → `409`; another customer → `403` | Replay of the wrong receipt |
| T-P4 | Two payments on different requests sharing one NCD code (forced interleaving) → one redeems, the other rolls back with `409 NCD_CODE_UNAVAILABLE` and no policy; paying another insurer's quote leaves the code unredeemed and succeeds | Discount reused, or a payment refused |
| T-P5 | Concurrent payments with one key on two different requests → one payment; the other gets `409 IDEMPOTENCY_KEY_REUSED`; with one key on the same request → one payment and both answers are the receipt | Double charge [r2 C2-M2] |
| T-P6 | T-P2 with the interleaving forced after both transactions have read the request and before either inserts: one policy, the other `409 ALREADY_PAID`, never `500` or a deadlock | Lock-order deadlock [r3 R3-H2, C3-M1] |
| T-AD1 | Admin totals equal the sum of confirmed payments, including K1 trillion and K70 trillion exactly; a total whose number would not parse back to the same ngwee → `500` with no rounding; a payment at 23:30 UTC on 31 January counts in February (Lusaka) | Float, overflow or wrong month [r3 C3-M4] |
| T-AD2 | Insurer create and update with contact are atomic; `ratePercentage` reaches `"rateBps"` | Silent field loss |
| T-AD3 | `"updatedAt"` advances on update and upsert; ids generated on insert | Missing app-side defaults |
| T-V1 | Vehicle lookup by plate is case-insensitive as before | Matching regressions |
| T-IN1 | Inspection transitions and ownership as before | Regressions |
| T-SEED1 | Seed runs twice on a fresh database with the same result | Seed not idempotent |
| T-DOCKER1 | `docker build --target runtime` and `--target migrator` succeed; the migrator applies to an empty database | Broken image |

Existing specs are kept as behaviour tests: where one mocked Prisma, its cases move to the service spec with a stub
repository or to the module's e2e spec.

## 10. Decisions needed from the user

Decided by the user on 2026-10-24 (AskUserQuestion): U1 offline cutover; U2 fix them here; U3 batch 2 and U4
Lusaka ("both as recommended"); U5 accepted, with approval of this plan and the start of W0. Approval of the plan
is not approval to commit, push or apply a migration to a kept database.

| # | Question in plain language | Options | Recommendation |
| --- | --- | --- | --- |
| U1 | C5: approve an offline cutover for any Prisma-era database (stop the old API, back up, migrate, start the new one), with converted columns renamed so an old build fails loudly | Accept / require expand-and-contract with two-way sync triggers | Accept |
| U2 | C8: fix the existing defects in this batch. Visible effects: other people's document links answer `404` on direct request; reusing a document someone else uploaded (including a colleague at the same insurer), or one already attached, is refused; a reused payment key with different details is refused; races answer `409` instead of `500`; an NCD code is redeemed only when its own insurer is paid, while the web still marks the code used after any payment (`apps/web/src/features/payment/pages/PolicyConfirmationPage.jsx:74`; changing that is a web change for batch 2) [r8 C8-L2] | Accept / leave any for later | Accept |
| U3 | Leave idempotent quote submission and claims to batch 2, because the web makes a new key on every call and server-side replay protects nothing until the web keeps one key per submission | Batch 2 / add both sides here | Batch 2 |
| U4 | C9: admin monthly totals use the Lusaka calendar month | Lusaka / keep the server's time zone | Lusaka |
| U5 | Accept C1–C4, C6, C7 | Accept / change any | Accept |

## 11. Not verified

- Whether any teammate has a Prisma-era database (C5 and T-D1–T-D5 cover it).
- Prisma 7's runtime behaviour on the converted schema (the W4 one-off check records it).
- That Keycloak 26.7's realm import substitutes `${KEYCLOAK_CLIENT_SECRET}` (P2 verifies on a throwaway container).
- Prisma checksums on a CRLF checkout (the fixtures are compared byte for byte; P1 reports what Prisma hashes).
- Docker image build time and size (T-DOCKER1 measures).

## 12. Review findings

Round r1: Codex (C-) 0 Critical, 3 High, 9 Medium, 1 Low; reviewer agent (R-) 0 Critical, 4 High, 10 Medium,
11 Low. Round r2 on revision 2: Codex (C2-) 0 Critical, 2 High, 9 Medium, 3 Low; reviewer agent (R2-) 0 Critical,
2 High, 6 Medium, 12 Low. Revision 2 introduced 4 Medium-or-worse (C2-H1/R2-M1 migrate states, C2-H2 attach rule,
C2-M4/R2-M4 expiry, R2-M2 overlap), so revision 3 follows the convergence procedure: a written contract (section 1),
the idempotency store for submit and claims removed instead of patched (U3), and the remaining mechanisms specified.
Round r3 on revision 3: Codex (C3-) 0 Critical, 1 High, 4 Medium, 3 Low; reviewer agent (R3-) 0 Critical, 2 High,
3 Medium, 11 Low; both answered BUILD PLAN no; both said yes to the document access table and `assertAttachable`.
Revision 3 introduced 2 Medium-or-worse (the P6 insert order, the adoption terminal state); revision 4 fixes them
inside the same mechanisms without new ones. Round r4 on revision 4: Codex (C4-) 0 Critical, 0 High, 2 Medium,
2 Low; reviewer agent (R4-) 0 Critical, 0 High, 1 Medium, 11 Low. Codex: build yes for document access,
`assertAttachable` and payments, no for `migrate.ts` (C4-M2); reviewer: build yes for all four mechanisms. Revision 4
introduced 1 Medium (C4-M1, the aggregate bound); R4-M1 predates it. Revision 5 makes text corrections only. Round r5
on revision 5: Codex (C5-) 0 Critical, 0 High, 0 Medium, 1 Low, BUILD PLAN yes; reviewer agent (R5-) 0 Critical,
0 High, 1 Medium, 3 Low, BUILD PLAN no for R5-M1. R5-M1 is the second Medium introduced by a fix (after C4-M1), so
revision 6 replaces the `migrate.ts` state list with a whole-flow decision table and a post-commit invariant, gated by
a design review. Design gate r6 (Codex, C6-) on revision 6: 0 Critical, 0 High, 2 Medium, 1 Low; all 48 fact
combinations decided correctly; BUILD no for C6-M1 and C6-M2. Of these only C6-L1 was introduced by revision 6;
C6-M1 predates it (the r5 reader) and C6-M2 the init migration. Revision 7 closes them inside the same table. Round
r7 on revision 7: Codex (C7-) 0 Critical, 0 High, 1 Medium (C7-M1: namespace columns are plain `oid`, so discovery by
type cannot work), BUILD no; reviewer agent (R7-) on revisions 6 and 7: 0 Critical, 0 High, 0 Medium, 7 Low, BUILD
PLAN yes. C7-M1 is the third Medium a fix introduced in this mechanism, so revision 8 returns to the contract and
takes the inventory from PostgreSQL's own dependency records, verified on a throwaway PostgreSQL 17 container before
it was written, and takes the seven R7 Lows. Round r8 on revision 8: Codex (C8-) 0 Critical, 0 High, 0 Medium, 3 Low, BUILD PLAN
yes; reviewer agent (R8-) 0 Critical, 0 High, 0 Medium, 8 Low, BUILD PLAN yes; revision 8 introduced Lows only
(C8-L1, C8-L2 = R8-L6, C8-L3 = R8-L2, R8-L1). All eleven were applied as text and test additions; the outside-dependant
rule (R8-L3) was checked on a throwaway PostgreSQL 17 container first. That meets the stopping rule.

| Id | Verified how | What changed and where, or declined and why |
| --- | --- | --- |
| C-H1, R-H1 | `package.json:31`, `prisma.service.ts:3–4` | Removal in W3/P9; W0 additive |
| C-H2, R-M1 | Interceptor unregistered | Plan corrected; submit and claims idempotency → U3, not guaranteed |
| C-H3, R-H4 | `documents.controller.ts:52`, `documents.service.ts:81–100` | P3 access table, `recordFor`, `assertAttachable`; T-DOC1, T-DOC2, T-ATT1 |
| R-H2 | Cross-module flows | Drizzle fixtures; mixed tree never on a kept database |
| R-H3, C-M1 | No InsurShield volume | Renamed columns; offline cutover; T-S4; W4 check with a write |
| C-M2, R-M6 | Init migration 123, 136, 220 | Column map; hand-written 0001; NCD percentages exempt |
| C-M3 | Init migration 119–138 | `$defaultFn`, `$onUpdate`, explicit upsert `updatedAt`; T-AD3 |
| C-M4, R-L3 | Init migration 136, 443–477 | Fixture cases |
| C-M5 | `playwright.config.js:79–82` | T-HTTP1 |
| C-M6, R-M7 | `main.ts:13–19`, `keycloak.verifier.ts:64–67` | `configureApp`, local JWKS, storage fake |
| C-M7 | `payments.service.ts:124–128` | P6 detail; T-P4 |
| C-M8, R-L10 | `realm-insurshield.json:89`, `env.ts:14–20` | P2 owns `infra/**`; defaults removed |
| C-M9, R-M8 | `insurer-portal.service.ts:140–144`, `health.controller.ts:20–34` | T-I1, T-H1, T-H2 |
| C-L1, R-L1, C2-L1, R2-L4 | grep | Exact importer inventory (§3); no web caller of `GET /documents/:id` |
| R-M2, C2-M2, R2-L1 | `payments.service.ts:33–41,95` | P6 detail: key arbitration by insert order, field comparison; mobile number not guaranteed |
| R-M3 | grep `piaRate` | PIA floor → batch 2 |
| R-M4 | Portal and insurer services | T-X1–T-X4, T-I1 |
| R-M5 | r0 deleted Prisma migrations | `test/fixtures/prisma-era/` |
| R-M9 | Type stripping vs `.js` specifiers | Keep `tsx` |
| R-M10, C2-M1, R2-M2 | Ownership tables r0, r2 | Exact spec file names; P2 registers `DatabaseModule`; P2 specs avoid the guard; W3 gate excludes P9's files |
| R-L2, R-L4, R-L5, R-L7, R-L8, R-L9, R-L11 | — | As in r2; R-L5 completed by `MAX_KWACHA` and DTO `@Max` |
| R-L6, C2-M7, R2-L6 | `SUM` returns int8 as a string; `admin.service.ts:110–115` | `sumToKwacha` with `BigInt` and a safe-integer limit; Lusaka months (C9, U4) |
| C2-H1, R2-M1 | `dialect.js:44–72` | `migrate.ts` state table, one client, journal hash and `folderMillis`, advisory lock; T-D3–T-D5 |
| C2-H2, R2-H1, R2-H2 | `customer.service.ts:124,506–509`, `insurer-portal.service.ts:329–358`, `payments.service.ts:117` | Positive access rules; `record` unchanged for internal callers; carry-over is not an attach; endpoint tests in P4/P5 |
| C2-M3 | No unique index on `"certificateDocumentId"` | Row lock in `assertAttachable`; T-ATT1 |
| C2-M4, R2-M4, R2-M5 | `schema.prisma:733–742`; `index.js:37,70` | Store removed from this batch (U3) |
| C2-M5 | Checks only after 0000 | T-S5 |
| C2-M6, R2-L12 | DTOs lack `@Max` | `MAX_KWACHA`; T-P1 |
| C2-M8, C2-M9, R2-M6, C2-L3, R2-L5 | Rules drafts | Rules files corrected: rate scope, NCD exception, existing cross-module writes, outbox privacy and recovery, explicit currencies, strategies, append-only records; shared rules only in root |
| C2-L2, R2-L3 | Exit grep | Exceptions listed; `docs/plans` excluded |
| R2-M3 | `vitest.config.e2e.ts` at `cbef7b5` | `scratch-database.ts`, `fileParallelism: false` in W1a |
| R2-L2 | Prisma `migrate resolve` rows | One finished, not rolled-back row per name |
| R2-L7 | P0 scope wording | P0 row lists the bump and `engines` |
| R2-L8 | Keycloak skips existing realms | README note in P9 |
| R2-L9 | Suspicion | W4 check includes a write |
| R2-L10 | Exhaustive T-M1 impossible | Boundaries plus seeded random cases |
| R2-L11 | `insurers.service.ts:68` spreads the row | Explicit mapping in P7; T-HTTP1 checks exact keys |
| C3-H1, R3-H1 | Adoption left `_prisma_migrations` in `public` and never created Drizzle's table | `migrate.ts` steps 2–4: archive `_prisma_migrations`, create Drizzle's table, apply in one transaction; T-D1 second run |
| R3-H2, C3-M1 | Foreign key at init migration:677 takes `KEY SHARE` | P6 order: lock the request, then insert; T-P6; deadlock maps to `503` as a backstop |
| C3-M2, R3-M1 | `dialect.js:56–62` applies by `created_at` only | Exact `(hash, folderMillis)` prefix, catalog check per state and after applying, "empty" over all object kinds; T-D2 |
| C3-M3 | Both paths ran the same 0001 | Final catalog compared with `drizzle-kit push` of the schema; explicit type assertions; T-S5, T-D6 |
| C3-M4 | Binary64 spacing at K90 trillion is K0.015625 | Round-trip check in `sumToKwacha`; limit K22 trillion in the contract; T-AD1 |
| R3-M2 | Builder list missing shots, attachments, photos, NCD applications, PIA, inspections | `test/builders.ts` plus one `test/builders/<pkg>.ts` per package |
| R3-M3 | `customers.email`/`phone` unique; duplicate ids in one request | Filter maps unhandled unique violations to `409 CONFLICT`; `ACCOUNT_CONFLICT`; duplicate ids → `400`; T-U1, T-G1, T-DOC2 |
| C3-L1 | Scratch names lacked `_test` | `<base>_<spec>_<n>_test` |
| C3-L2, R3-L3 | Rules said `404` everywhere | Payment-key `403` named as an exception in the rules |
| C3-L3 | `prisma/seed.ts:10,20` | Inventory corrected |
| R3-L1, R3-L2, R3-L4 | Rules text | Currency rule scoped; cross-module writes corrected; idempotency exception for submit and claims |
| R3-L5 | `requireExists` lives in a P3 file | P9 takes over `documents.service.ts` in W3 |
| R3-L6 | `grep -r` walks `dist` | `git grep` |
| R3-L7 | Checksums under `test/` | `drizzle/prisma-era/`; `.gitattributes` LF |
| R3-L8 | `lock_timeout` applies to advisory waits | Wait with `lock_timeout=0`; T-D5 |
| R3-L9 | Guarantee 1 pointed at section 3 | Exceptions named |
| R3-L10 | Order of payment steps | P6 steps 1–6 |
| R3-L11 | Only payments tested `MAX_KWACHA` | Per-module cases in T-P1 |
| C4-M1, R4-L1 | `kwachaToNgwee` bound applied to sums; binary64 spacing below 2^46 is at most 2^-7 | `parseKwacha` without a bound; contract limit K70 trillion; T-AD1 |
| C4-M2 | Reader omitted functions and non-enum types | Reader lists every object kind; unknown kinds fail; T-D2 |
| C4-L1 | Rules named `test/fixtures.ts` | Rules name the builders |
| C4-L2 | Logged constraint names vs T-U1 | Constraint names allowed in logs, never values or in responses |
| R4-M1 | `ON CONFLICT ("keycloakId")` makes only that index an arbiter; web fires five requests at sign-in (`apps/web/src/api/sync.js:34–40`) | No conflict target, then select; T-G1 with five requests and a barrier |
| R4-L2 | Second copy of the Prisma SQL | One copy in `drizzle/prisma-era/`; grep allows `test/fixtures/prisma-era/` |
| R4-L3 | Inspection builder needed in W1b | Moved to `test/builders.ts` |
| R4-L4 | `SET SCHEMA drizzle` before the schema exists | Step order in the Prisma-era action |
| R4-L5 | Dropped columns; PostgreSQL 18 NOT NULL constraints | Columns by name, constraint types listed, PostgreSQL 17 stated |
| R4-L6 | Global setup dropped `public` | Recreated; Empty state creates it |
| R4-L7 | `statement_timeout` set after the wait | Set first |
| R4-L8 | Suspicion: Prisma accepts LF or CRLF checksums | Both forms accepted |
| R4-L9 | Incomplete list of cross-module writes | Rules say existing writes stay without listing them |
| R4-L10 | `customer.service.ts:751–756` | Redeem only the paid insurer's code; payment otherwise proceeds |
| R4-L11 | Opposite lock order | Sorted lock order |
| C5-L1 | `payments.service.ts:124–128` redeems any insurer's code | Wording: today the code is consumed; only payment success is unchanged |
| R5-M1 | Reader excludes `_prisma_migrations`; Empty used the reader | Whole-flow decision table over three facts with an invariant after commit; T-D1, T-D2 cases |
| R5-L1 | Internal FK triggers, implicit row types, `plpgsql` | Reader exclusions and catalogs named |
| R5-L2 | `customer.service.ts:215,340,442` | Section 3 corrected |
| R5-L3 | Wording | "may be refused"; NCD docstring named as such |
| C6-M1 | `pg_collation` and table-owned policies and rules were unlisted | Inventory of every namespace-typed catalog plus policies, rules, triggers; T-D2 |
| C6-M2 | Init migration allows negative money and rates above 100 | Guarantee 4 qualified; pre-conversion count and refusal; T-D4 |
| C6-L1 | Steps 3–4 removed in revision 6 | Restored, with the facts re-read before `COMMIT` |
| C7-M1 | PostgreSQL 17 `pg_class.relnamespace` and `pg_collation.collnamespace` are `oid`; checked `pg_depend` on a throwaway container | Schema-level inventory from `pg_depend` namespace records with `pg_identify_object`; table-level reader for policies and rules |
| R7-L1 | Same cause as C7-M1 | Closed by the `pg_depend` inventory; `_prisma_migrations` and its parts left out at both levels |
| R7-L2 | `numeric(p,s)` accepts `'NaN'`; bounds were written twice | `NaN` counted; bounds defined once in `money-limits.ts`; every failing column named; T-D4 over all seven columns |
| R7-L3 | Collation, identity, generated, persistence and row-level security were not compared | Added to relation and column records; T-D2 cases |
| R7-L4 | `dialect.js:47–51` | Drizzle's history-table statement copied exactly |
| R7-L5 | A view in another schema; an existing archive table | Both refused by name; archive absence is part of the Prisma-era row |
| R7-L6 | Cutover had no branch for a data refusal | C5 says what to do |
| R7-L7 | Round accounting and order | Round history rewritten in order with the C6 accounting |
| R7 note | `PolicyConfirmationPage.jsx:74` | Visible NCD effect added to U2 |
| C8-L1 | Plan lines 231–235 put policies and rules at table level | T-D2 controls name the level each kind is seen at |
| C8-L2 | Row split over three lines; path checked at `cbef7b5` | U2 on one line, path corrected |
| C8-L3 | Default privileges are an automatic dependency | Wording narrowed; privileges stated as outside the structural contract |
| R8-L1 | `'public'::regnamespace` raises `3F000` without `public`; `to_regnamespace` checked on PG17 | Reader uses `to_regnamespace`; NULL means empty; T-D2 Fresh-without-`public` case |
| R8-L2 | Default ACL row seen with `deptype 'a'` on PG17 | Schema level reads `'n'` and `'a'`; ACLs, owners and database-wide objects listed as not guaranteed |
| R8-L3 | Inheriting child, enum cast and outside view each found on PG17; clean schema gives none | One outside-dependant rule replaces the converted-column special case; T-D2 cases |
| R8-L4 | Foreign-key triggers are internal with `tgenabled = 'O'` | Any trigger not `'O'` refused; T-D2 case |
| R8-L5 | 0001 is hand-written SQL, so "written from" was false | Constants in `money-limits.ts`; pre-count on converted values; T-D4 compares CHECK bounds with the constants |
| R8-L6 | Same as C8-L2 | Fixed |
| R8-L7 | The refusal names columns and counts | C5 wording |
| R8-L8 | Old r5 reader paragraph kept beside the two levels; stale header | Paragraph reduced to the definition records; one exclusion; header updated |
| W1a C-H1 | node-postgres re-parses a nested `connectionString` query parameter (checked: the client opened `insurshield` while the config named a scratch database); `host`, `port` and `user` parameters also override the URL | `DATABASE_URL` and `TEST_DATABASE_URL` accept only an allow-list of query parameters; scratch configs are built from parsed parts; T-C1 cases |
| W1a C-M1, R-L1 | `migrate.ts:436` prints the driver message | Fixed text per failure kind plus `describeDatabaseError`; the catalog-definition part, first declined, is superseded by W1a C2-M2 (identities only) |
| W1a C-M2 | T-S2 fixture leaves timestamp columns empty | Every timestamp column populated and asserted per column |
| W1a C-M3 | T-W2 checks truthiness | Literal wire pairs for every mapping |
| W1a C-L1, R-L4 | Fresh row stricter than the table | Table updated; refusal test |
| W1a R-L2 | Entry-point guard compares unresolved `argv[1]` | Unconditional entry point |
| W1a R-L3, R-L8 | Prisma names from a directory listing; constants repeated | One exported list and one definition of each constant |
| W1a R-L5 | `transaction_timeout` not cleared | Step 1 clears it; test |
| W1a R-L6 | Table-level publication and outside statistics are `'a'` members (checked on PG17) | Records for members outside the described catalogs; T-D2 cases |
| W1a R-L7 | `DEFAULT CURRENT_TIMESTAMP` stores session wall time (checked on PG17 with a Lusaka database setting) | Fix round 1 added a TimeZone refusal; round 2 found it refused correct databases (C2-M1, R2-M1) and could be masked (C2-H1, R2-L1). Redesign, gated by Codex (BUILD yes): refusal removed; guarantee 5 restated as the instant the Prisma build read (adapter-pg 7.10 `index.mjs:271`, `:324`); C2-M1 and R2-M1 resolved by the removal; C2-H1, R2-L1 and R-L7 outside the restated guarantee |
| W1a R-L9 | T-D5 passes without `statement_timeout = 0`; `toMatchFileSnapshot` rewrites under `-u` | T-D5 connects with a non-zero `statement_timeout`; T-D6 compares and fails on a missing file. The redundant `= 'NaN'` clause is kept (explicit, harmless) |
| W1a round 2 | Codex (C2-) 0 Critical, 1 High, 3 Medium; reviewer agent (R2-) 0 Critical, 0 High, 2 Medium, 7 Low. Fix-introduced: C2-M1, C2-M3, R2-M1, R2-M2 (Medium) | Second fix-introduced Medium stopped patching; redesign `reviews/w1a-redesign-proposal.md`, gate yes |
| W1a C2-M3, R2-M2 | `migrate.ts` no longer ran `main()`; plan and AGENTS named it | `migrate.ts` is the command again, functions in `migrator.ts`, `migrate-cli.ts` deleted |
| W1a C2-M2 | Refusal printed definitions | Identities and difference status only; sentinel test |
| W1a R2-L3–L7 | Read against `31cf205` | Error codes in failure reasons; one URL parse in scratch configs; allow-list defined once; test hygiene; rate bounds from `money-limits.ts` (`pia.controller.ts` literals go to P7) |
| W1a round 3 | Codex (C3-) 0 Critical, 0 High, 1 Medium (diagnostic tests point the real migrator at a non-`_test` name), APPLY yes; reviewer agent (R3-) 0/0/0, 5 Low, APPLY yes, BUILD yes | C3-M1 = R3-L2: the built-entry helper refuses any target not ending in `_test`; R3-L1 role name dropped from default-ACL identities; R3-L5 a SQLSTATE is taken only from a pg `DatabaseError` in the cause chain, other codes are treated as Node codes; the printed details follow the same rule; R3-L3 row above; R3-L4 is P9's script change (apply only with `tsx src/db/migrate.ts` until then) |
| W1a final round | Codex (C4-) 0 Critical, 0 High, 0 Medium, 1 Low; reviewer agent (R4-) 0/0/0, 2 Low; both APPLY yes, BUILD yes. W1a is ready within the stated contract | C4-L1: the role check no longer depends on the configured username (`not.toMatch(/for role/)`); R4-L1: row above reworded; R4-L2: printed details come only from the server's error (`failureDetails`, unit cases) |
| W1b round 1 | Codex 0/1/1/1, BUILD no; reviewer 0/0/2/6, BUILD yes | C-H1=R-M1 log leak on connection failure; C-M1 masked access predicates; C-L1 UUID case; R-M2 multer limits (pre-existing); R-L1 customer logo public; R-L2–L4, R-L6 test and doc gaps: all fixed by w1b-fix-platform and w1b-fix-documents. R-L5 README cutover → P9 |
| W1b fix round 1 | Codex 0/1/2/1, BUILD no, all three Medium-or-worse introduced by the fix; reviewer 0/0/0/5, BUILD yes | Second fix-introduced Medium → redesign of error classification (provenance, redaction, retry kept apart; a Pool subclass marks connection acquisition). Gate r1 BUILD no (unwrapped acquisition in transactions; request-level retry overclaim); gate r2 BUILD yes. Prisma redaction declined (Not guaranteed). R-L-e fixed by the coordinator (one FILE_TOO_LARGE message) |
| W1b fix rounds 2–4 | Redesign round: Codex 0/0/2/2, reviewer 0/1/1/2 (crash on a lost transaction connection; BEGIN-failure leak, both pre-existing in the Drizzle integration) → transaction boundary design, gate r1 no (listener after checkout), r2 yes, built. Round 3: Codex 0/0/1/0 (no client-side read deadline), reviewer 0/0/0/2 → query deadline and keep-alive. Round 4 (final): Codex 0/0/0/2, reviewer 0/0/0/3; both BUILD yes | Lows fixed by the coordinator (local, plaintext-only stall proxy; marker across chunks; keep-alive delay; no `Promise.all` inside a transaction), Codex re-read: one Low (TLS check), fixed. Declined: a shutdown deadline over `pool.end()` (reviewer suspicion; needs pg-pool internals; the per-query deadline bounds every database wait and the container stop grace bounds the rest). W1b ready within the contract |
