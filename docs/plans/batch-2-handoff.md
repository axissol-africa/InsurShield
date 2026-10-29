# Batch 2 handoff (29 October 2026)

Batch 2 replaces Keycloak with Better Auth. The plan is [`batch-2-better-auth.md`](batch-2-better-auth.md): its
decisions (section 0), packages (section 4), waves (section 5), tests per rule (section 7) and review findings
(section 10) are the reference. This note says where the work stopped and how to pick it up.

## Where it stands

| Wave | Packages | State |
| --- | --- | --- |
| W0, W1 | P0, E, S (M1) | Done. M1 (`drizzle/0002_better_auth.sql`) is applied to the development database and frozen |
| W2a | A: Better Auth in the API | Done and reviewed (this branch) |
| W2b | B (ten older e2e specs), C (seed), W (web sign-in and service worker) | Not started |
| W3 | K (Keycloak removal, docs), S (M2, then M3) | Not started |
| W4a, W4b | D1, D3, D4, D8, N; then D6 | Not started |
| W5 | S (M4) | Not started |

The plan planned A, B and C as one commit. They are split here because the work stopped after A: this branch holds A
alone.

## What package A does

- Better Auth 1.7.12 runs inside the API on its own pool, mounted at `/<API_PREFIX>/identity`. Only these routes answer
  (everything else under the mount is 404): `POST register`, `sign-in/email`, `sign-out`, `revoke-sessions`,
  `change-password`; in `development` and `test` only, the four mail routes.
- Sessions are database sessions in the cookie `insurshield.session_token` (`__Secure-` on HTTPS), lasting a fixed
  7 days; the cookie cache is off, so closing an account or changing a password takes effect on the next request.
- `AuthGuard` reads the session; `resolveIdentity` (`src/auth/identity.ts`) is the one rule that turns a user into a
  customer or staff principal or refuses them. The `X-InsurShield-User` precondition answers 409 when the tab's user
  is not the session's.
- Sign-in attempts are limited per email in `auth_sign_in_failures`, and password changes on their own counter per
  user, both counted before the password is checked. Better Auth's own rate limit runs with database storage.
- Request bodies on identity routes are limited to 8 KiB with a stated length. The request URL is rewritten to the
  configured `BETTER_AUTH_URL` before Better Auth sees it. The client address comes from Express with
  `TRUST_PROXY_HOPS`.
- Better Auth logs through the Nest logger with database errors reduced to their code; unexpected failures on the
  identity routes answer as the Nest error filter does (`answerFailure`, one definition).
- Removed: `keycloak.verifier.ts`, `test/jwks.ts` and the `KEYCLOAK_*` settings.

## Verification at handover

On the final state, after a fresh `nest build`, against a throwaway PostgreSQL 17:

- Unit suite: 32 files, 521 passed.
- Package A's twelve e2e files (`auth-guard`, `identity`, `identity-production`, `swagger`, `auth-service`,
  `harness`, `schema`, `migrate`, `migrate-refusals`, `health`, `transactions`, `vehicles`): 357 passed.
- `tsc --noEmit` over the API: 0 errors in `src`; 15 errors, all in package B's ten specs (below).
- oxlint clean on package A's files.
- Not run: the whole API e2e suite (B's specs do not compile), the web's unit and browser tests, repository-wide lint
  and build, the manual run of exit criterion 5.

Package A went through five review rounds, each by Codex and an independent reviewer with a security hunt. The last
round ended with no finding at any severity. Section 10 of the plan has every finding and what was done with it.

## Known gaps in this branch

1. **Package B's ten specs do not compile.** `test/{admin,customer,documents-access,documents-upload,error-filter,
   inspections,insurer-portal,insurers,payments,pia}.e2e-spec.ts` still import the deleted JWT helpers. So
   `npm run test:e2e -w @insurshield/api` fails until B is done.
2. **The web cannot sign in against this API** (it still sends Keycloak tokens) until package W lands. Mock mode is
   unaffected.
3. **The seed still provisions staff through Keycloak** (`scripts/keycloak-admin.ts`) until package C.
4. **Docs still describe Keycloak** until package K: README (including `NODE_ENV`, now required), `apps/api/README.md`,
   `docs/DEPLOYMENT.md`, both `AGENTS.md` files.

## Before this build runs anywhere

`apps/api/.env` needs the new settings from `apps/api/.env.example`: `BETTER_AUTH_SECRET` (at least 32 characters),
`BETTER_AUTH_URL` (the API's public origin), `TRUST_PROXY_HOPS` (0 for local development), and `NODE_ENV`, which is
now required. `AUTH_RATE_LIMIT` defaults to `on`. The `KEYCLOAK_*` settings are no longer read. The database must be
at M1 or later. Node.js 24.15 or newer and npm 11.13 or newer, as `AGENTS.md` says.

## Decisions taken with the user

All of section 0 and the section 8 answers in the plan, plus two on 29 October 2026, both recorded in the plan as
"Not guaranteed":

- **Password-change race (Sessions).** A sign-in or another password change running at the same moment as a password
  change may keep a session, because Better Auth checks the password before its writes, which commit one by one.
  Closing it needs every credential check and write serialised per user: a later hardening item. Two designs short
  of that were refused by design review (section 10, row "B2-A race").
- **Fallback-join console print (Logging).** When the user or account query behind a session or sign-in lookup fails,
  Better Auth prints that query, the user id and a stack to the console directly. No credential is in it. Native
  joins close it; they need relations on the shared Drizzle instance, so they belong to whoever next owns `schema.ts`
  and the database module.

Also by design: identity bodies must state their length; chunked bodies answer 413. K documents that a deployment
proxy must forward the length.

## What remains, in order

1. **B, C and W (W2b), in parallel, one owner each.**
   - B owns only the ten specs. Each signs in through `test/sessions.ts`; no assertion changes except the status codes
     the new guard defines; Keycloak-only failure cases are removed, each mapped to the A test that replaces it. Count
     each spec's cases before (at `f996651`) and after.
   - C owns `apps/api/scripts/**` and deletes `keycloak-admin.ts(+spec)`. Staff and the demo customer are created
     with `createCredentialUser` (`src/auth/credential-user.ts`, do not copy it), password `SEED_STAFF_PASSWORD`,
     reset only with `SEED_RESET_PASSWORDS=true`. The seed never links to an account it did not create (plan item C,
     T-SD1-T-SD7, each written first).
   - W owns the web files in its row, including the service worker note "W, service worker" and the identity
     boundary. It is the largest package and has browser tests.
2. **K and S (W3).** K removes Keycloak from Compose, infra and docs, and carries the README `NODE_ENV` row and the
   proxy note above. Migrations M2 then M3, each reviewed and landed with a checked backup.
3. **D1, D3, D4, D8, N (W4a)**, then **D6 (W4b)**, then **M4 (W5)**, then the exit criteria in section 3.

Later hardening, outside batch 2: per-user serialisation of credential operations; native joins; a periodic sweep of
`auth_sign_in_failures`.

## How the work was run

Every package was built test first (a failing test before each fix) in a separate copy of the repository, never in a
running app. Each package and fix round was reviewed read-only by a second model and by an independent reviewer, with
a security hunt, before it was called done; every confirmed finding was fixed or put to the user. A migration is
applied only after both reviewers agree, from a checked backup, and is frozen once applied.
