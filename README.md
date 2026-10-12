# InsurShield

Zambian motor-insurance marketplace: customers compare final quotes from every approved insurer, pay, and receive the insurer-issued policy certificate; insurers and the InsurShield administrator work from their own portals.

This is a monorepo managed with [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) and [Turborepo](https://turborepo.dev). Repository working rules are in [AGENTS.md](AGENTS.md), with additional instructions in each application.

| Workspace / folder | Contents |
| --- | --- |
| [`apps/web/`](apps/web/) | `@insurshield/web`: the web app (React 19 + Vite PWA). See [`apps/web/README.md`](apps/web/README.md), [`apps/web/ARCHITECTURE.md`](apps/web/ARCHITECTURE.md), and [web engineering rules](apps/web/AGENTS.md). |
| [`apps/api/`](apps/api/) | `@insurshield/api`: the API (NestJS 12 + PostgreSQL via Prisma). Implements the contract in [`apps/web/src/api/contracts.js`](apps/web/src/api/contracts.js). See [`apps/api/README.md`](apps/api/README.md) and [backend engineering rules](apps/api/AGENTS.md). |
| [`packages/`](packages/) | Shared packages consumed by both apps (currently empty). |
| [`docs/`](docs/) | [Deployment](docs/DEPLOYMENT.md), [insurer system integration](docs/INSURER_API_INTEGRATION.md), [customer entry / identity / consent flow](docs/CUSTOMER_ENTRY_IDENTITY_CONSENT_FLOW.md). |
| [`design/`](design/) | Original design references: the Stitch screen exports (`screens/<screen>/code.html` + `screen.png`) and the original design-system notes. The live design tokens are in `apps/web/src/index.css` and `apps/web/DESIGN.md`. |
| [`infra/`](infra/) | Local infrastructure configuration for PostgreSQL and Keycloak. Docker Compose remains at the repository root. |
| [`output/`](output/) | Versioned Word documents and Zoho backlog exports. |
| [`scripts/`](scripts/) | Repository scripts, including the Zoho backlog generator. |

## Quick start

Use Node.js 24.15 or newer in the Node 24 LTS line, npm 11.13 or newer in the npm 11 line, and Docker. One command installs every workspace, starts
Postgres and MinIO, applies migrations and loads reference data:

```bash
cp apps/api/.env.example apps/api/.env
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

Postgres and MinIO run in Docker ([`docker-compose.yml`](docker-compose.yml)).

| Command | What it does |
| --- | --- |
| `npm run setup` | Install, start the services, migrate and seed — the one-shot first run |
| `npm run infra:up` | Start Postgres and MinIO |
| `npm run infra:down` | Stop them (add `-v` to the compose command to drop the data) |
| `npm run infra:logs` | Tail the service logs |
| `npm run db:migrate` | Apply schema changes |
| `npm run db:seed` | Load reference data (idempotent) |
| `npm run db:studio` | Browse the database in Prisma Studio |

| Service | URL | Credentials |
| --- | --- | --- |
| Postgres | `localhost:5432` | `insurshield` / `insurshield` |
| MinIO console | http://localhost:9001 | `insurshield` / `insurshield-dev-secret` |

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

## Data and storage

The database schema is [`apps/api/prisma/schema.prisma`](apps/api/prisma/schema.prisma),
modelled on the API contract. Two rules run through it:

- **Files never go in the database.** The `Document` model holds metadata and an
  object-storage key; the bytes live in a private bucket and are served as
  short-lived signed URLs. MinIO locally, S3 in production — the same code path.
- **Money is `Decimal`, never `Float`.** Premiums are ZMW and must reconcile
  exactly with the insurer's own quotation document.

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
- **Commit migrations, not generated code.** `apps/api/prisma/migrations/` is committed; the Prisma client in `apps/api/src/generated/` is rebuilt on install.
- **Secrets stay out of the repo.** `apps/api/.env` is ignored; `apps/api/.env.example` documents every variable and carries only local-development values.
