# InsurShield API engineering rules

These instructions apply to `apps/api/` and supplement the [root instructions](../../AGENTS.md), which hold the
shared rules on configuration, code and comments, tests and commits.

## Stack

- Node 24 LTS (24.15 or newer), npm workspaces. Run commands from the repository root with `-w @insurshield/api`.
- NestJS 12 as ESM: relative imports end in `.js`.
- PostgreSQL in Docker Compose, Drizzle ORM with drizzle-kit migrations in `drizzle/`.
- Keycloak issues the tokens this API verifies; documents live in S3-compatible storage (MinIO locally).
- class-validator DTOs, Swagger UI at `/docs` when `SWAGGER_ENABLED=true`.
- Vitest: unit tests in `*.spec.ts` next to the code, e2e tests in `test/*.e2e-spec.ts`.

```bash
cp .env.example .env && cp apps/api/.env.example apps/api/.env   # then replace every CHANGE_ME
npm run infra:up                          # Postgres, MinIO, Keycloak
npm run db:migrate                        # apply migrations (src/db/migrate.ts)
npm run dev:api                           # run the API
npm run lint -w @insurshield/api && npm run build -w @insurshield/api
npm run test -w @insurshield/api          # unit tests
npm run test:e2e -w @insurshield/api      # e2e tests against the test database
```

## Layout

- `src/db/`: Drizzle schema, database module, migration entry point and database error helpers.
- `src/config/`: environment variables, read and validated once in `env.ts`.
- `src/common/`: the error filter, guards, money helpers and the wire contract shared by every module.
- `src/<module>/`: one folder per business capability (customer, insurer-portal, payments, insurers, admin, pia,
  inspections, vehicles, documents, storage, auth, health).
  - `domain/`: pure functions and types. No Nest, database, HTTP or configuration imports. Time, generated
    identifiers and other external inputs are passed in.
  - `<module>.controller.ts`: HTTP only. Validates input, obtains the authenticated principal, calls the service and
    maps results and errors to responses.
  - `<module>.service.ts`: use cases. Owns transactions, enforces authorization and tenancy, calls the domain functions.
  - `<module>.repository.ts`: all SQL for the module. Returns rows mapped to the module's types.
  - `dto/`: request and response shapes, and the mapping between wire values and stored values. Responses are
    mapped field by field; a database row is never spread into a response.
- Dependencies point inwards: controller → service → domain, and service → repository. The domain imports nothing
  from the other layers.
- Keep the API a modular monolith. Each module owns its state changes; another module calls its service instead of
  writing its tables. Existing cross-module writes stay until they are moved deliberately; do not add new ones.
- Do not introduce microservices, event sourcing, a message broker, a new database or new dependencies without an
  explicit task requirement and authorization.

## Design

- No speculative abstractions: no generic repositories, no interface with a single implementation. A port (an
  interface with an adapter) is for an external system: Keycloak, object storage, insurer systems, RTSA, payment
  providers. Define it around the operation the use case needs, not the whole SDK.
- Keep provider credentials, request formats, retries and error translation in the adapter. Preserve provider
  correlation identifiers.
- Use a strategy only when insurers or products differ materially in pricing, eligibility or inspection. Keep a
  common input and output, select it explicitly, test each variant. Configurable values are data, not strategies.
- Parse external data at the boundary and validate business invariants in the domain. Use discriminated unions for
  alternative states. No `any`, unchecked casts or non-null assertions to silence the compiler.
- Domain failures do not know HTTP status codes; the controller or the error filter translates them.

## Money and dates

- Money is an integer number of minor units (ngwee), stored as `bigint`. No floating-point arithmetic on amounts.
  Existing money columns are ZMW; a new money column carries its currency.
- Rates that multiply money are integer basis points (5.25% is `525`) and appear as percentages only on the wire.
  NCD discounts (`ncdPercentage`, `ncd_codes.percentage`) are whole percentages.
- Rounding is done in one domain function: half-up to the minor unit.
- Conversion between wire values (Kwacha with two decimals, percentages) and stored values happens only in the DTO
  mapping, through `src/common/money.ts`. Amounts above `MAX_KWACHA` are refused with `400`.
- System timestamps are `timestamptz` in UTC. "Today" and calendar months for a business rule are those of Lusaka.
- New business dates (cover start and end, incident date) are `date` columns. Existing ones are still timestamps
  until they are converted.

