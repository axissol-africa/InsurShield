# InsurShield repository instructions

<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->
YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.
DO NOT STOP TO ASK "SHOULD I PROCEED?" — PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.
IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.
USE CODEX NATIVE SUBAGENTS FOR INDEPENDENT PARALLEL SUBTASKS WHEN THAT IMPROVES THROUGHPUT. THIS IS COMPLEMENTARY TO OMX TEAM MODE.
<!-- END AUTONOMY DIRECTIVE -->

## Scope and ownership

These instructions apply to the whole repository. Read the relevant app's instructions before changing it:

- [Web instructions](apps/web/AGENTS.md) apply to `apps/web/`.
- [API instructions](apps/api/AGENTS.md) apply to `apps/api/`.

App instructions supplement these shared rules. User instructions and explicitly approved task boundaries take precedence.

| Location | Responsibility |
| --- | --- |
| `apps/web/` | React and Vite application, including customer, insurer, and administrator features |
| `apps/api/` | NestJS API, business rules, integrations, and Drizzle schema and migrations |
| `packages/` | Reusable workspace packages with actual consumers |
| `infra/` | PostgreSQL and Keycloak configuration |
| `docs/` | Product requirements and technical documentation |
| `design/` | Design references and screen exports |
| `output/` | Versioned document and backlog exports |
| `scripts/` | Repository-wide tooling |

## Working agreements

- Inspect the current implementation and relevant requirements before editing. Distinguish agreed requirements from prototype behavior and proposed work.
- Keep changes bounded, reviewable, and reversible. Preserve unrelated work and avoid dependency upgrades during structural changes.
- For cleanup or refactoring, write a short plan and add missing regression coverage for the behavior being changed before editing.
- Prefer existing utilities and patterns. Add a shared package when there is a concrete reuse need; do not create placeholder packages or speculative abstractions.
- Do not import source files directly from one application into another. Shared contracts or logic belong in a deliberately scoped package when extraction is needed.
- Add dependencies only when explicitly requested. Do not push, deploy, reset a database, or perform destructive cleanup without the required user authorization.
- Use native subagents for independent, bounded tasks when that improves throughput. Keep file ownership clear and own final integration and verification.

## Workspace and tooling rules

- Use npm workspaces and Turborepo. Workspace paths are `apps/*` and `packages/*`; application names are `@insurshield/web` and `@insurshield/api`.
- Keep one `package-lock.json` at the repository root. Do not introduce per-app lockfiles or a second package manager.
- Use Node.js 24.15 or newer in the Node 24 LTS line and npm 11.13 or newer in the npm 11 line for the current dependency set.
- Run shared commands from the root. Use `-w @insurshield/web` or `-w @insurshield/api` for app-specific commands.
- Keep environment files, credentials, dependency directories, test reports, and build output out of commits. Preserve local environment files during moves.
- Keep schema migrations under `apps/api/drizzle/`. Build the API Docker image from the repository root with `-f apps/api/Dockerfile`.
- When changing a workspace path or name, update root commands, the lockfile, Docker paths, launch configuration, and documentation links together.

## Configuration

- Every setting comes from environment variables. No credentials, hosts, ports or database names in code, Compose
  files or tests; Compose reads them from the root `.env` and refuses to start when one is missing.
- `.env` files are local and git-ignored. Each `.env.example` documents every variable it needs with `CHANGE_ME`
  placeholders. A new setting goes in the example file and in the README's Configuration table.
- Error messages name a variable but never print its value.

## Code and comments

- Keep it plain and idiomatic. No speculative abstractions, no TODOs.
- Comments only where the code cannot say why.

## Verification

Run targeted checks first, then the checks appropriate to the full change:

```bash
npm ci
npm run lint
npm run test
npm run build
npm exec -w @insurshield/api -- tsc --noEmit
npm run test:e2e -w @insurshield/api
npm run test:e2e -w @insurshield/web
```

- A bug fix starts with a failing test. No `.skip` or `.only`.
- Run `npm ci` when dependency metadata or workspace layout changes, not before every edit.
- API integration checks use `npm run test:e2e -w @insurshield/api` and require the configured services. Do not claim they passed when prerequisites were unavailable.
- For a layout-only change, verify workspace discovery, dependency versions, local links, and packaging paths in addition to application checks.
- Report what changed, the checks that passed, and any remaining failures or unavailable checks. Separate existing failures from regressions.

## Commit messages

Small commits, one change each. Follow the Lore protocol whenever making a commit. Lead with why the change was made. Add only the trailers that carry useful decision context:

```text
<intent line>

Constraint: <external constraint>
Rejected: <alternative> | <reason>
Confidence: <low|medium|high>
Scope-risk: <narrow|moderate|broad>
Directive: <guidance for future changes>
Tested: <completed verification>
Not-tested: <known verification gaps>
```

Do not claim unrun checks or include empty template trailers.
