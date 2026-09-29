# InsurShield

Zambian motor-insurance marketplace: customers compare final quotes from every approved insurer, pay, and receive the insurer-issued policy certificate; insurers and the InsurShield administrator work from their own portals.

This is a monorepo managed with [npm workspaces](https://docs.npmjs.com/cli/using-npm/workspaces) and [Turborepo](https://turborepo.dev).

| Workspace / folder | Contents |
| --- | --- |
| [`frontend/`](frontend/) | The web app (React 19 + Vite PWA). See [`frontend/README.md`](frontend/README.md), [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md). |
| [`backend/`](backend/) | The API (NestJS 12 + PostgreSQL via Prisma). Implements the contract in [`frontend/src/api/contracts.js`](frontend/src/api/contracts.js). See [`backend/README.md`](backend/README.md). |
| [`packages/`](packages/) | Shared packages consumed by both apps (currently empty). |
| [`docs/`](docs/) | [Deployment](docs/DEPLOYMENT.md), [insurer system integration](docs/INSURER_API_INTEGRATION.md), [customer entry / identity / consent flow](docs/CUSTOMER_ENTRY_IDENTITY_CONSENT_FLOW.md). |
| [`design/`](design/) | Original design references: the Stitch screen exports (`screens/<screen>/code.html` + `screen.png`) and the original design-system notes. The live design tokens are in `frontend/src/index.css` and `frontend/DESIGN.md`. |

## Quick start

Requires Node.js 24 LTS and Docker. One command installs every workspace, starts
Postgres and MinIO, applies migrations and loads reference data:

```bash
cp backend/.env.example backend/.env
npm run setup
```

Then run both apps together:

```bash
npm run dev
```

The frontend serves on http://localhost:5173 and the API on http://localhost:4000.
The frontend defaults to `VITE_API_MODE=mock` (browser storage, no backend
needed); set it to `http` in `frontend/.env.local` to call the real API.

Or one at a time:

```bash
npm run dev:web   # frontend only
npm run dev:api   # backend only
```

Prototype credentials and the frontend-specific command list are in [`frontend/README.md`](frontend/README.md).

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
npx turbo run build --filter=frontend
npm run test -w backend
```

## Adding a dependency

Always install into the workspace that needs it, from the root:

```bash
npm install axios -w frontend
npm install @nestjs/config -w backend
npm install -D typescript -w backend
```

## Data and storage

The database schema is [`backend/prisma/schema.prisma`](backend/prisma/schema.prisma),
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
docker build -f backend/Dockerfile -t insurshield-api .
docker build -f backend/Dockerfile --target migrator -t insurshield-migrator .
```

## Conventions

- **One lockfile.** `package-lock.json` lives only at the repo root; workspaces must not have their own.
- **Keep shared tooling versions aligned.** Both workspaces currently share one hoisted copy of `vitest`. If the two packages pin different major versions of a test or build tool, npm hoists one and nests the other, and the nested copy can bind to the wrong instance at runtime. Bump them together.
- **Shared code goes in `packages/`.** Create `packages/<name>` with its own `package.json`, then depend on it as `"@insurshield/<name>": "*"` — npm links it automatically and Turbo orders builds accordingly.
- **Commit migrations, not generated code.** `backend/prisma/migrations/` is committed; the Prisma client in `backend/src/generated/` is rebuilt on install.
- **Secrets stay out of the repo.** `backend/.env` is ignored; `backend/.env.example` documents every variable and carries only local-development values.