## Workflows

- Define the allowed transitions for quotes, payments, policies, claims, NCD applications and inspections in the
  domain, and change a status only through those functions.
- Protect a transition against concurrent updates with a row lock, a conditional update or a constraint, and check
  the number of rows changed. An in-memory status check alone is not enough. A unique clash answers `409`, not `500`.
- Duplicate callbacks and retried commands are safe. An idempotent POST replays the original response; the same key
  with a different request is rejected with `409`. A rejected request does not use up its key. Quote submission
  and claim notification are not idempotent yet.
- Audit and consent records are append-only: a correction is a new row.
- Do not hold a database transaction open during a network call. Model recovery or compensation when a workflow
  spans external services.
- Name events after completed facts (`PaymentConfirmed`) and keep payloads minimal: no credentials, no personal data
  the consumer does not need. When an event or external action must survive a crash, write an outbox row in the
  same transaction as the change and deliver it after commit with a stable event id, bounded retries and visible
  failures, at least once, to an idempotent consumer.
- Separate a read model from the commands when their data needs diverge (dashboards, reports); the read model still
  enforces access and tenant filters.

## Security

- Enforce authorization and insurer tenancy in the service as well as in route guards, so an internal caller cannot
  bypass ownership checks. Every query an insurer user can reach filters by that insurer; every query a customer can
  reach filters by that customer. A record the principal may not see answers `404`. The one exception: a payment
  key that belongs to another customer answers `403`, as it always has.
- A document link is given only to a principal related to the document (see `src/documents/`).
- Preserve authorization, tenancy, idempotency, audit records and the public contract when refactoring.

## HTTP contract

- The contract with `apps/web` is `apps/web/src/api/contracts.js`. The HTTP API uses camelCase fields; enum values on
  the wire are the strings `src/common/contract.ts` maps.
- Error responses have the shape `{ code, message, details }` with a stable `code`. Database timeouts answer
  `503 TRY_AGAIN`; unexpected failures answer `500 INTERNAL_ERROR`, with details logged on the server only and never
  query parameters.

## Configuration

- Settings are read and validated in `src/config/env.ts`; `apps/api/.env.example` documents each one.
- `DATABASE_URL` and `TEST_DATABASE_URL` accept only the query parameters `URL_PARAMETERS` in `src/config/env.ts`
  lists; any other parameter can redirect or reconfigure the connection. `TEST_DATABASE_URL` must name a different
  database ending in `_test`.

## Database

- Every schema change is a drizzle-kit migration in `drizzle/`, applied through `npm run db:migrate`. Never edit an
  applied migration; add a new one. Write a migration that changes a column's type or name by hand.
- Adding: schema first, then the code that needs it. Removing or narrowing: code first, then the schema.
- Repository methods take the transaction they run in when the use case needs atomicity. A repository never commits
  part of an operation that the service expects to be atomic.
- A request's database writes run in one transaction. After a request has committed a write, nothing it still does
  (a second transaction, a read, building the response) may answer `503 TRY_AGAIN`. The one exception is customer
  provisioning, whose `ON CONFLICT DO NOTHING` insert is safe to repeat.
- Start a transaction only with `db.transaction` on the injected `DATABASE`, never with `pool.connect()` or a
  `drizzle(client)` of your own: the database module owns the client's release and its connection errors.
- Inside a transaction, never catch a database error and carry on: PostgreSQL turns the later `COMMIT` into a
  silent `ROLLBACK`. Let it propagate, or use a nested `tx.transaction` (a savepoint) for a step that may fail.
- A transaction's statements run one after another, never through `Promise.all`: they queue on one connection,
  and the time a statement waits in that queue counts toward its read deadline.
- Tests use a separate test database whose name ends in `_test`.

## Tests

- Domain functions have unit tests. Endpoints, money rules, tenancy, idempotency and workflow transitions have e2e
  tests against real Postgres; e2e specs create their data through `test/builders.ts` and `test/builders/<module>.ts`.
- For workflow changes, test invalid transitions, duplicate delivery, concurrency (with the interleaving forced, not
  left to timing) and failure recovery as well as the successful path. Test outcomes, not private methods.
- Before calling work done, run lint, build, the type check, unit tests and e2e tests, and report any check whose
  prerequisites were unavailable.
