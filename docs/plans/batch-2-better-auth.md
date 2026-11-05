# Batch 2: Keycloak to Better Auth, and seven product fixes

Built on `main` after PR #8 (the Drizzle batch, `abf574a`) merges. The API, infra, docs and root config below were
read in the mirror at `abf574a`; the web was read from `origin/main` (`2a708a2`), which has four web-only commits that
`abf574a` lacks. Each claim in section 1 says which tree it comes from.

## 0. Decisions (user, 2026-10-24 and 2026-10-25)

- 2026-10-24: "we are removing keycloak from this project, we can use better auth"; as batch 2 after the Drizzle batch.
- 2026-10-25: "this app in not in production yet, so we dont have to be very careful with the migration from keycloak
  to better auth. we can either ignore and start move fast". So:
  - No account or password migration, no import tool, no period with both running. People re-register.
  - The seed creates staff through Better Auth with `SEED_STAFF_PASSWORD` from `.env`; no password in code.
  - Keycloak leaves Compose, `infra/`, config, seed, tests and docs entirely. The frozen `drizzle/prisma-era/` files,
    the migration catalogs and `test/fixtures/prisma-era/` keep their Keycloak names: they are history.
  - The schema may change in fewer steps than code-first-then-schema, but every migration is reviewed before it is
    applied to a kept database, and the build at each commit works on its own schema.
  - "Move fast" covers the data migration only: reviews and per-commit approval still apply.
- 2026-10-25, product decisions, each a package or part of one here:
  1. Every API status input also accepts the readable values the API sends out (`src/common/contract.ts`), as well as
     stored ones. Fixes the insurer-portal NCD decision ("Approved"/"Under Review"/"Rejected") and the admin insurer
     Active/Inactive toggle.
  2. A REJECTED NCD application may still be decided again; APPROVED stays final (`canDecideNcd` in
     `src/insurer-portal/domain/portal.ts`). The portal wording that says rejection is final changes.
  3. A super admin can restore a deleted insurer; it returns INACTIVE with its users, products and history.
  4. `GET /vehicles/lookup`: guests get only the registry stand-in answer (`lookupFromRegistry`); stored vehicle
     details only for a signed-in customer with a quote request or policy on that vehicle.
  5. Each quote request and policy keeps the vehicle details it was submitted with; customers can no longer overwrite
     the shared per-plate `vehicles` row; a migration backfills existing requests from the current vehicle row.
  6. The RTSA anniversary fee becomes a server setting (env, documented in `.env.example` and README); the API derives
     and checks it from the request's alignment choice; the web stops sending it and shows what the API returns.
  7. The seed password stays in `.env`: no change beyond carrying it into the Better Auth seed.
  8. `GET /health/ready` answers 503 with the same body when a dependency is down; `/health` stays 200;
     `test/health.e2e-spec.ts` and `docs/DEPLOYMENT.md` change with it.
- The `better-auth` dependency is approved in principle (the user asked for Better Auth); its exact version and what
  it pulls in are confirmed in section 8, question 7.
- 2026-10-25: the user accepted every recommendation in section 8 (questions 1-17: "Accept all"), including
  `better-auth` pinned at 1.7.12 (question 7), the NCD wording of question 12, resetting the development database at
  the switch (question 13), and the per-email limit (question 16 (a)). Section 8 stays as the record of the options.
  Accepting the plan is not approval to commit, push or apply a migration: each is asked for separately.

## 1. What exists today (verified how)

### Authentication in the API (mirror at `abf574a`, read)

- Auth routes are only `GET /auth/me` and `POST /auth/consent` (`src/auth/auth.controller.ts`). The API issues no
  tokens and never sees a password.
- `AuthGuard` is the global `APP_GUARD` (`src/app.module.ts:41`). It reads `Authorization: Bearer`, verifies the JWT
  with `KeycloakVerifier` (`src/common/auth/keycloak.verifier.ts`: JWKS from `KEYCLOAK_ISSUER`, pinned issuer and
  audience, RS256), then builds the `Principal` (`src/common/auth/auth.types.ts`):
  `{kind:'customer', id, email}` or `{kind:'staff', id, email, role, insurerId}`. `@Public()` skips it; `@Roles()`
  restricts to staff roles. There is no "optional sign-in" mode.
- A staff member's **role comes from the token's realm roles**, not from `staff_users.role`; the row only links the
  account and carries `insurerId` and `isActive` (`src/auth/auth.service.ts` `resolveStaff`).
- A customer row is created on the first authenticated call (`resolveCustomer`, `INSERT … ON CONFLICT DO NOTHING`),
  with the phone placeholder `pending:<keycloakId>`; `me` and `src/admin/dto/admin-response.dto.ts:49` each hide the
  placeholder (two copies of one rule).
- Closing an account (`DELETE /account`, `src/customer/account.service.ts`) sets `customers.deletedAt`; the guard then
  answers 403 `ACCOUNT_CLOSED` (`src/common/auth/messages.ts`, also used by `src/payments/payments.service.ts:63`).
  No session is revoked, because there are none on this side.
- Schema (`src/db/schema.ts`): tables are snake_case, columns camelCase and quoted (`"keycloakId"`). Most ids are
  `uuid` from the `id()` helper (`uuid('id').primaryKey().$defaultFn(randomUUID)`, line 77); quote-request ids and
  policy numbers are text (`schema.ts:279,430`). `customers."keycloakId"` and `staff_users."keycloakId"` are
  `text NOT NULL` with unique indexes. `customers_email_key`, `customers_phone_key` and `staff_users_email_key` are
  plain unique indexes, so email uniqueness is case-sensitive today.
- Migrations: `drizzle/0000_baseline.sql`, `drizzle/0001_minor_units_timestamptz.sql`, each with a
  `drizzle/catalog/<name>.json` that `src/db/catalog.spec.ts` and the migrate e2e compare against.
- `configureApp` (`src/app.setup.ts`) sets the global prefix `API_PREFIX` (default `api/v1`, `health` excluded),
  `enableCors({ origin: CORS_ORIGINS, credentials: true })`, the validation pipe and the error filter. It is shared by
  `main.ts` and the e2e `startApp` (`test/helpers.ts`). No trust-proxy setting, no rate limiting, no helmet.
  `POST /auth/consent` stores `request.ip` on the consent record (`auth.controller.ts:31`); without a trust-proxy
  setting that is the socket address, which behind a load balancer is the balancer's.
- `GET /auth/me` maps both `SUPER_ADMIN` and `ADMIN` to the portal role `'admin'` (`auth.service.ts` `PORTAL_ROLE`),
  and the admin dashboard reads only that (`AdminDashboard.jsx:205-206`, `origin/main`), so the web cannot tell a
  super admin from an admin today.
- Swagger declares a bearer scheme "A Keycloak access token" (`src/swagger.ts:13`).
- There is no mail or SMS delivery anywhere in the API (grep for nodemailer, smtp, sendMail, sms, twilio: none).
- An `audit_logs` table exists (`schema.ts:664`); nothing writes admin insurer changes to it.

### Keycloak footprint (mirror, `git grep -l -i keycloak abf574a`)

54 files, as the brief said: root and API `.env.example`, `AGENTS.md`, `apps/api/AGENTS.md`, both READMEs,
`docs/DEPLOYMENT.md`, `docker-compose.yml` (service `keycloak`, `KEYCLOAK_DB` on postgres), `infra/keycloak/**`,
`infra/postgres/01-databases.sh` (creates `KEYCLOAK_DB`), `src/config/env.ts(+spec)` (`KEYCLOAK_ISSUER`,
`KEYCLOAK_AUDIENCE`, `KEYCLOAK_CLIENT_ID`, `KEYCLOAK_CLIENT_SECRET`), the auth module and guard, `src/swagger.ts`,
`src/db/schema.ts`, `src/db/migrator.ts` (the prisma-era migration name `20260924115721_keycloak_identity`: history,
stays), `scripts/keycloak-admin.ts(+spec)`, `scripts/seed-database.ts(+spec)`, `scripts/seed-errors.ts(+spec)`,
`scripts/demo-data.ts`, `scripts/seed.e2e-spec.ts`, `test/jwks.ts`, `test/global-setup.ts`, `test/builders.ts`, nine
e2e specs, `test/fixtures/prisma-era/data.sql` (history, stays), the drizzle baseline, snapshots and catalogs
(history, stay), `docs/plans/batch-1-drizzle-migration.md` (history, stays), web `.env.example` and
`tests/journey.spec.js` (web, mirror copy; same on `origin/main`).

### The e2e harness (mirror)

- `test/global-setup.ts` starts a JWKS server (`test/jwks.ts`) and points `KEYCLOAK_ISSUER` at it; specs sign their
  own tokens with `customerToken(customer)` / `staffToken(staff, ['admin'])` and send `bearer(token)`.
- 13 spec files use these helpers: admin, auth-guard, auth-service, customer, documents-access, documents-upload,
  error-filter, harness, inspections, insurer-portal, insurers, payments, pia. Most use them in one `beforeAll` or a
  small table of callers; auth-guard has 15 uses.
- `test/builders.ts` `buildCustomer` / `buildStaffUser` insert rows with `keycloakId: randomUUID()`.

### The seed (mirror)

- `scripts/seed-database.ts` loads reference data, then, only when Keycloak is configured, upserts staff in Keycloak
  (`scripts/keycloak-admin.ts`) with `SEED_STAFF_PASSWORD` (refused when `CHANGE_ME`) and links `staff_users` by
  email; `SEED_RESET_PASSWORDS`, `SEED_DEMO_DATA`, `SEED_RESET_DEMO` exist. Without Keycloak it skips staff and demo
  data. `scripts/demo-data.ts` has one demo customer (`keycloakId: 'demo-customer-bwalya'`), keyed on email.

### Sign-in in the web (`origin/main`, read)

- **No page calls `api.auth.*`.** Customer sign-up, sign-in and password reset run in the Zustand store in both
  modes (`src/store/slices/session.js`: `registerCustomerAccount`, `authenticateCustomer`, `resetCustomerPassword`,
  accounts with passwords in browser storage). `src/features/auth/pages/CreateAccountPage.jsx` shows a demo
  verification code `1234` for sign-up and recovery, says so on screen, and then the consent step.
- The customer sign-in identifier is **email or phone** (`matchesIdentifier`). Sign-up collects full name, email,
  phone, password (8 characters minimum) and consent.
- Staff sign-in (`src/features/auth/pages/StaffLoginPage.jsx`) checks two constant prototype credentials in the
  browser and calls `startStaffSession({ role, name })`.
- Sign-out is `signOut()` / `endStaffSession()` in the store (`MainLayout.jsx`, `InsurerShell.jsx`); `signOut` and
  `clearCustomerSession` only set the signed-out session fields (`session.js:16,60,88`). Session restore is the
  persisted store. Closing an account in the web is the store's `deleteCurrentAccount`.
- **The web has no query cache.** Server records are loaded into the Zustand store by `src/api/sync.js`
  (`hydrateCustomer`, `hydrateInsurerPortal`, `hydrateAdmin`, `hydrateDirectory`): `load` applies an awaited response
  unconditionally (lines 19-28) and swallows errors; pages also write API results into the store directly
  (`PaymentPage.jsx`, `submitRequest.js`, `AdminDashboard.jsx` and others). `src/store/persistence.js` persists, in
  one `localStorage` key (`insurshield-storage`, version 7): session fields (`customer`, `isAuthenticated`,
  `authToken`, `registeredAccounts`, `staffSession`, `consentAccepted`, `consentTimestamp`, `consentRecord`), the
  journey (`vehicleDetails` … `ncdCodeUsed` in `slices/journey.js`, including `premiumBreakdown` and
  `paymentReceipt`), records (`quoteRequests`, `policies`, `claims`, `ncdApplications`, `inspections`,
  `insurerReviews`) and the catalogue (`piaConfig`, `insurersList`, which after `hydrateAdmin` holds the admin's
  list). Nothing clears records or journey on sign-out, so the next person on the browser sees them until a hydrate
  succeeds, and a hydrate that started for one person can land after another has signed in.
- The HTTP adapter (`src/api/http/index.js`) lists `POST /auth/register`, `/auth/login {identifier,password}`,
  `/auth/otp`, `/auth/otp/verify`, `/auth/password-reset`, `/auth/staff/login {email,password}`, `GET /auth/me`. None
  except `/auth/me` exists in the API, and none is called. `contracts.js` lists only `GET /auth/me · POST /auth/consent`
  but its header still says "Bearer from POST /auth/login".
- `src/lib/apiClient.js` sends `withCredentials: true` and a bearer token from `store.authToken` (never set).
- In development Vite proxies `/api` to `http://localhost:4000` (`vite.config.js`), so the browser sees one origin.
  Production per `docs/DEPLOYMENT.md`: a static build on S3 + CloudFront "or any static host", `VITE_API_BASE_URL`
  pointing at the API: possibly another origin.
- `input-otp` is used only by the UI primitive `src/components/ui/primitives/input-otp.jsx`; there is no real OTP flow.
- `VITE_KEYCLOAK_*` appear only in `apps/web/.env.example`; no code reads them.
- The web Playwright journey (`tests/journey.spec.js`) runs in mock mode and fakes the session in `localStorage`
  with a comment about Keycloak's pages.

### The product-decision areas (API from the mirror, web from `origin/main`)

1. Status inputs: `NcdDecisionDto.status` (`src/insurer-portal/dto/portal.dto.ts:57`) and
   `SetInsurerStatusDto.status` (`src/insurers/dto/insurer.dto.ts:131`) accept only stored values (`@IsIn(NCD_STATUSES)`,
   `@IsIn(INSURER_STATUSES)`). The web sends readable ones (`NcdTab.jsx` 'Approved'/'Under Review'/'Rejected';
   `AdminDashboard.jsx:245,316` 'Active'). The insurer labels are not in `contract.ts` but in a local `STATUS_LABEL`
   in `src/insurers/dto/insurer-response.dto.ts:5`. The NCD decision message lists three outcomes while `@IsIn`
   accepts all five statuses.
2. `canDecideNcd` already returns false only for APPROVED (`portal.ts:20`, unit test `portal.spec.ts:32`), so the API
   already lets a REJECTED application be decided again. Only the web says otherwise: `NcdTab.jsx` "Closes the
   application without a discount code. This cannot be undone here." and the comment "Approving and rejecting close
   the application for good".
3. `InsurersService.get/update/setStatus` answer 404 for a DELETED insurer (`insurers.repository.ts:107` filters
   `status <> 'DELETED'`); `list` hides them. `insurers_name_key` is unique over all rows, deleted included, so a
   restore cannot clash on name. Staff of a deleted or inactive insurer keep full portal access, writes included:
   portal authorization checks role and tenancy, not the insurer's status (`insurer-portal.service.ts:59-63`).
4. `GET /vehicles/lookup` is `@Public()` and answers from the latest 'shared' `vehicles` rows to anyone who knows a
   plate (`vehicles.service.ts` `findKnownVehicle`): chassis and engine numbers included.
5. `vehicles` has a non-unique plate index. Submitting a quote request updates the existing row for the plate
   (`quote-requests.service.ts:174-191` `upsertVehicle`), so one customer's submission rewrites the details of every
   request and policy on that plate. Policies take `request.vehicleId` (`payments.service.ts:106`); requote and
   renewal reuse the original `vehicleId`.
6. `PayDto.rtsaAnniversaryFee` is an optional client value added to the expected amount (`payments.service.ts:57`).
   The web's `PaymentPage.jsx` sends `amount = premium + 500` (constant `RTSA_ANNIVERSARY_FEE = 500` in
   `src/domain/rtsa.js`) but **does not send `rtsaAnniversaryFee`**, so an aligned payment fails the amount check
   today. `PolicyConfirmationPage.jsx` computes the fee from the constant and writes it into a synthetic policy
   (lines 7, 40, 56). `CustomerAccountPage.jsx:314` reads `policy.rtsaAnniversaryFee`, which the API's policy response
   never sends: `policies.repository.ts:42-49` selects no fee and `dto/policy.response.ts:89-96` maps none. A quote
   request's data access (`quote-requests.repository.ts:63-66`) loads only request, customer and vehicle.
   The service answers a wrong amount with `409 AMOUNT_MISMATCH` (`payments.service.ts:93-98`, asserted in
   `test/payments.e2e-spec.ts:174-178`).
8. `GET /health/ready` (`src/health/health.controller.ts`) answers 200 with `"status":"down"` when a dependency is
   down; `docs/DEPLOYMENT.md` "Health checks" documents that.

### Better Auth facts (npm registry and better-auth.com, read 2026-10-25)

- Latest `better-auth` is **1.7.12** (published 2026-10-20), MIT. All 18 peer dependencies are optional; the ones this
  API has are in range: `drizzle-orm ^0.45.2 || >=1.0.0-rc.1` (API: `^0.45.4`), `drizzle-kit >=0.31.4` (`^0.31.11`),
  `pg ^8` (`^8.23.1`), `vitest` up to `^5` (`^5.0.0`). Its own dependencies include `zod ^4.5.4` (API `^4.6.5`),
  `jose ^6.2.3` (API `^6.2.12`), `kysely`, `better-call`, `nanostores`, `@noble/hashes`, `@noble/ciphers`, `defu` and
  the `@better-auth/*` adapter packages (drizzle, kysely, memory, mongo, prisma) and `@better-auth/telemetry`.
- Exports used here: `better-auth`, `better-auth/adapters/drizzle`, `better-auth/node` (`toNodeHandler`,
  `fromNodeHeaders`), `better-auth/crypto`, `better-auth/cookies`, `better-auth/api`, `better-auth/plugins`.
- Express: mount `toNodeHandler(auth)` on `"<basePath>/*splat"` (Express 5) **before** any JSON body parser. The
  NestJS page recommends the community package `@thallesp/nestjs-better-auth` (2.8.0) with `bodyParser: false`; this
  plan does not add it (section 2).
- Email and password: scrypt hashing by default; `minPasswordLength`, `revokeSessionsOnPasswordReset`; reset and
  verification need a `sendResetPassword` / `sendVerificationEmail` function: there is no built-in delivery.
- Sessions live in the database unless `secondaryStorage` is set; default 7 days, refreshed daily unless
  `session.disableSessionRefresh` is set (`api/routes/session.mjs:181`); optional cookie cache.
  Cookies are `httpOnly`, `SameSite=Lax`, `Secure` with a `__Secure-` prefix on HTTPS.
- CSRF: Better Auth checks `Origin` (falling back to `Referer`) on its own unsafe requests that carry a cookie,
  against `trustedOrigins` plus the `baseURL` origin; a missing or `null` origin is refused, with one exception:
  `Origin: null` together with `Sec-Fetch-Site: same-origin` is replaced by the origin Better Auth infers from the
  request's own base URL, which is then validated (`api/middlewares/origin-check.mjs:109-113`). The Nest guard's rule
  (section 4) stays stricter and refuses every `Origin: null`.
- Rate limiting: on by default only in production; storage `memory`, `database` or secondary storage; stricter
  defaults on sign-in and sign-up; `customRules` per path.

Checked in the unpacked 1.7.12 packages (`better-auth`, `@better-auth/core`, `@better-auth/drizzle-adapter`; read,
not run):

- **Client IP.** `getIP` reads only the headers in `advanced.ipAddress.ipAddressHeaders`, defaulting to
  `x-forwarded-for` (core `utils/ip.mjs:196,206`); it never reads the socket address. A header with more than one
  address and no `trustedProxies` resolves to no IP, and the limiter then puts every such request in one shared bucket
  per path (`no-trusted-ip`, `api/rate-limiter/index.mjs:236-248`).
- **Test mode switches checks off.** Unless `advanced.disableOriginCheck` is set, the origin check is skipped when
  `NODE_ENV=test` (`context/create-context.mjs:211`), and the CSRF check is skipped with it unless
  `advanced.disableCSRFCheck` is set (`api/middlewares/origin-check.mjs:14-15`).
- **Ids.** `advanced.database.generateId: 'uuid'` makes Better Auth leave the id out of its inserts when the adapter
  supports UUIDs, which the Drizzle adapter reports for `pg` (core `db/adapter/get-id-field.mjs:45-61`, adapter
  `index.mjs:549`); the adapter inserts through Drizzle (adapter `index.mjs:311-314`), so the column's Drizzle
  default supplies the id. Without the option Better Auth generates non-UUID strings.
- **Adapter schema.** The Drizzle adapter looks each model up as a key of the `schema` object it is given and throws
  "model not found in the schema object" otherwise (adapter `index.mjs:63`).
- **Router.** `disabledPaths` is an exact match on the normalized path (`api/index.mjs:166`), so it cannot cover a
  dynamic route such as `/reset-password/:token` or `/callback/:id`. Path normalization strips trailing slashes. The
  router then runs the rate limiter and then each plugin's `onRequest`, which may answer instead of the endpoint
  (`api/index.mjs:165-180`); bodies other than `application/json` are refused.
- **Sign-up and sign-in.** `emailAndPassword.disableSignUp: true` makes `POST /sign-up/email` refuse
  (`api/routes/sign-up.mjs:145`). `POST /sign-in/email` lowercases the email, refuses a password longer than
  `maxPasswordLength` (default 128; minimum default 8, `context/create-context.mjs:186-187`) and accepts only an account
  with `providerId === 'credential'` and `accountId === user.id` (`api/routes/sign-in.mjs:315-318`).
- **Password reset.** `POST /request-password-reset` hands `sendResetPassword` a link to
  `GET <baseURL>/reset-password/<token>?callbackURL=…` and the token itself (`api/routes/password.mjs:58-92`);
  that GET redirects to the callback with the token.
- **Exports.** `setSessionCookie` is in `better-auth/cookies`; `hashPassword` in `better-auth/crypto`;
  `getSession` honours `query.disableRefresh` (`api/routes/session.mjs:170-181`).
- Database hooks: an `after` hook "runs after it commits" when the operation is in a transaction, so a hook cannot
  make the user insert and our own rows atomic.
- `testUtils()` (`better-auth/plugins`) gives `ctx.test.login` / `getAuthHeaders`; the docs say test-only and advise a
  separate auth instance; this plan does not use it (section 4, B3).
- The phone-number plugin supports phone + password sign-in, but its sign-up and verification need an OTP sender
  (`sendOTP`), and `requireVerification` blocks unverified phones.

## 2. Scope

**In**

- Better Auth inside the NestJS API, on the existing PostgreSQL database through the Drizzle adapter, email and
  password only. Cookie sessions stored in the database.
- New tables for Better Auth, a reviewed migration that adds them and links `customers` and `staff_users` by user id,
  and a later migration that drops the `keycloakId` columns.
- Customer registration (account, customer row and consent in one transaction), sign-in, sign-out, sign-out
  everywhere, session restore, password change; staff sign-in on the same mechanism; account closure revoking
  sessions and refusing sign-in.
- Password reset and email verification only as section 8, question 3 decides.
- The e2e harness signing in through Better Auth for real.
- The seed creating staff and the demo customer through Better Auth.
- The web's customer and staff sign-in, sign-up, sign-out and session restore going through `src/api/` in HTTP mode,
  the mock mode keeping its in-browser behaviour.
- Removing Keycloak from Compose, `infra/`, config, seed, tests and docs.
- Product decisions 1, 2, 3, 4, 5, 6 and 8 (7 is the seed item above).
- The three web Playwright tests that fail on `main` at `9c24441` (and at `2a708a2` before the Drizzle merge):
  `tests/journey.spec.js:11`, `tests/journey.spec.js:290`, `tests/onboarding.spec.js:138` (package E).

**Out, and where it goes**

- Phone-number sign-in and any SMS one-time code: a later batch with an SMS provider (section 8, question 2).
- A mail provider: a later batch (section 8, question 3).
- Two-factor authentication for staff: a later batch before production (section 8, question 5).
- Screens for super admins to create, deactivate or reset staff accounts: a later batch (section 8, question 4).
- An audit trail of admin insurer changes: only if the user decides it (section 8, question 6); not planned here.
- Social sign-in, passkeys, organisations, per-account lockout beyond the per-email limit of section 8, question 16.
- Making an inactive insurer's portal read-only (section 8, question 8 keeps current access).
- Registration that does not reveal whether an email or phone is taken, verifies who owns them and releases
  abandoned reservations: a later redesign with mail and SMS delivery (section 8, question 15).
- The community NestJS integration package: not needed; a guard and one mount are less code than adapting to its
  global guard and decorators, and the user asked for only what Better Auth strictly needs.
- Making `customers."userId"` and `staff_users."userId"` `NOT NULL`: a later batch's migration, once the old
  Keycloak-era local rows are gone (section 4, "Identity model").

## 3. Stop point and exit criteria

The batch stops when all of these hold:

1. Both reviews (second model and independent reviewer, plus the security hunt) done for every package; every
   confirmed finding fixed and covered by a test; counts by severity reported.
2. A sweep for regressions, edge cases and duplicated definitions: `git grep -i keycloak` finds only the history files
   named in section 0; `pending:` is defined once; status labels are defined once in `contract.ts`; the identity
   rule (`resolveIdentity`), the identity precondition, the endpoint allow-list and the client-address rule are each
   defined once.
3. The whole verification green with numbers: `npm ci`, `npm run lint`, `npm run test`, `npm run build`,
   `npm exec -w @insurshield/api -- tsc --noEmit`, `npm run test:e2e -w @insurshield/api`,
   `npm run test:e2e -w @insurshield/web`. A check whose prerequisites were missing is reported as not run.
4. Migrations M1–M4 reviewed by both reviewers and landed on the development database through `/land-a-migration`,
   in order, each after a checked backup.
5. A manual run in HTTP mode against the local stack: register, sign out, sign in, consent once, close the account
   and be refused; staff sign-in as super admin, admin and insurer user; sign out everywhere.
6. README, `apps/api/README.md`, `docs/DEPLOYMENT.md`, both `AGENTS.md` files, `.env.example` files and
   `apps/web/src/api/contracts.js` updated.
7. The commit proposal (section 5, "Commits") approved by the user, one commit at a time.

## 4. Packages

### Design settled by this plan

**Placement.** Better Auth runs inside the API process, in `src/auth/`, on the API's own `pg` pool through the Drizzle
adapter (`drizzleAdapter(db, { provider: 'pg', schema })` with the tables from `src/db/schema.ts`). One origin serves
auth and API, so there is one cookie, one CORS list and one deployment. The auth instance is built once by a Nest
provider from the validated env and the injected `DATABASE`; nothing else constructs one.

**Mounting.** `configureApp` mounts `toNodeHandler(auth)` on the Express instance at `/<API_PREFIX>/identity/*splat`,
after `enableCors` and before Nest initialises (which is when Nest adds its JSON parser), so Better Auth reads the raw
body and its responses carry the CORS headers. Nest keeps its body parser for every other route, so `bodyParser: false`
is not needed. The base path is `/<API_PREFIX>/identity`, not `/auth`, because `GET /auth/me` and `POST /auth/consent`
stay Nest routes with their contract and tests; a wildcard on `/auth/*` would swallow them. Better Auth's errors have
the body `{ code, message }`, which the web's `ApiError` already reads (`details` comes back `null`).
Better Auth reads a body whole, so an identity request that carries a body must state its length: more than 8 KiB, or
a chunked body, answers `413 PAYLOAD_TOO_LARGE` unread; a request without a body is unaffected. Browsers send the
length; a deployment proxy must forward it (K documents this).

**Endpoints exposed: an allow-list.** An Express middleware from `src/auth/`, installed by `configureApp` in front of
the identity mount, answers `404` to every request under the base path whose method and exact path are not on this
list, before Better Auth runs. The path compared is the raw request path (`req.originalUrl` up to any `?`), nothing
stripped, decoded or case-folded (Express's own path matching ignores case; this comparison does not). An unlisted
path therefore reaches neither Better Auth's rate limiter nor the database, and a route Better Auth adds in a later
version, a dynamic route or a trailing-slash variant is unreachable until it is listed. In front of the mount, in
this order: the allow-list, the client-address middleware, the identity precondition, then `toNodeHandler(auth)`.
All four are registered on the mount's own path pattern (`/<API_PREFIX>/identity/*splat`), so Express hands the
allow-list exactly the requests it would hand the mount, including a differently cased prefix such as
`/API/IDENTITY/sign-in/email`, which Express matches; the exact comparison then answers 404 to it.
The list:

- `POST /identity/register` (ours, below), `POST /identity/sign-in/email`, `POST /identity/sign-out`,
  `POST /identity/revoke-sessions` (sign out everywhere), `POST /identity/change-password` (with
  `revokeOtherSessions`). `GET /identity/get-session` is not listed: nothing calls it (the web reads its session from
  `GET /auth/me`), so it answers 404 like every unlisted path.
- Only if question 3 chooses (b), and only when `NODE_ENV` is `development` or `test` (production answers 404):
  `POST /identity/request-password-reset`, `POST /identity/reset-password`, `POST /identity/send-verification-email`,
  `GET /identity/verify-email`. The development mailer writes, for a reset, a **web** link
  `<redirectTo>?token=<token>` built from the token Better Auth hands it, where `redirectTo` is the web's
  `/reset-password` page (Better Auth checks it against `trustedOrigins`); Better Auth's own
  `GET /reset-password/:token` callback is therefore not listed. A verification link targets
  `GET /identity/verify-email?token=…&callbackURL=<web origin>/account`, which is listed.

`emailAndPassword.disableSignUp: true` also switches Better Auth's own sign-up off, so `POST /sign-up/email` stays
refused even if the allow-list were bypassed. `disabledPaths` is not used. Better Auth's router runs its rate
limiter before any plugin `onRequest` (`api/index.mjs:165-180`), which is why the allow-list is not a plugin: as a
plugin, each distinct unknown path would first write its own `auth_rate_limits` row (T-A37).

**Sessions.** Database sessions that last a fixed 7 days from sign-in: `session.disableSessionRefresh: true`, so no
request extends a session (no sliding renewal) and nothing in the background creates or renews the session cookie;
the only background cookie write is a deletion for a missing or expired session. The cookie cache stays off, so
closing an account, deactivating staff, signing out everywhere or changing the password takes effect on the next
request; with it off, Better Auth's session read writes a cookie only to delete one (a missing or expired session,
or a stale `session_data` cache cookie) (`api/routes/session.mjs:44-46,155-181`, `cookies/index.mjs:76`), and
`get-session` is not exposed at all (allow-list above). `GET /auth/me` does not forward Better Auth's deletion
headers (its server-side `getSession` call returns no response headers). `deferSessionRefresh` is not used. Cookie
prefix `insurshield`, one constant in `src/auth/` used by the auth options and by the identity-route middleware;
`httpOnly`, `SameSite=Lax`, `Secure` (and `__Secure-`) whenever `BETTER_AUTH_URL` is HTTPS.
The bearer plugin is not used and the web keeps no token: `authToken` leaves the store and `apiClient`.
Not guaranteed (user, 2026-10-29): a password change ends every session that existed when it started, but a sign-in or
another password change running at the same moment, within that change's own processing, may keep a session: Better
Auth checks the current password before its writes, which commit one by one. It needs the old password and must land
while the change is being processed, behind the sign-in counter per email or the password-change counter per user.
Serialising every credential check and write per user closes it; that is a later hardening item, not batch 2.

**Logging.** Better Auth logs through the API's Nest logger: each line keeps Better Auth's message, an error argument
is reduced to its database code and constraint, every other argument is dropped, and control characters and direction
marks are escaped, so no query, parameter or stack from an error is logged and a request value cannot start a line of
its own. A request value Better Auth writes into its message, such as a refused `callbackURL` or `Origin`, is logged
as sent; it is the requester's own input. Better Auth throws what its router would print whole (`onAPIError.throw`);
its own refusals keep their status and body, and anything else on the identity routes is answered and logged as the
Nest filter does. Not guaranteed (user, 2026-10-29): when the user or account query behind a session or sign-in lookup
fails, Better Auth's fallback join prints that query, the user id and a stack to the console directly
(`@better-auth/core` `db/adapter/factory.mjs`); no credential is in it. Native joins, which need relations on the
shared Drizzle instance, close it; a later item for the owner of `schema.ts` and the database module.

**Origins and CSRF.** `trustedOrigins` is `CORS_ORIGINS` (one list for both; `BETTER_AUTH_URL`'s origin is trusted
by Better Auth itself). The auth options set `advanced.disableOriginCheck: false` and
`advanced.disableCSRFCheck: false` explicitly, because Better Auth otherwise skips both when `NODE_ENV=test`, which is
how the e2e suite runs; the checks the tests exercise are then the production ones. Better Auth checks `Origin` on its
own endpoints. Because Nest routes now also authenticate by cookie, `AuthGuard` applies one rule to an unsafe method
(`POST`, `PUT`, `PATCH`, `DELETE`) that carries the session cookie: accepted when `Origin` is present, not `null`, and
in the trusted list; accepted without an `Origin` header only when `Sec-Fetch-Site` is `same-origin`; refused (403)
otherwise, including `Origin: null`, a cross-site `Sec-Fetch-Site`, and neither header. `@Public()` routes are
unaffected. This matters for `POST /documents`, which takes `multipart/form-data`, a body a cross-site form can send.
Registration carries no cookie, so Better Auth's origin check does not apply to it; what protects it is that Better
Auth's router accepts only `application/json` bodies, which a cross-site form cannot send and a cross-site script
cannot send without a CORS preflight that `CORS_ORIGINS` refuses.

**Client address.** Better Auth never reads the socket address and by default trusts `X-Forwarded-For` as sent, so the
API decides the client address itself and hands Better Auth only that. Express's `trust proxy` is set from
`TRUST_PROXY_HOPS` (the number of proxies in front of the API: 0 means clients connect directly), so `req.ip` is the
address the outermost trusted proxy saw. A middleware in `configureApp`, before the identity mount, deletes any
inbound `x-insurshield-client-ip` header and sets it from `req.ip`; Better Auth's
`advanced.ipAddress.ipAddressHeaders` is `['x-insurshield-client-ip']` and nothing else. Every request therefore has
exactly one address, chosen by the API, and a header a client sends cannot change it. The consent record's
`ipAddress` keeps using `request.ip`, which the same setting corrects behind a proxy. The production value of
`TRUST_PROXY_HOPS` depends on the hosting (section 8, question 14), and the API must only be reachable through those
proxies; `docs/DEPLOYMENT.md` says so.

**Rate limiting.** Better Auth's limiter, always on (not only in production), storage `database` so it holds across
API instances and restarts: sign-in 5 per minute per IP, register 3 per minute, password-reset request 3 per
5 minutes, every other identity path 60 per minute except two of Better Auth's built-in rules that stay active
because nothing overrides them: `change-password` 3 per 10 seconds and, where enabled (question 3 (b)),
`send-verification-email` 3 per minute; all keyed by the address above. The options state each setting:
`rateLimit.enabled` from `AUTH_RATE_LIMIT` (`on` → true; the only way to turn it off), `storage: 'database'`,
`window: 60`, `max: 60`, and `customRules` for `/sign-in/email` (60 s, 5), `/register` (60 s, 3) and
`/request-password-reset` (300 s, 3), which take precedence over Better Auth's built-in special rules. The e2e
environment turns the limiter off with `AUTH_RATE_LIMIT=off`, except in the specs that test it, which build the app
with an injected environment (`startApp` takes an env override).

**Failed sign-ins per email (if question 16 (a)).** A plugin in `src/auth/` limits sign-in attempts per email,
whatever address they come from, in the application's own table `auth_sign_in_failures` (M1), not in
`auth_rate_limits`: Better Auth prunes every `auth_rate_limits` row older than its longest window (300 s,
`api/rate-limiter/index.mjs:174-184`) whatever its key, which would end a lockout early. What it guarantees:

- At most 10 admissions per email per 15-minute window across all API instances; the 10th admission starts a
  15-minute lock during which no new attempt is admitted (a check admitted before the lock may finish); a success
  never removes a lock. Attempts are counted, not failures, so a person who signs in successfully resets a window
  that has not locked.
- The answers for an unknown email and for a known one are the same (invalid credentials, or locked).
- A password change is admitted the same way on its own counter, keyed by the signed-in user: failed sign-ins never
  block a password change, and failed password changes never block sign-in. Accepted: someone holding a stolen cookie
  gets both budgets, 10 sign-ins and 10 password changes per window, to guess the password.
- If the admission statement fails, the sign-in is refused with `503 TRY_AGAIN` (fail closed); a failure of the
  success-clear or of cleanup is logged and does not change the answer.

Not guaranteed, deliberately: rows for unknown emails are removed opportunistically, not by a deadline (storage grows
at most at the rate the per-address sign-in limit allows, acceptable while nothing is in production; a periodic sweep
is a later concern); a concurrent burst can cost the 11th requester a refusal even when its password is right (fail
closed).

How:

- **Key and guards.** Columns: `"emailKey"` `varchar(254)` primary key, `attempts` integer, `"windowStartedAt"`
  timestamp and `"lockedUntil"` nullable timestamp, with an index on `"windowStartedAt"`. The key is the typed email
  lower-cased, as Better Auth's own lookup does. A `before` hook sees the body before the endpoint validates it, so a
  body that is not an object, an email that is not a string, or one longer than 254 characters gets no key and the
  hook does not throw; then nothing is checked or counted and the sign-in answers as without the plugin (registration
  refuses emails over 254 characters, so no account has one).
- **Admission.** A `before` hook on `/sign-in/email` runs, before the password is checked, one atomic
  `INSERT … ON CONFLICT ("emailKey") DO UPDATE … RETURNING` for the key. A new window (`attempts` 1,
  `"windowStartedAt"` now, no lock) starts only when the old window has ended (it started 15 minutes ago or more) and
  no lock is active, so the end of a window never clears an active lock; otherwise `attempts` goes up by one, and
  reaching 10 sets `"lockedUntil"` to now plus 15 minutes. The hook admits the request when the returned `attempts` is
  10 or less; otherwise (the lock was already active, or this window's 10 admissions are used) it throws an
  `APIError` with status `429` and a generic message before the password is checked. The upsert's row lock
  serializes admissions for one email across instances; there is no separate failure count. If the statement fails,
  the hook refuses with `503 TRY_AGAIN`.
- **Success.** An `after` hook reads `ctx.context.returned` and, only on a successful sign-in, runs
  `DELETE … WHERE "emailKey" = $1 AND "lockedUntil" IS NULL`: a success clears a window that has not locked and never
  a lock. A failed sign-in needs no write after the check. The hook catches and logs its own database errors.
- **Cleanup.** After the admission statement, as a statement of its own outside any transaction that holds the
  email's row, one admission in N (a constant of the plugin) runs `DELETE FROM auth_sign_in_failures WHERE "emailKey"
  IN (SELECT "emailKey" FROM auth_sign_in_failures WHERE "windowStartedAt" < now - 15 minutes AND ("lockedUntil" IS
  NULL OR "lockedUntil" < now) LIMIT 100 FOR UPDATE SKIP LOCKED)`. It skips rows another transaction holds, so it
  cannot deadlock with an admission or roll back an increment; its errors are logged. Retention is opportunistic.
- Times come from the API's clock (`Date.now()`, as Better Auth's limiter uses) and are passed to every statement,
  not taken from the database's `now()`, so a test moves them all with one fake clock. The key is the typed email,
  not a user, so an unknown email is counted and refused exactly like a known one and the answers never say whether
  the email exists. `AUTH_RATE_LIMIT=off` switches the plugin off with the limiter. Its cost: anyone who knows a
  person's email can keep them from signing in for 15 minutes at a time.

**Identity model.** One Better Auth user per person, in `auth_users`. Domain tables stay the authority:
`customers` and `staff_users` gain `"userId" uuid` (unique, foreign key to `auth_users.id`, `ON DELETE RESTRICT`),
replacing `"keycloakId"`. A user is staff when a `staff_users` row links it, a customer when a `customers` row does;
`staff_users.role` becomes the authority on the role (it was the token's realm role) and `staff_users.insurerId` on
tenancy, so services keep enforcing authorization and tenancy exactly as now, from the `Principal`, whose shape does
not change. No admin or organization plugin: they would put a second role and tenancy model beside the domain one.
A user with neither row, or with both, is refused (401) rather than guessed. `"userId"` stays nullable in this batch
only because Keycloak-era local rows have no user; such rows cannot sign in. Nothing ever links an existing unlinked
`customers` row to a user by email: registration always inserts a new row, so a Keycloak-era row is never adopted on
an unverified address. What happens to those rows, which would otherwise block re-registration with the same email or
phone (`409`), is section 8, question 13. Only the seed links rows by email, and only rows it owns (package C).

`staffSession` in `GET /auth/me` gains an additive field `isSuperAdmin` (true only for `SUPER_ADMIN`); `role` keeps
its current values, so existing readers are unchanged. The restore controls (D3) are shown from it; the API still
authorizes every super-admin route itself.

**Registration.** `POST /identity/register` is a small Better Auth plugin endpoint in `src/auth/`, so it gets Better
Auth's rate limit, JSON-only body rule and cookie handling. Body: `fullName`, `email`, `phone`, `password`, `noticeVersion`.
The body is validated before anything is written (a class-validator DTO or zod schema in `src/auth/`, the endpoint's
`body` option): all fields required strings, unknown fields refused, `email` a valid address, `phone` 6 to 24
characters as `customer.dto.ts:97` already accepts it, `email` at most 254 characters, `fullName` non-empty. In one `db.transaction` it inserts the `auth_users` row, the credential
`auth_accounts` row, the `customers` row and the first `consent_records` row; a unique clash on email or phone
answers `409 ACCOUNT_CONFLICT` with the existing wording and leaves nothing behind. An email that a `staff_users` row
holds (compared case-insensitively) is refused the same way. After commit it creates the session, sets the cookie
and answers `201` with `signedIn: true`; if creating the session fails, the account is kept, no cookie is set and it
answers `201` with `signedIn: false`. Better Auth's own sign-up is switched off (`disableSignUp`, and not on the allow-list), so no user can exist
without its customer row, and first-call customer provisioning (`resolveCustomer` with `ON CONFLICT DO NOTHING` and
the `pending:` placeholder) is removed; `apps/api/AGENTS.md` "Database" loses that exception. Old rows that still
hold a `pending:` phone are shown as no phone by one shared function.

The `409` tells a caller that an email or phone is registered, whatever its wording: the plan does not claim
otherwise. Within the register limit (3 per minute per address) anyone can test addresses and numbers, and, because
neither is verified, can register someone else's email or phone first. Whether that is accepted for now is section 8,
question 15.

One function, `createCredentialUser(tx, { email, name, password })` in `src/auth/`, writes the user and credential
account; registration, the seed and the e2e builders all call it. Its contract is what Better Auth's sign-in needs
to find the account again:

- the email is trimmed and lowercased before it is stored, in `auth_users.email` and in the `customers` or
  `staff_users` row written with it, so the case-sensitive unique indexes behave case-insensitively for every new row;
- the password is refused (400, `PASSWORD_TOO_SHORT` / `PASSWORD_TOO_LONG`) outside the bounds the auth options set
  explicitly, `minPasswordLength: 8` and `maxPasswordLength: 128` (Better Auth's defaults, read from the auth context,
  not copied), and hashed with the context's hasher (`password.hash`), the one sign-in verifies with;
- the account row has `providerId: 'credential'` and `accountId` equal to the new user's id.

**Sign-in, closure and refusal.** One function in `src/auth/`, `resolveIdentity(db, userId)`, turns a user id into a
`Principal` or a refusal, and both the Better Auth `databaseHooks.session.create.before` hook and `AuthGuard` call
it, so sign-in and every later request apply the same rule. It refuses: a user linked to no domain row, or to both a
`customers` and a `staff_users` row (401); a closed customer (403, message `ACCOUNT_CLOSED`); an inactive staff
member (403); a staff member whose insurer is `DELETED` (403, if question 8 chooses (a)). The hook turns a refusal
into an error so no session row is written; the guard checks on every request, so a session created before the
change is refused too. Closing an account deletes the customer's sessions in the closing
transaction, through `AuthService.revokeSessions(tx, userId)` (the customer module calls the auth service, it does not
write auth tables).

**The guard.** `AuthGuard` asks Better Auth for the session from the request's cookie
(`auth.api.getSession({ headers: fromNodeHeaders(req.headers), query: { disableRefresh: true } })`, so a guard never
has a cookie to forward; sessions are not renewed, see "Sessions"), resolves
the `Principal` with `resolveIdentity`, applies `@Roles()`, and adds `@OptionalAuth()` for routes that serve
guests and customers differently (only `GET /vehicles/lookup` here). `KeycloakVerifier` is deleted.

**Identity precondition.** In HTTP mode the web sends `X-InsurShield-User` on every request: the Better Auth user id
the tab is bound to, or `anonymous` (W, "identity boundary"). The header grants nothing, and without it every route
behaves as today, so the e2e specs and other clients need not send it. Where it is present:

- `AuthGuard`, on every Nest route, `@Public()` and `@OptionalAuth()` included, before any handler runs: a user id
  that is not the session's user, or a user id with no session, answers `409 IDENTITY_CHANGED` with a generic message
  (`src/common/auth/messages.ts`) and nothing is written. `anonymous` makes `@Public()` and `@OptionalAuth()` routes
  run as for a guest without reading the cookie (the vehicle lookup answers as for a guest whoever's cookie the
  browser holds), and makes every session-required route, `GET /auth/me` included, answer 409.
- The Express middleware in front of the identity mount applies the same rule to `sign-out`, `revoke-sessions`, `change-password` and, when enabled, the reset routes. Not reading the cookie for `anonymous`
  is a rule of the Nest `@Public()` and `@OptionalAuth()` routes only: here the middleware inspects the session for
  `anonymous` too, because these routes act on the session the cookie names, and `anonymous` with a session answers
  409, without one passes through. A request with no session cookie
  (`getSessionCookie(fromNodeHeaders(req.headers), { cookiePrefix })` from `better-auth/cookies`, with the shared
  prefix constant; it reads a `Headers` object or a request, not Express's header object,
  `cookies/index.mjs:261-263`) is decided without a query: `anonymous` passes, a user id answers 409. Only a request
  that carries the cookie reads the session, with `getSession({ headers, query: { disableRefresh: true } })`. Sign-in
  and registration are not checked: they replace the session, and the tab binds from their response.
- `GET /auth/me` gains an additive `userId`; registration's response carries it; sign-in's already has `user.id`.
  The Origin rules above are unchanged.

**Configuration** (in `src/config/env.ts`, `apps/api/.env.example`, the README Configuration table):
`BETTER_AUTH_SECRET` (required, at least 32 characters, `CHANGE_ME` refused), `BETTER_AUTH_URL` (required, the API's
public origin, for example `http://localhost:4000`), `TRUST_PROXY_HOPS` (required, a whole number from 0, no default
in code, so a deployment cannot start without stating its proxies; `CHANGE_ME` in `.env.example`, with the README
giving 0 for local development, where the Vite proxy runs on the same machine; the e2e setup sets it),
`AUTH_RATE_LIMIT` (`on` by default, `off` allowed only when `NODE_ENV=test`), `RTSA_ANNIVERSARY_FEE_NGWEE` (required,
a whole number of ngwee within the money bounds; `CHANGE_ME` in `.env.example`, refused like the others, with K500,
`50000`, named in the README as the proposed local value until question 11 is answered). A adds the first four;
D6 adds `RTSA_ANNIVERSARY_FEE_NGWEE` in W4b. The four `KEYCLOAK_*` settings go. Better Auth telemetry is switched off in code.

**Tables** (snake_case names, camelCase quoted columns like the rest of `schema.ts`, `uuid` ids):
`auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_rate_limits`. The adapter is given an
explicit schema object whose keys are Better Auth's default model names,
`{ user: authUsers, session: authSessions, account: authAccounts, verification: authVerifications, rateLimit:
authRateLimits }`, and no `modelName` is set (the adapter looks models up by those keys). Ids: the auth options set
`advanced.database.generateId: 'uuid'`, so Better Auth leaves the id out of its inserts, and every auth table's id
uses the existing `id()` helper (`$defaultFn(randomUUID)`, a Drizzle runtime default that fills it); `userId` columns are `uuid`. `auth_sessions."userId"` and
`auth_accounts."userId"` reference `auth_users.id` `ON DELETE CASCADE`, so deleting a user cannot leave sessions or
credentials behind (a user linked from `customers` or `staff_users` cannot be deleted at all: those keys are
`RESTRICT`). Their columns are exactly the fields Better Auth 1.7.12 declares for those models; a unit test compares
the Drizzle tables with Better Auth's own table definition for the configured options, so a field added by a later
version fails a test instead of a request, and an e2e inserts real sessions and rate-limit rows (T-S3). If question
16 chooses (a), `auth_sign_in_failures` is the application's own table beside them: not a Better Auth model, not in
the adapter's schema object, written only by the per-email plugin.

### Package table

| Package | Owner scope (files) | What it delivers | Depends on | Tests |
| --- | --- | --- | --- | --- |
| P0 Dependency (coordinator, W0) | `apps/api/package.json` (adds `better-auth` at the exact version of question 7), `package-lock.json`, this plan | The dependency only | User answers in section 8 | `npm ci`; build, lint and unit tests unchanged |
| E Web e2e repair (W0) | `apps/web/tests/journey.spec.js`, `apps/web/tests/onboarding.spec.js`, and the web source a failure traces to (named in the brief once diagnosed) | The three failing tests pass: each failure diagnosed as a stale test or a web regression, and the cause fixed, not the assertion loosened | none | `npm run test:e2e -w @insurshield/web` 22/22 |
| S Schema and migrations (W1, W3, W5) | `apps/api/src/db/schema.ts`, `apps/api/drizzle/**` (new files, `meta/_journal.json`, snapshots, `catalog/*.json`), `apps/api/test/schema.e2e-spec.ts`, `apps/api/test/migrate.e2e-spec.ts`; in W1 only, `apps/api/test/builders.ts` (the `keycloakId` narrowing below, nothing else) | M1 in W1; M2 and M3 in W3; M4 in W5 (section 5). With M1, `keycloakId` becomes nullable in `schema.ts`; `buildCustomer` and `buildStaffUser` return their row with `keycloakId` checked non-null and typed `string` (they always insert one), so `test/jwks.ts` and every spec that passes a built row type-check unchanged, and commit 2 passes the API type check (`src`, `scripts` and `test`) on its own | P0 for M1 | T-S1–T-S8 |
| A Better Auth in the API (W2a) | `apps/api/src/auth/**`, `apps/api/src/common/auth/**` (`keycloak.verifier.ts` deleted), `apps/api/src/config/env.ts(+spec)`, `apps/api/.env.example`, `apps/api/src/app.setup.ts`, `apps/api/src/app.module.ts`, `apps/api/src/swagger.ts`, `apps/api/src/customer/account.service.ts`, `apps/api/src/customer/account.repository.ts`, `apps/api/src/admin/dto/admin-response.dto.ts` (placeholder rule only), `apps/api/test/jwks.ts` (deleted), new `apps/api/test/sessions.ts`, `apps/api/test/global-setup.ts`, `apps/api/test/builders.ts` (identity builders only), `apps/api/test/helpers.ts`, `apps/api/test/{auth-guard,auth-service,harness,swagger}.e2e-spec.ts`, new `apps/api/test/identity.e2e-spec.ts` | Everything in "Design" above, including the allow-list and client-address middleware and `TRUST_PROXY_HOPS`, `resolveIdentity`, the identity precondition (`X-InsurShield-User` in `AuthGuard` and in front of the mount, `anonymous`, `409 IDENTITY_CHANGED`), `userId` and `isSuperAdmin` on `/auth/me`; the harness helpers B uses | S (M1 landed) | T-A1–T-A39, T-H1–T-H3 |
| B Spec conversion (W2b) | `apps/api/test/{admin,customer,documents-access,documents-upload,error-filter,inspections,insurer-portal,insurers,payments,pia}.e2e-spec.ts` | Each spec signs in through `test/sessions.ts` instead of signing JWTs; no assertion changes except the status codes the new guard defines | A | Every converted spec green, with the same case count as before |
| C Seed (W2b) | `apps/api/scripts/**` (`keycloak-admin.ts(+spec)` deleted) | Staff and the demo customer created with `createCredentialUser`, linked by email, password `SEED_STAFF_PASSWORD`; `SEED_RESET_PASSWORDS` resets them; staff and demo data no longer skipped; the seed never links a seeded row to a user it did not create (below) | A | T-SD1–T-SD7 |
| W Web sign-in (W2b) | `apps/web/src/api/http/index.js` (the `auth` section), `apps/web/src/api/mock/index.js` (the `auth` section), `apps/web/src/api/mock/index.test.js`, `apps/web/src/api/contracts.js` (auth part), `apps/web/src/api/sync.js`, `apps/web/src/api/index.js` (only if the sync change needs it), `apps/web/src/lib/apiClient.js`, `apps/web/src/store/**` (slices, `persistence.js`, `store.test.js`), `apps/web/src/features/auth/**`, `apps/web/src/features/account/pages/CustomerAccountPage.jsx` (closure only), `apps/web/src/components/layout/MainLayout.jsx`, `apps/web/src/features/insurer-portal/components/InsurerShell.jsx`, `apps/web/src/app/**` (session restore, guards), `apps/web/.env.example`, `apps/web/tests/journey.spec.js`, `apps/web/public/sw.js`, `apps/web/vite.config.js` (only if the worker's build step needs it), `apps/web/playwright.config.js` (the worker tests' project and the existing project's exclusion of them), new `apps/web/tests/service-worker.spec.js` and new files under `apps/web/tests/service-worker/` (fixtures, test server) | Pages call `api.auth.*` in both modes; HTTP adapter calls the identity endpoints; session restored from `GET /auth/me` (not renewed: sessions last 7 days from sign-in); the identity boundary (below): per-tab `sessionStorage`, the tab's binding and `X-InsurShield-User` header in `apiClient`, the boot gate, the transition with `leaving` honoured by `sync.js` and the store actions, the `BroadcastChannel` notification and the back/forward-cache check in `src/app/`; persisted store version bumped, `authToken` and passwords no longer persisted in HTTP mode; the service worker of "W, service worker" | A (contract fixed in this plan) | T-W1–T-W17, T-W19–T-W23 |
| K Keycloak removal (W3) | `docker-compose.yml`, `infra/keycloak/**` (deleted), `infra/postgres/01-databases.sh`, root `.env.example`, `README.md`, `apps/api/README.md`, `docs/DEPLOYMENT.md`, `AGENTS.md`, `apps/api/AGENTS.md`, `apps/web/ARCHITECTURE.md` | No Keycloak outside history; docs describe Better Auth, the new settings, cookie sessions, the same-site deployment requirement, `TRUST_PROXY_HOPS` with the rule that the API is reachable only through those proxies, the development-database step of question 13, `NODE_ENV` as required (no default), and that the proxy forwards identity requests with their length | A, B, C, W green | T-K1, T-K2 |
| D1 Status inputs and NCD re-decision (W4a) | `apps/api/src/common/contract.ts(+spec)`, `apps/api/src/insurers/dto/**` except D3's new `insurer-list.query.ts`, `apps/api/src/insurer-portal/dto/portal.dto.ts`, `apps/api/test/insurer-portal.e2e-spec.ts` (new cases) | Decisions 1 and 2 (API) | B | T-D1–T-D5 |
| D3 Insurer restore (W4a) | `apps/api/src/insurers/insurers.{service,controller,repository}.ts`, new `apps/api/src/insurers/dto/insurer-list.query.ts` (the `status=deleted` query; nothing else in `insurers/dto/`), `apps/api/test/insurers.e2e-spec.ts` (new cases), `apps/web/src/features/admin/**`, `apps/web/src/api/http/index.js` (`insurers` section), `apps/web/src/api/mock/index.js` (`insurers` section), `apps/web/src/api/contracts.js` (insurers part) | Decision 3; restore controls shown only when `staffSession.isSuperAdmin` | B | T-D6–T-D10, T-D25 |
| D4 Vehicles (W4a) | `apps/api/src/vehicles/**`, `apps/api/src/customer/quote-requests.{service,repository}.ts`, `apps/api/src/customer/domain/plate-match.ts(+spec)`, `apps/api/test/vehicles.e2e-spec.ts`, `apps/api/test/customer.e2e-spec.ts` (new cases) | Decisions 4 and 5 (code) | B | T-D11–T-D16 |
| D6 RTSA fee (W4b) | `apps/api/src/payments/**`, `apps/api/src/config/env.ts` (the fee setting), `apps/api/.env.example` (fee), `apps/api/src/customer/dto/quote-request.response.ts`, `apps/api/src/customer/quote-requests.{service,repository}.ts` (fee only), `apps/api/src/customer/policies.repository.ts`, `apps/api/src/customer/dto/policy.response.ts`, `apps/api/test/payments.e2e-spec.ts` (new cases), `apps/api/test/customer.e2e-spec.ts` (fee cases), `apps/web/src/features/payment/**`, `apps/web/src/features/account/pages/CustomerAccountPage.jsx` (fee display only), `apps/web/src/domain/rtsa.js` (deleted), `apps/web/src/api/http/index.js` (`payments` section), `apps/web/src/api/mock/index.js` (`payments` section), `apps/web/src/api/contracts.js` (payments part), README Configuration row | Decision 6, current fee and charged fee as below | S (M3 landed), B, D4 reviewed | T-D17–T-D21, T-D26 |
| D8 Readiness (W4a) | `apps/api/src/health/**`, `apps/api/test/health.e2e-spec.ts`, `docs/DEPLOYMENT.md` "Health checks" | Decision 8 | K | T-D22, T-D23 |
| N NCD wording (W4a) | `apps/web/src/features/insurer-portal/components/NcdTab.jsx(+test)` | Decision 2 (web): rejection described as reopenable; a rejected application offers Approve and Keep under review | D1 | T-D24 |

D4 and D6 both edit `quote-requests.{service,repository}.ts` and `customer.e2e-spec.ts`, and D3 and D6 both edit the
web adapter files `apps/web/src/api/{http,mock}/index.js` and `contracts.js`. W4 is therefore two waves: D1, D3, D4,
D8 and N in **W4a**, where D3 owns the three adapter files and D4 the customer files; D6 alone in **W4b**, after W4a
is reviewed, owning all of them. No patch passes between packages.

### What each package must not miss

- **A.** `getSession` must not be called with `disableRefresh` missing (a guard cannot forward the cookie). The query
  flag is a second guard beside `session.disableSessionRefresh: true`, not a replacement: neither is removed because
  the other exists. The
  origin check covers every unsafe method on a cookie-authenticated request, `@Public()` excluded. Registration is one
  transaction and does nothing after commit that can answer `503 TRY_AGAIN` other than creating the session; if
  creating the session fails, the account exists and the person signs in: the response says so (`201` with
  `signedIn: false`), it never answers a failure for committed work. The Swagger scheme becomes a cookie scheme named
  after the session cookie. `messages.ts` keeps `ACCOUNT_CLOSED`; Better Auth's refusal uses the same constant.
  The auth options state every security default the tests rely on rather than inheriting it: `disableOriginCheck:
  false`, `disableCSRFCheck: false`, `generateId: 'uuid'`, `disableSignUp: true`, the password bounds,
  `rateLimit.enabled` (from `AUTH_RATE_LIMIT`), `rateLimit.storage`, `rateLimit.window`, `rateLimit.max`,
  `rateLimit.customRules`, `ipAddressHeaders`, `session.disableSessionRefresh: true` (and no cookie cache), and the
  cookie prefix from its one constant. `TRUST_PROXY_HOPS` is applied with `app.set('trust proxy', hops)` in `configureApp`, so
  `main.ts` and the e2e `startApp` share it. The identity precondition is one function used by `AuthGuard` and by the
  middleware in front of the mount; it runs before any handler or write; `IDENTITY_CHANGED` and its generic message
  live in `messages.ts` beside `ACCOUNT_CLOSED`. `anonymous` skips the cookie only on Nest `@Public()` and
  `@OptionalAuth()` routes; in front of the identity routes it is checked against the session like a user id.
- **B.** A helper, not a pattern copied into each spec: `signIn(http, { email })` returns the `Cookie` header and an
  `Origin` header for the run's trusted origin; builders give every user `TEST_PASSWORD`. Specs that tested
  Keycloak-specific failures (wrong issuer, foreign key, expired JWT) are replaced by A's identity tests, not kept.
- **C.** The seed never prints a password and refuses `CHANGE_ME`. The demo customer gets a Better Auth user with the
  seed password (question 9). Seeded emails are lowercased like every other. The seed links a staff row, or the demo
  customer row, only to a user it creates itself in that run or to the user that row already links (a re-run). If an
  `auth_users` row with that email exists and is not already linked from that same row (for example someone
  registered the address as a customer before the seed ran), the seed stops with an error naming the email and
  telling the operator to remove that account or change the seeded address; it never links, overwrites or attaches
  demo records to it. Registration refuses an email held by a `staff_users` row, so the opposite order is refused at
  registration (T-A23).
- **W.** Mock mode keeps every current behaviour and test. HTTP mode: sign-in by email only unless question 2 says
  otherwise; sign-up posts once to `/identity/register` (no demo code step in HTTP mode); after sign-in the page calls
  `GET /auth/me` to learn whether this is a customer or staff; a customer on the staff page is signed out, which is a
  transition (below) to the staff sign-in page with a parameter that shows "not a staff account" (T-W3), and staff on
  the customer page are sent to their portal (same person, no transition); staff
  sign-in no longer shows prototype credentials in HTTP mode. Inventory of `CreateAccountPage.jsx` to keep:
  resume context per `next`, masked contact echo, the existing neutral wording (which does not hide that a `409`
  means the address or number is taken, question 15), 8-character minimum, separate consent step for returning
  customers without consent, done stage. `staffSession` keeps `/auth/me`'s new `isSuperAdmin` field.
- **W, identity boundary.** Everything in this item is HTTP mode only (gated on `env.apiMode === 'http'`); mock mode
  keeps today's behaviour exactly (`localStorage`, no header, no channel). What it guarantees:
  - After sign-out, closure, or a change to a different person, the tab that made the change shows and stores none
    of the previous person's data; every other tab of the browser drops it the moment it learns of the change (a
    notification, its next request to the API, or being restored from the back/forward cache), before showing
    anything new.
  - No request a tab makes on behalf of person A changes anything under another person's session, whatever the
    timing, on Nest routes and on Better Auth's mutating routes alike (the server side is A's "Identity
    precondition").
  - A real identity change causes at most one reload per affected tab from notifications, plus at most one more from
    a stale observation; no tab's reaction notifies anyone, so reactions cannot chain.
  - A guest's journey (including unpersisted photos and documents) survives the guest's own sign-in in that tab; a
    guest tab is never reloaded by another tab's sign-in, its public loads are never cancelled, and while it is a
    guest it receives no one's personalised data. At its next boot (a reload) it adopts the browser's current
    session, if there is one, and its unfinished journey then belongs to the adopted person, as on its own sign-in;
    after a 409 it transitions (the journey goes with the rest of the tab's store) and the following boot adopts.
  - No background creation or renewal of the session cookie; the only background cookie write is a deletion for a
    missing or expired session. Only user actions (sign-in, registration and sign-out) otherwise write it (A,
    "Sessions").
  - A tab never renders a person's data on the strength of an identity answer it received after it learned that the
    browser's identity changed.

  Not guaranteed, deliberately: a background tab already showing A's data keeps it on screen until it learns of the
  change (it cannot learn earlier than its next event); an unfinished journey does not follow the person to a new tab
  or survive closing the tab (question 17). When two tabs perform cookie-writing actions at the same moment (for
  example signing in as A in one and as B in another), the browser ends signed in as whichever response arrived last,
  and every tab follows that within one request or notification; a late sign-out response may leave the browser
  signed out when another tab has just signed in (fail safe: no one's data is shown). This is the browser's
  single-cookie model, and the same person is at both tabs.

  How:
  1. **Storage per tab.** The store's persist adapter is `sessionStorage` (`createJSONStorage(() => sessionStorage)`);
     `registeredAccounts`, `authToken` and passwords are not persisted at all. An old `localStorage` copy of
     `insurshield-storage` is removed once at boot. No person-bound state is shared between tabs, so no tab can write
     another person's data back for another tab.
  2. **One identity id.** The Better Auth user id: `userId` on `GET /auth/me` and on the registration response (A),
     `user.id` on the sign-in response. Every comparison uses this id, never the customer or staff id.
  3. **Binding.** A tab is unbound (a guest) or bound to one `userId`, kept in its `sessionStorage` under its own key
     (`insurshield-identity`). It binds from the response of its own successful sign-in, or of its registration when
     that answers `signedIn: true` (no reload, so `next` with its query string and the consent step resume as today),
     or at boot from `GET /auth/me`. A registration that answers `201 { signedIn: false }` (the account exists, no
     session was created) binds nothing and posts nothing: the tab stays a guest with its journey and `next`, and the
     page offers sign-in for the new account; that sign-in then binds as any other. The binding never changes in
     place: a sign-in as a different `userId` while bound is a transition (step 6).
  4. **The header.** Every request carries `X-InsurShield-User`: the bound `userId`, or `anonymous` when unbound,
     read when the request is sent. The one request without it is the boot `GET /auth/me` of a tab with no stored
     binding, which adopts the answer (bound to that `userId`, or a guest on 401). A guest tab has no stored binding,
     so its next boot (a reload) adopts whatever session the browser holds then, and its unfinished journey, still in
     the tab's storage, then belongs to the adopted person, as after its own sign-in. A tab with a stored binding sends
     it on its boot `GET /auth/me`; a different session answers `409 IDENTITY_CHANGED`, which transitions and clears
     the binding, so the following boot adopts: boot transitions at most once. `/auth/me` carries the header like every
     other request. The web never calls `get-session` (it is not exposed; sessions are not renewed).
  5. **Boot gate.** The app root renders a neutral loading state until the boot `GET /auth/me` settles; route guards
     wait for it; a 401 at boot settles as a guest (no generic 401 handler at boot). A pending boot is its own state:
     while the boot `GET /auth/me` is pending, an identity notification (step 7) marks the pending answer stale; when
     it arrives it is discarded and `GET /auth/me` is asked again (at most once more per notification) before anything
     renders.
  6. **Transition.** Triggered by the tab's own sign-out or closure, a `409 IDENTITY_CHANGED` on any request (the
     `apiClient` response interceptor; a bound tab whose session has ended gets this, not a 401, because a user id
     with no session answers 409), a notification naming a different `userId` (or `null`) while bound, a boot
     answer that differs from the binding, or a sign-in as a different `userId` while bound. In one synchronous task,
     in this order: set `leaving` in the store, so the app root renders
     only the neutral loading state and `sync.js`'s `apply` and every store action that takes an API response do
     nothing (pages write to the store only through actions: no `setState` outside tests at `9c24441`); make the
     persist adapter a no-op; remove the store key and the binding key from `sessionStorage` (only those two);
     `location.replace(landing)`. No late continuation of the tab can then show or persist the old person. The
     landing is decided before the store is cleared: `/admin-login` for a tab whose `/auth/me` answer had a
     `staffSession`, `/` for a guest or a customer. A transition from the tab's own sign-in as a different person
     lands where that sign-in leads instead: on the customer page its `next` with its query string (default
     `/account`), used only when it is a same-origin application path: it starts with exactly one `/` (not `//`),
     contains no backslash and no scheme, and `new URL(next, location.origin).origin === location.origin`; anything
     else lands on `/account` (the staff page takes no `next`); on the staff page `/admin-login`, which sends a staff member whose boot adopted a session on to
     their portal (`/admin` or `/insurer`), as after a sign-in. The wrong-portal sign-out lands on `/admin-login`
     with its "not a staff account" parameter (T-W3).
  7. **Notification.** On its own sign-in, registration with `signedIn: true`, sign-out or closure, a tab posts `{ userId }` (`null` for
     sign-out and closure) on `BroadcastChannel('insurshield-identity')`. A tab whose boot is pending handles any
     notification as step 5 says. Otherwise a receiving tab bound to a different `userId`, or bound and receiving
     `null`, transitions; an established guest ignores sign-in notifications (it stays a guest until it signs in).
     Receivers never post.
  8. **Back/forward cache.** On `pageshow` with `persisted === true`, the tab hides its content and re-runs the boot
     gate with its binding; a mismatch transitions.

  `submitRequest.js` needs no change: its uploads and the submission each carry the header current when they are
  sent, so if the person changes during the document conversion the server refuses them (T-W11), and its development
  fallback runs only on `NETWORK` errors, never on a 409.
- **W, service worker** (roadmap decision 20, 2026-10-28; stated as guarantees after review round 2). Today
  `public/sw.js` answers every same-origin GET from its cache first and stores whatever it fetches, under one
  hand-written cache name (`insurshield-shell-v2`). The API is same-origin by default (`/api/v1`,
  `src/config/env.js`), so a person's API answers can be stored and served again, and a new deploy can be masked by a
  stale page. What the new worker guarantees:
  1. **No API answer.** A request to the API on the site's own origin (under the API base path, whether configured as
     a path or as an absolute URL on this origin; matched by whole path segments; any query string; a fetch or a
     navigation) is never answered by the worker and never stored in Cache Storage.
  2. **Only the shell.** Cache Storage holds only the current build's shell (`index.html` and the hashed files it
     loads) and the fonts, always the files of the build whose worker stored them; nothing is written at run time.
     Its cache names start with `insurshield-`.
  3. **Deploys show.** Every build ships a worker that differs from the previous build's. It takes control without
     waiting for other tabs to close; once it controls a tab, that tab's next page load shows the new build; when it
     activates, every other `insurshield-` cache, today's `insurshield-shell-v2` included, is deleted. The worker
     never reloads a tab.
  4. **Network first, shell offline.** Page loads outside the API go to the network first; offline, after one page
     load controlled by the worker, a new page load shows the app's own page (not the browser's offline error) and
     leaves its loading state for what the boot gate shows when `GET /auth/me` fails on the network.
  5. **No new setting.** The app gains no environment variable; registration in `src/main.jsx` (production builds
     only) is unchanged. The worker tests' servers take free ports chosen at run time, and a build that needs its
     origin is made once the port is known.

  Not guaranteed: page loads answered by today's worker before the new one takes control (today's worker serves its
  cached page, and nothing on the new side can change that).

  Tests run on production builds in HTTP mode with the API at the site's own origin, in a Playwright project of their
  own that runs only `tests/service-worker.spec.js`, one test at a time; the existing project excludes that file and
  runs its tests as today. Before building, W writes its mechanism in its handoff (how the worker learns its build
  and the shell, how a deploy, today's worker and the API are reproduced in tests, how a test knows the worker
  controls the page); it is reviewed with the code.
- **D1.** Readable and stored values are both accepted; anything else is refused with a message listing the readable
  values. The insurer labels move into `contract.ts`; `insurer-response.dto.ts` reads them from there. The NCD input
  accepts only the three decisions it documents.
- **D3.** `POST /insurers/:id/restore`, super admin only: DELETED → INACTIVE, `deletedAt` cleared, in one conditional
  update (`WHERE status = 'DELETED'`); unknown id 404; an insurer that is not deleted 409 `INSURER_NOT_DELETED`.
  `GET /insurers?status=deleted` (super admin only) lists deleted insurers so the admin screen can offer restore.
  The admin screen loads that list and shows the restore action only when `staffSession.isSuperAdmin` is true; an
  admin sees neither, and the API refuses them anyway.
- **D4.** Each submission inserts its own `vehicles` row; nothing updates a `vehicles` row after insert (the update
  method is removed). Lookup: a guest, staff, or a customer without a request or policy on that plate gets
  `lookupFromRegistry`; a customer with one gets the details from their own latest request or policy on that plate
  (`source: 'PLATFORM'`), found by a query filtered by `customerId`.
- **D6.** The expected amount is `premium + fee`, the fee being `RTSA_ANNIVERSARY_FEE_NGWEE` when
  `quote_requests.matchRtsaAnniversary` is true and 0 otherwise; a wrong amount keeps today's answer,
  `409 AMOUNT_MISMATCH` with `details.expected`. Two fees, never mixed: the **current fee** is the setting applied to
  an unpaid request, returned as `rtsaAnniversaryFee` on an unpaid quote request so the web can show what will be
  charged; the **charged fee** is stored on the payment (M3) and returned, from the payment row, on the receipt, on
  a paid quote request and on the policy (`rtsaAnniversaryFee` in `dto/policy.response.ts`, selected in
  `policies.repository.ts`; the quote-request repository joins the request's confirmed payment for it), so a later
  change of the setting does not rewrite history. `PayDto.rtsaAnniversaryFee` is removed (with
  `forbidNonWhitelisted` an old client sending it gets 400, acceptable as nothing is deployed). The web shows the
  API's fee and total on the payment, confirmation and account screens; `PolicyConfirmationPage.jsx` stops computing
  the fee from a constant.
- **D8.** Same body, status 503 when either dependency is down, 200 when both are up; liveness unchanged.

## 5. Waves

### Migrations

| Id | File | What it does | What the previous build does on it |
| --- | --- | --- | --- |
| M1 | `drizzle/0002_better_auth.sql` | Adds `auth_users`, `auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_rate_limits` with `uuid` ids and their indexes (unique email, unique session token, unique `(providerId, accountId)`, unique rate-limit key, session and account by `userId`), `auth_sessions."userId"` and `auth_accounts."userId"` referencing `auth_users.id` `ON DELETE CASCADE`; if question 16 chooses (a), `auth_sign_in_failures` (`"emailKey"` `varchar(254)` primary key, `attempts`, `"windowStartedAt"` with an index, `"lockedUntil"`); adds nullable `"userId" uuid` to `customers` and `staff_users` with unique indexes and `RESTRICT` foreign keys; drops `NOT NULL` on both `"keycloakId"` columns | The Keycloak build keeps working: it never reads the new tables or columns, and it still writes `keycloakId` |
| M2 | `drizzle/0003_drop_keycloak_ids.sql` | Drops `customers_keycloakId_key`, `staff_users_keycloakId_key` and both `"keycloakId"` columns | Applied only after the Better Auth build (A) is the one running; that build never reads them. The Keycloak build would fail on it, which is why M2 waits for W3 |
| M3 | `drizzle/0004_payment_rtsa_fee.sql` | Adds `payments."rtsaAnniversaryFeeMinor" bigint NOT NULL DEFAULT 0` with the money bounds check | The previous build does not select or insert it; the default keeps its inserts valid |
| M4 | `drizzle/0005_vehicle_per_request.sql` | Data only: for every `vehicles` row referenced by more than one quote request, copies the current row once per further request and points that request, and the policies made from it, at its copy; policies without a quote request keep their row | Applied only after D4's code, which never updates a `vehicles` row, is running; the earlier code would share rows again |

Each migration has its `drizzle/catalog/<name>.json` and snapshot, is reviewed by both reviewers before it is applied
to any kept database, and is landed by the user with `/land-a-migration` after a checked backup. Unapplied, a defect
is fixed in place; applied, it needs a new migration.

### Waves

| Wave | Packages | Migrations and landing steps | What must be true before it starts |
| --- | --- | --- | --- |
| W0 | P0, E | none | Plan and section 8 answers approved; dependency version confirmed |
| W1 | S | M1 written, both reviews, user lands it on the dev database | P0 committed or staged as the user decides |
| W2a | A | none | M1 applied to the dev and test databases |
| W2b | B, C, W (parallel) | none | A green: its own specs pass and `test/sessions.ts` and `createCredentialUser` are fixed |
| W3 | K, S | M2, then M3: written, reviewed, landed in that order | A, B, C, W green and reviewed; the running API is the Better Auth build |
| W4a | D1, D3, D4, D8, N (parallel) | none | K done (for D8's doc section) |
| W4b | D6 | none | M3 applied; W4a reviewed (D6 then owns the customer and web adapter files D4 and D3 had) |
| W5 | S | M4 written, reviewed, landed | D4 reviewed and running |
| End | coordinator | none | Exit criteria in section 3 |

Every wave ends with its packages reviewed (second model, independent reviewer, security hunt) and their confirmed
findings fixed before the next wave starts.

**The development database at the switch.** When commit 3's build reaches the working tree (end of W2b, before the
manual run in exit criterion 5), the development database gets the step question 13 chooses. With (a), the user
backs it up, checks the backup, drops and recreates the database, applies the migrations to head and runs the
seed; the README documents those commands, and the agents do not run them: they change a kept database. With (b),
nothing is done: the old rows stay, and their emails and phones answer `409` at registration until the database is
reset.

### Commits (proposed, each approved by the user)

0. Repair the three failing web Playwright tests (E).
1. Add the Better Auth dependency (P0).
2. Add the Better Auth tables and the user links (M1, its schema, and the `keycloakId` narrowing in
   `test/builders.ts` that keeps the type check passing on the nullable column).
3. Sign in through Better Auth in the API (A, B, C): one commit, because the guard, the harness and the seed switch
   together and none of them builds alone on the other's old half.
4. Sign in through the API in the web (W).
5. Remove Keycloak from the stack and the docs (K).
6. Drop the Keycloak ids (M2).
7. One commit per product decision: 1 and 2 (D1, N), 3 (D3), 4 and 5 code (D4), 8 (D8), then 6 (M3 with D6, schema
   first in the same commit is allowed because the column is additive and unused by the earlier code; after D4's
   commit, because D6 builds on D4's customer files).
8. Give each existing quote request its own vehicle row (M4).

The build at each commit works on the schema that commit's migrations produce.

## 6. Dependants

| Changed thing | Caller or dependant | Behaviour changes? | Updated by / proved by |
| --- | --- | --- | --- |
| `AuthGuard` (bearer JWT → session cookie) | Every non-public controller route; `@Roles()` on admin, insurers, pia, insurer-portal | Credential changes; the `Principal` shape does not; unsafe methods now need a trusted `Origin` | A; B's converted specs prove every route unchanged; T-A10–T-A13 |
| `Principal.role` source (token → `staff_users.role`) | `@Roles()`, `InsurersService.setStatus` (delete only for super admin), admin and portal services | Same values, new source | A; T-A6, T-A7 |
| `AuthService.resolveCustomer` (removed) | `AuthGuard` only | Customers no longer appear on first call | A; T-A2, T-A3 |
| `customers."keycloakId"`, `staff_users."keycloakId"` | `auth.repository.ts`, `test/builders.ts`, `test/jwks.ts` and the specs that pass built rows to it, `scripts/seed-database.ts`, `scripts/demo-data.ts`, schema and migrate e2e; history files (unchanged) | Nullable at M1 (builders narrow it, commit 2), then removed | S (commit 2), A, C, S; API type check at commit 2, T-S2, `git grep` in exit criterion 2 |
| `GET /auth/me` `staffSession`, and the response itself | Web session restore and binding, `AdminDashboard.jsx`, D3's restore controls | Additive `isSuperAdmin` and `userId`; `role` unchanged | A, W, D3; T-A33, T-A36, T-D25 |
| Session lifetime (`session.disableSessionRefresh: true`, cookie cache off) | Every signed-in browser; `GET /auth/me`, `AuthGuard`, the identity routes | A session ends 7 days after sign-in however much it is used; no background request writes a cookie except a deletion (`get-session`, the only Better Auth read that could, is not exposed) | A, W; T-A24, T-A39 |
| `X-InsurShield-User` precondition (new) | Every Nest route through `AuthGuard`, `@Public()` and `@OptionalAuth()` included; the identity routes behind the mount middleware; the web's `apiClient`; e2e specs and other clients that send no header | Absent header: unchanged; a mismatched id: 409 `IDENTITY_CHANGED`, nothing written; `anonymous`: guest on public and optional-auth routes, 409 on session-required ones | A, W; T-A36, T-W11, T-W15, T-W16; B's converted specs (no header) prove the absent case |
| `request.ip` (consent records), Better Auth's client address | `POST /auth/consent`, registration's consent row, the limiter, session `ipAddress` | From `req.ip` under `TRUST_PROXY_HOPS`; inbound `x-insurshield-client-ip` dropped | A; T-A19, T-A34 |
| Registration (new) vs the seed | Seeded staff and demo emails; customer sign-up | Registration refuses staff emails; the seed refuses to link a user it did not create | A, C; T-A23, T-SD6, T-SD7 |
| Keycloak-era `customers` rows with `userId` null | Re-registration with the same email or phone | Never adopted; gone after the question 13 (a) reset, or kept under (b) with their emails and phones still refused at registration | K documents the reset; T-S8 |
| `pending:` phone placeholder | `AuthService.me`, `admin-response.dto.ts:49` | One shared function; new rows never have it | A; T-A17 |
| `ACCOUNT_CLOSED` | Guard, Better Auth session hook, `payments.service.ts:63` | Also refuses sign-in | A; T-A4, T-A5; payments e2e unchanged |
| `POST /identity/sign-in/email` (if question 16 (a)) | Web customer and staff sign-in pages, the e2e `signIn` helper, T-SD1's sign-ins | At most 10 attempts for one email are admitted per 15-minute window; the 10th starts a 15-minute lock, refused with 429 from any address; a success resets a window that has not locked; a failing admission count answers 503 `TRY_AGAIN`; counted in `auth_sign_in_failures` (M1); off with `AUTH_RATE_LIMIT=off`, so the helper and the converted specs are unaffected | A; T-A38, T-H2 |
| `AccountService.close` | `DELETE /account`; web closure | Also deletes the customer's sessions | A; T-A5 |
| `configureApp` | `main.ts`, `test/helpers.ts` `startApp` | Sets `trust proxy`, and in front of the identity mount the allow-list, client-address and identity-precondition middleware | A; T-H1, T-A19, T-A22, T-A36, T-A37 |
| `CORS_ORIGINS` | CORS, now also Better Auth `trustedOrigins` and the guard's origin check | One list, three uses | A; T-A10, T-A11 |
| `src/config/env.ts` | API boot, `env.spec.ts`, e2e global setup, seed | Keycloak settings out; four settings in (A), the fee setting in (D6) | A, D6; T-A20, T-A21, T-A31, T-D20 |
| Swagger security scheme | `/docs`, `swagger.e2e-spec.ts` | Bearer → cookie | A; swagger e2e |
| `test/jwks.ts` (deleted) | 13 specs, `global-setup.ts` | Replaced by `test/sessions.ts` | A, B; each spec's case count unchanged |
| Seed staff provisioning | `npm run db:seed`, `scripts/seed.e2e-spec.ts`, README | Through Better Auth, no longer skipped | C; T-SD1–T-SD7 |
| Web `apiClient` (bearer header removed; `X-InsurShield-User` added; a 409 `IDENTITY_CHANGED` transitions) | Every HTTP adapter call: `sync.js` and the pages that write API results into the store (`PaymentPage.jsx`, `submitRequest.js`, `AdminDashboard.jsx`, `ClaimsPage.jsx`, `InspectionWorkflowPage.jsx`, the insurer-portal tabs) | A request for an earlier person is refused by the server; once a transition starts, the screen is concealed and `sync.js` and the store actions apply nothing; responses are otherwise unchanged, so pages need no change | W; T-W1, T-W9, T-W11, T-W14 |
| Persisted store (`insurshield-storage`, every key in `PERSISTED_KEYS`) | Open browser tabs, other tabs of the same browser, old stored state, an old build's tab | Version bump and migration; in HTTP mode moved to per-tab `sessionStorage` and the old `localStorage` copy removed at boot, so a journey no longer survives a new tab or closing the browser (question 17); mock mode unchanged | W; T-W4–T-W7, T-W10, T-W13 |
| `contracts.js` auth part | Both adapters, `ARCHITECTURE.md` | New identity endpoints; bearer note removed | W, K |
| `NcdDecisionDto`, `SetInsurerStatusDto` | Web `NcdTab.jsx`, `AdminDashboard.jsx`; insurer-portal and insurers e2e | Also accept readable values | D1; T-D1–T-D4 |
| Insurer status labels (moved into `contract.ts`) | `insurer-response.dto.ts` | None on the wire | D1; insurers e2e response assertions |
| `InsurersRepository.update` filter `status <> 'DELETED'` | `update`, `setStatus`, `remove` | Unchanged; restore uses its own conditional update | D3; T-D7, T-D8 |
| `GET /vehicles/lookup` | One production caller, `VehicleIdentificationPage.jsx:52` (`api.vehicles.lookupPlate`); it does not branch on `source` and presents any result with RTSA wording (lines 128-142) | Guests always get the stand-in, which that page already presents the same way as today; no web change | D4; T-D11–T-D13; the existing `VehicleIdentificationPage.test.jsx` stays green unchanged |
| `vehicles` rows (immutable per submission) | Joins in `admin.repository.ts:116`, `insurer-portal.repository.ts:97,232`, `quote-requests.repository.ts:91,101`, `policies.repository.ts:66`; requote and renewal reuse `vehicleId` | Each request sees its own details; joins unchanged | D4, M4; T-D14–T-D16 |
| `plate-match.ts` `findVehicleByPlate`, `plateSearchPrefix`; `vehicleCandidates`, `updateVehicle` | `quote-requests.service.ts` only | Removed when unused | D4; lint (no unused exports), build |
| Payment amount check | Web `PaymentPage.jsx`; payments e2e | Fee from the server; `rtsaAnniversaryFee` input removed; mismatch still `409 AMOUNT_MISMATCH` | D6; T-D17–T-D20 |
| `payments` row (new column) | Receipt DTO, the policy response (`policies.repository.ts`, `dto/policy.response.ts`), the paid quote-request response, `CustomerAccountPage.jsx:314` (RTSA disc), `PolicyConfirmationPage.jsx`, admin and portal payment views | Charged fee returned from the payment; unpaid requests show the current fee | D6, M3; T-D21, T-D26 |
| `GET /health/ready` status code | Load balancer, deploy gates, `docs/DEPLOYMENT.md`, health e2e | 503 when down | D8; T-D22, T-D23 |
| Compose `keycloak` service, `KEYCLOAK_DB`, `01-databases.sh` | `npm run infra:up`, README, existing local volumes | Keycloak no longer started; an existing volume keeps its old Keycloak database until the user drops it (question 10) | K; T-K1 |
| Running API and open browser tabs during the switch | A browser holding the old store; a server on the old build | Old tabs lose their prototype session on reload; the old build stops working once M2 lands | W (store migration); M2 waits for W3 |

## 7. Tests per rule

Identity tests run against real Postgres through the HTTP surface (`test/identity.e2e-spec.ts` unless named), signing
in with real Better Auth sessions created in the test database.

| Test id | Rule | What fails without it |
| --- | --- | --- |
| T-S1 | M1 applies on a database at 0001 with Keycloak-era rows; existing customers and staff keep their rows with `userId` null | The migration breaks the development database |
| T-S2 | After M2, `keycloakId` and its indexes are gone; the catalog matches `catalog/0003_*.json` | A leftover column or index drifts from the catalog |
| T-S3 | The Drizzle auth tables match Better Auth's own field list for the configured options (unit test); a real sign-in writes an `auth_sessions` row and a limited request an `auth_rate_limits` row, both through the adapter's own inserts, with ids that are valid UUIDs (e2e) | A Better Auth field missing from a table, or a non-UUID id, fails at run time on first sign-in |
| T-S4 | `userId` is unique per table, and a user row cannot be deleted while a customer or staff row links it | Two domain rows share one login, or an orphaned domain row |
| T-S5 | M3 adds the fee column with default 0 and the money check refuses out-of-bounds values | Unbounded or missing fee data |
| T-S6 | M4: two requests sharing a vehicle row end with one row each, identical to the old row; their policies follow their request; a policy without a request keeps its row; running M4's statements twice changes nothing more | Backfill loses details, mispoints a policy, or doubles rows |
| T-S7 | Each migration replays on a scratch database from empty to head and matches its catalog | Migrations only work on one machine's history |
| T-S8 | Migration to registration: a database at 0001 holding an ordinary Keycloak-era customer (with a quote request) is migrated to head; registering with that customer's email answers 409 and links nothing (the old row keeps `userId` null and its records); after the question 13 (a) reset (drop, migrate to head, seed), registering with that email and phone succeeds as a new customer who sees none of the old records; deleting a user removes its sessions and accounts (cascade) | A new account inherits someone's history by email, the reset commands do not give a working database, or users leave sessions behind |
| T-A1 | Registration creates the user, credential account, customer and consent in one transaction and signs the person in (`201` with `signedIn: true`, `Set-Cookie`, then `GET /auth/me` returns the customer with consent); with session creation forced to fail after the commit it answers `201` with `signedIn: false`, keeps the account and sets no cookie | The registration flow does not work end to end, or committed work is answered as a failure |
| T-A2 | Two concurrent registrations with the same email (interleaving forced with a held lock): one 201, one 409 `ACCOUNT_CONFLICT`, one user row, no orphan user or account | Races leave a login without a customer, or 500 |
| T-A3 | Registration with another customer's phone: 409 with the neutral message; no user row left | Orphan users; enumeration through different messages |
| T-A4 | A closed customer's sign-in is refused (403, `ACCOUNT_CLOSED`) and no session row is created | Closed accounts can sign in |
| T-A5 | Closing the account deletes its sessions: the cookie used to close it answers 401 on the next request | A closed account keeps working until the session expires |
| T-A6 | An admin, a super admin and an insurer user each get the role in their `staff_users` row; changing the row changes the next request's role | The role comes from somewhere a user can influence, or is cached |
| T-A7 | An insurer user cannot reach admin routes (403) and sees only their insurer's records; an insurer user whose `insurerId` is changed sees the new insurer's records only, on the next request | Tenancy taken from a stale session |
| T-A8 | An inactive staff member cannot sign in and an existing session of theirs answers 403 | Deactivation does not take effect |
| T-A9 | A user with no customer or staff row, and one with both, is refused (401) at sign-in, with no session row written, and on a request with a session created before the second link was added; the hook and the guard call the same `resolveIdentity` | Guessing the kind of account; sign-in and requests disagree |
| T-A10 | An unsafe method with a session cookie and a foreign `Origin` answers 403, including `POST /documents` as `multipart/form-data` | Cross-site request forgery on Nest routes |
| T-A11 | Run under the e2e environment (`NODE_ENV=test`): Better Auth's own endpoints refuse a foreign `Origin` with a cookie (sign-out, revoke-sessions, change-password) | Cross-site sign-out or password change; checks silently off in test mode |
| T-A12 | A request without a cookie to a protected route answers 401; a forged or tampered cookie answers 401 | Unsigned or altered session tokens accepted |
| T-A13 | Session replay after sign-out: the old cookie answers 401 | Sign-out only clears the browser |
| T-A14 | Session fixation: a session token set before sign-in is not the one issued at sign-in, and the pre-sign-in value grants nothing | An attacker plants a session and inherits the sign-in |
| T-A15 | Sign out everywhere: two sessions of one user, revoke-sessions from one, both answer 401 | Sign-out everywhere leaves sessions alive |
| T-A16 | Changing the password revokes the other sessions and keeps the current one | A stolen session survives a password change |
| T-A17 | `me` and the admin customer view show no phone for an old `pending:` row, through one function | Placeholder leaks to screens; two copies drift |
| T-A18 | Rate limit: the sixth sign-in attempt within a minute from one IP answers 429; register limited at 3; the resolved auth context has `rateLimit.enabled` true with `AUTH_RATE_LIMIT=on` and false with `off` (under `NODE_ENV=test`), `storage` `database`, `window` 60, `max` 60 and the three `customRules` (unit); the fourth `change-password` within 10 seconds from one IP answers 429 | Unlimited password guessing, or a limiter left on Better Auth's in-memory, production-only defaults |
| T-A19 | With an app built from an injected environment (`AUTH_RATE_LIMIT=on`, `NODE_ENV=production`): with `TRUST_PROXY_HOPS=1`, two clients whose proxy-appended addresses differ get independent sign-in buckets (one exhausted, the other still signs in); a client that prepends forged `X-Forwarded-For` entries or sends `x-insurshield-client-ip` itself stays in its own bucket; with `TRUST_PROXY_HOPS=0`, a spoofed `X-Forwarded-For` does not change the bucket; no request falls into Better Auth's shared `no-trusted-ip` bucket | One attacker locks everyone out, or a header buys fresh attempts |
| T-A20 | The API refuses to start without `BETTER_AUTH_SECRET`, with a secret shorter than 32 characters or `CHANGE_ME`, and the message names the variable without its value (unit, `env.spec.ts`) | A weak or placeholder secret signs sessions |
| T-A21 | `AUTH_RATE_LIMIT=off` is refused unless `NODE_ENV=test` (unit) | Production runs without a limiter |
| T-A22 | Enumerating every endpoint on `auth.api` (path and method), only the allow-listed ones answer anything but 404 over HTTP: the exposed set equals the list exactly; concrete URLs of dynamic routes (`/reset-password/abc`, `/callback/x`), a trailing-slash variant of an allowed path (`/sign-in/email/`), a differently cased prefix or path (`/API/IDENTITY/sign-in/email`, `/<API_PREFIX>/identity/Sign-In/email`) and the wrong method on an allowed path answer 404 and reach neither Better Auth nor the database; in an app built from an injected environment with `NODE_ENV=production`, the four mail routes answer 404 | An unused or newly added endpoint creates users without customers, changes emails unverified, or edits `name` beside `customers.fullName` |
| T-A23 | Registration refuses a password under 8 characters and an email that a staff row holds, in any letter case | Weak passwords; a customer account shadowing staff |
| T-A24 | The guard never sets a cookie | The guard writes headers it cannot forward |
| T-A25 | Unit: with `NODE_ENV=test`, the resolved auth context has `skipOriginCheck` and `skipCSRFCheck` both false | Origin and CSRF checks off in every test run, so the tests prove nothing |
| T-A26 | `createCredentialUser` contract: `Mixed.Case@Example.com` is stored lowercase and signs in as typed and in lower case; passwords of 7 and 129 characters are refused, 8 and 128 accepted and able to sign in; the account row has `providerId 'credential'` and `accountId` equal to the user id; a body with an unknown field, a missing field or a malformed email answers 400 and writes nothing | Accounts that cannot sign in; unvalidated bodies reaching the database |
| T-A27 | Staff of a deleted insurer (question 8 (a)): sign-in refused with no session row; an existing session answers 403 on the next request; after the insurer is restored, sign-in and the old session's next request succeed | A deleted insurer keeps working accounts, or restore does not let them back |
| T-A28 | The guard's origin rule for cookie-authenticated unsafe requests: trusted `Origin` accepted; no `Origin` with `Sec-Fetch-Site: same-origin` accepted; no `Origin` and no `Sec-Fetch-Site`, `Sec-Fetch-Site: cross-site`, and `Origin: null` each answer 403 | Forgery through a request without an Origin header |
| T-A29 | Cookie attributes: with `BETTER_AUTH_URL` on `http://`, the session cookie is `HttpOnly`, `SameSite=Lax`, prefixed `insurshield`, without `Secure`; on `https://`, it is also `Secure` with the `__Secure-` prefix | Session cookie readable by scripts, sent cross-site, or sent over HTTP in production |
| T-A30 | Registration cannot be posted cross-site: a form-encoded body answers 415 (or 400) and writes nothing; a JSON body with a foreign `Origin` gets no CORS allowance | Cross-site account creation in a victim's browser |
| T-A31 | `TRUST_PROXY_HOPS` missing, negative, fractional or `CHANGE_ME` is refused at start, naming the variable (unit, `env.spec.ts`) | A deployment trusts forwarding headers it should not, or none it should |
| T-A32 | The client-address middleware runs only in front of the identity mount and overwrites the inbound header; when `req.ip` is undefined it deletes the inbound header and sets none; Nest routes see `req.ip` from the same setting | Two different ideas of the client address, or a client-chosen address when the socket address is unknown |
| T-A33 | `GET /auth/me` returns `isSuperAdmin: true` for a super admin and `false` for an admin and an insurer user, with `role` unchanged | The web shows super-admin controls to admins, or hides them from super admins |
| T-A34 | Behind `TRUST_PROXY_HOPS=1`, a consent record (registration and `POST /auth/consent`) stores the client address the proxy appended, not the proxy's, and not a forged leading entry | Consent records carry a wrong or forged address |
| T-A35 | Registration under the register limit: the fourth attempt in a minute from one address answers 429 whatever email or phone it carries | Unbounded probing of which emails and phones are registered |
| T-A36 | Identity precondition: with B's session, `X-InsurShield-User: <A>` answers 409 `IDENTITY_CHANGED` with a generic body and writes nothing, for one mutating route of each module and for `sign-out`, `revoke-sessions` and `change-password`; a user id with no session answers 409; `GET /auth/me` with a mismatched id answers 409; `GET /identity/get-session` answers 404; `anonymous` on a `@Public()` route and on `GET /vehicles/lookup` answers as for a guest whatever the cookie, and on a session-required route 409; `anonymous` with an existing session on `sign-out` answers 409 and the session row and cookie survive; on the identity routes a request without a session cookie is decided with no session query (`anonymous` passes, a user id 409), and one with the cookie, plain or `__Secure-` prefixed, is checked against its session; an absent or matching header behaves as today; `GET /auth/me` returns `userId`; a CORS preflight from a trusted origin allows the header | Requests begun for one person act under another's session; a guest tab reads a signed-in person's data |
| T-A37 | Fifty distinct unknown paths under the identity base path (and unlisted methods on listed paths) answer 404 and add zero `auth_rate_limits` rows, with the limiter on | Unbounded database writes from made-up paths |
| T-A38 | If question 16 (a), on an app built with an injected environment (`startApp`'s env override: `AUTH_RATE_LIMIT=on`, `TRUST_PROXY_HOPS=1`, a different `X-Forwarded-For` for each client address) and one fake clock: 10 wrong-password attempts for one email from 10 different client addresses, then the correct password from an eleventh answers 429 until 15 minutes after the tenth attempt and the lock remains; between minutes 5 and 15 a request whose expired address bucket makes Better Auth prune `auth_rate_limits` (the pruning seen in that table) leaves the lock in force; a window that starts at minute 0 and locks at minute 14 is still locked at minute 20; after expiry the correct password signs in and an unknown email given the same steps gets the generic 401; the invalid-credential answers and the active-lockout answers are the same status and body for a known and an unknown email; 10 attempts spread over more than 15 minutes from the first do not lock; a success before the tenth attempt clears the count, and a success as the tenth attempt leaves the lock in place; with nine attempts recorded, 20 concurrent attempts from different addresses admit at most one (one password check at most) and the others answer 429; a body that is `null` or a string, an email that is not a string and a 255-character email are neither checked nor counted, do not throw, and answer as without the plugin; letter-case variants of the email share one count; a failing admission statement answers 503 `TRY_AGAIN` and no password check runs; a failing success-clear or cleanup is logged and the sign-in's own answer is unchanged; cleanup removes rows whose window ended and whose lock is absent or past, and never a row with an active lock | Password guessing spread over many addresses or sent in a concurrent burst, a lock a success removes, or a lockout that reveals which emails are registered |
| T-A39 | Sessions are not extended (fake clock): Nest requests and `GET /auth/me` over six days leave the session's `expiresAt` unchanged and the session ends 7 days after sign-in; `GET /auth/me` and the guard set no cookie, for a valid, missing or expired session and with a stale `session_data` cookie sent; `GET /identity/get-session` answers 404; a server-side `auth.api.getSession` called without the `disableRefresh` query flag, past the default update age, also leaves `expiresAt` unchanged (so the global `session.disableSessionRefresh` is tested on its own) | A background request renews or restores a session cookie, so a delayed response can bring back an earlier person's session |
| T-A40 | A password change is admitted on its own counter per signed-in user | Ten failed sign-ins for an email lock its signed-in owner out of changing the password |
| T-H1 | The identity handler sees raw JSON bodies (sign-in with a JSON body succeeds) and its responses carry the CORS headers for a trusted origin | Handler mounted after Nest's body parser, or before CORS |
| T-H2 | `signIn(http, user)` gives a working cookie for customers and each staff role (harness spec) | Every converted spec fails for a harness reason |
| T-H3 | `GET /auth/me` and `POST /auth/consent` still answer as before (auth-service spec, unchanged cases) | The identity mount swallowed Nest's auth routes |
| T-SD1 | The seed creates the super admin, one insurer user per insurer and the demo customer, each able to sign in with `SEED_STAFF_PASSWORD` | Seeded accounts cannot sign in |
| T-SD2 | Running the seed twice creates no duplicates and keeps passwords unless `SEED_RESET_PASSWORDS=true` | Re-seeding resets or duplicates accounts |
| T-SD3 | The seed refuses `CHANGE_ME` or a missing `SEED_STAFF_PASSWORD`, naming the variable without the value | Accounts seeded with a known password |
| T-SD4 | A Keycloak-era staff row with the same email is relinked, not duplicated | Duplicate staff rows after the switch |
| T-SD5 | No password appears in seed output | Secrets in logs |
| T-SD6 | A customer registered with a seeded staff email before the seed runs: the seed stops with an error naming the email, links nothing, and the customer's account and records are unchanged | The seed hands a customer-created login staff rights |
| T-SD7 | A user registered with the demo customer's email before the seed runs: the seed stops the same way and writes no demo records onto that account | Demo data written onto a real person's account |
| T-W1 | HTTP adapter: sign-in, register, sign-out and `me` call the identity endpoints with credentials and no bearer header (adapter unit test with a stubbed transport) | Web and API disagree on the contract |
| T-W2 | Mock mode: every current sign-in, sign-up, reset and staff test still passes | The prototype loses its offline mode |
| T-W3 | Staff page: a customer account signing in is shown "not a staff account" and is signed out; customer page: staff are sent to their portal | Wrong portal reached with a valid session |
| T-W4 | HTTP mode, own sign-out and own account closure: the tab's store key and binding key are gone from `sessionStorage`, nothing of A is in `localStorage`, the tab reloads, and the next view is signed out with no records, journey, receipt or admin insurer list | Data of the previous person visible after sign-out or kept in browser storage |
| T-W5 | HTTP mode: a guest journey with photos and documents survives the guest's own sign-in in that tab; `next` with its query string and the consent step resume; another tab's sign-in does not reload a guest tab; a guest's public load in flight during that sign-in still applies | The resume flow loses the guest's journey, or guests are disturbed by other tabs |
| T-W6 | Persisted store migration: old state with `authToken` and `registeredAccounts` loads in mock mode; in HTTP mode the old `localStorage` copy is removed at boot and the session is decided by `GET /auth/me`, not by stored flags | A stale stored flag shows a signed-in screen without a session |
| T-W7 | `GET /auth/me` answering 401 at boot settles an unbound tab as a guest; a bound tab whose session has ended gets 409 `IDENTITY_CHANGED` on its next request, transitions once and boots as a guest | Signed-in screens for an expired session, or a reload loop |
| T-W8 | Web journey (Playwright, mock mode) passes with the Keycloak comment removed | Journey regression |
| T-W9 | A continuation that resumes after a transition began (a delayed hydrate, a payment receipt) cannot persist anything: the persist adapter is a no-op and `sessionStorage` stays without the store key | A's records written back for the next person |
| T-W10 | Two tabs bound to A; tab 2 signs out and signs in as B: tab 1 transitions exactly once, on the notification; no tab posts on receipt; a stale `GET /auth/me` answer costs at most one further reload; both tabs end bound to B or as guests with a bounded number of requests | One tab shows A's name over B's session, or tabs reset each other in a loop |
| T-W11 | Tab 1 goes from guest to A while a document conversion of its journey is in progress, and tab 2 switches the browser to B before the conversion ends: tab 1's upload and submission carry A and are refused with 409 `IDENTITY_CHANGED`, nothing is written under B, and tab 1 transitions | A's quote request submitted into B's account |
| T-W12 | A page bound to A restored from the back/forward cache after the browser switched to B transitions before any record is shown | A's records shown from the page cache under B's session |
| T-W13 | Mock mode unchanged: the store persists to `localStorage`, no `X-InsurShield-User` header is sent, no channel is opened | The prototype's offline mode changes |
| T-W14 | A transition hides the screen in the same task (only the neutral loading state renders), and a `sync.js` response that lands afterwards applies nothing to the store | A's data stays visible, or reappears, while the tab is leaving |
| T-W15 | A guest tab's vehicle lookup returns the guest answer (`anonymous` header) while another tab of the browser holds a customer's session cookie | A guest tab receives a signed-in person's vehicle details |
| T-W16 | A bound tab's `GET /auth/me` sent under another person's cookie answers 409 `IDENTITY_CHANGED` and the tab transitions once | A tab adopts a different person's session in place |
| T-W17 | Boot with no stored binding sends `GET /auth/me` without the header, adopts the answer (bound, or a guest on 401) and does not transition or loop; a guest tab with an unfinished journey, reloaded while the browser holds A's session, boots bound to A with the journey kept as A's; an unbound tab whose boot `GET /auth/me` (answering A) is delayed receives B's notification: A's answer is discarded, `GET /auth/me` is asked again, the tab binds to B and nothing of A renders | A boot that reloads forever, never binds, drops a reloaded guest's journey, or renders a person from an answer older than an identity change |
| T-W19 | HTTP mode: registration answering `201 { signedIn: false }` leaves the tab a guest (no binding, nothing posted, the next request carries `anonymous`), keeps the journey and `next` and offers sign-in; a successful sign-in then binds, posts once and resumes `next` | A committed account without a session deletes the guest's journey through a 409, or a tab binds to a person with no session |
| T-W20 | Transition landings: a customer tab's sign-out lands on `/`, a staff tab's on `/admin-login`; a customer tab bound to A that signs in as B on the customer page with `next=/quote-request?x=1` lands on that `next` bound to B; with `next` set to `https://attacker.example`, `//attacker.example`, `/\attacker.example` or `javascript:alert(1)` it lands on `/account`; a staff tab bound to A that signs in as staff B lands on B's portal | A transition drops `next`, sends staff to the customer home, or sends the browser off the site |
| T-W21 | Guarantee 1: with the page controlled by the worker and the API's origin checked equal to the page's, two identical signed-in API reads both reach the API and neither is answered by the worker; Cache Storage holds no API URL; a navigation to an API path with a query string gets the API's answer, and offline it gets a network error, not the shell; the same holds with the API base configured as an absolute URL on the site's origin | A person's data is answered from, or stored in, the worker's cache; an API navigation is replaced by the shell |
| T-W22 | Guarantees 2 and 3 from today's worker: with the `b279196` worker installed and a customer API response in `insurshield-shell-v2`, once the new worker controls the page only the new build's cache remains, it holds no API response, and the next page load shows the new build; after sign-out Cache Storage holds no customer response | An upgraded or signed-out browser keeps the previous person's data, or keeps showing the old build |
| T-W23 | Guarantees 3 and 4 between two builds that differ in content: with a second tab open, the second build's worker takes control of both tabs, the next page load in each shows the second build, the first build's cache is gone, the stored shell is the second build's files, and the worker reloads no tab; offline, after a controlled page load, a new page load shows the app's own page and leaves its loading state | A deploy waits for tabs to close, is masked by a stale page, the worker reloads tabs, or offline shows an empty shell |
| T-K1 | `docker compose config` succeeds with the root `.env.example` values filled and no `KEYCLOAK_*` variables; `git grep -i keycloak` finds only the history files | Compose refuses to start, or Keycloak left behind |
| T-K2 | README and `apps/api/.env.example` list every setting `env.ts` reads (a unit test comparing the schema keys with the example file, if one does not exist already) | Undocumented settings |
| T-D1 | NCD decision accepts 'Approved', 'Under Review', 'Rejected' and the stored values; refuses 'Submitted' and anything else with the readable list | The portal's decisions fail with 400 |
| T-D2 | Insurer status accepts 'Active'/'Inactive' and stored values; 'Deleted' and 'DELETED' only for a super admin | The admin toggle fails; an admin deletes through the toggle |
| T-D3 | `fromContract` round-trips every `toContract` value for both enums (unit) | A readable value maps to the wrong stored value |
| T-D4 | Another insurer's NCD application answers 404 for a decision with readable values | The new input path skips tenancy |
| T-D5 | A REJECTED application can be approved or put under review; an APPROVED one answers 409 | Rejection becomes final again, or approval reopens |
| T-D6 | A super admin restores a deleted insurer: INACTIVE, `deletedAt` null, its staff, products and history readable again | Restore loses data or returns ACTIVE |
| T-D7 | An admin and an insurer user get 403 on restore; an unknown id 404; an insurer that is not deleted 409 | Non-super-admins restore, or restore flips an active insurer |
| T-D8 | Two concurrent restores: one succeeds, one 409 (conditional update) | Double restore races |
| T-D9 | A restored insurer is not in the public directory until activated | Restore puts an insurer in front of customers |
| T-D10 | `GET /insurers?status=deleted` is super-admin only and lists only deleted insurers | Deleted insurers exposed to admins or insurers |
| T-D11 | A guest's lookup of a plate on the platform returns the stand-in, with no chassis or engine number from our records | Guests read other people's vehicle details |
| T-D12 | A signed-in customer with a request on the plate gets their own submitted details (`source: 'PLATFORM'`) | The fix breaks the returning customer's prefill |
| T-D13 | A signed-in customer without a request or policy on the plate, and any staff member, get the stand-in | Customers read another customer's vehicle |
| T-D14 | Customer B submitting the same plate with other details leaves customer A's request, policy and lookup unchanged | One customer overwrites another's records |
| T-D15 | A requote and a renewal keep their original's vehicle details | Requote shows the latest submitter's details |
| T-D16 | No code path updates a `vehicles` row: the repository has no update method, and an e2e compares every `vehicles` row before and after submission, requote and renewal | Shared rows return through a new caller |
| T-D17 | An aligned request: paying premium + fee succeeds and stores the fee; premium alone answers `409 AMOUNT_MISMATCH` with `details.expected` = premium + fee | The fee is not charged |
| T-D18 | A request that is not aligned: premium alone succeeds; premium + fee answers `409 AMOUNT_MISMATCH` | A fee charged for no alignment |
| T-D19 | A body carrying `rtsaAnniversaryFee` answers 400 | The client can still choose the fee |
| T-D20 | Changing `RTSA_ANNIVERSARY_FEE_NGWEE` changes new payments only; old receipts keep the fee they were charged | History rewritten by a setting |
| T-D21 | The quote request and receipt responses carry the fee in Kwacha, and the web shows those values (web test with a stubbed API) | The web shows its own constant |
| T-D22 | Readiness: 503 with `status: 'down'` and the dependency states when the database or storage is down; 200 when both are up | Deploy gates pass with a dead database |
| T-D23 | Liveness stays 200 while a dependency is down | The load balancer kills healthy containers |
| T-D24 | The portal describes rejection as reopenable and offers Approve and Keep under review on a rejected application (web unit) | The screen still says rejection is final |
| T-D25 | Admin screen (web unit): with `isSuperAdmin` true the deleted list and restore action are shown; with false (an admin) neither is shown and the deleted list is not requested | Admins see controls that always fail, or super admins cannot find them |
| T-D26 | Reload after the fee setting changes (e2e, app restarted with a new `RTSA_ANNIVERSARY_FEE_NGWEE`): the paid policy (`GET` of the customer's policies), its receipt and the paid quote request still show the charged fee; an unpaid aligned request shows the new current fee and paying the new total succeeds; the account screen's RTSA disc reads the policy's fee (web unit) | History rewritten on reload, or the account screen reads a field the API never sends |

## 8. Decisions needed from the user

| # | Question in plain language | Options | Recommendation |
| --- | --- | --- | --- |
| 1 | **How does the browser stay signed in?** | (a) A session cookie the browser keeps and JavaScript cannot read. Works smoothly when the web and the API share a site (same domain, or `app.` and `api.` under one domain); across unrelated domains browsers increasingly block it. (b) A token the web stores and sends in a header. Works across any domains, but any script injected into the page can steal it and use it elsewhere until it expires. | (a). It is the safer default and fits development already (Vite serves both on one origin). The production deployment must then serve the API on the same site as the web (for example CloudFront sending `/api/*` to the API); `docs/DEPLOYMENT.md` will say so. A session lasts 7 days from sign-in, then the person signs in again: it is not renewed while in use, so no background request can bring back an earlier person's cookie. |
| 2 | **What does a customer type to sign in?** Today's screen says "email or phone". | (a) Email only for now: phone sign-in comes with SMS codes in a later batch. The sign-in field asks for the email address. (b) Email or phone with a password, using Better Auth's phone plugin with phones not verified: someone can register another person's number, and that person then cannot use it for their own account; the plugin is also built around SMS codes we cannot send yet. | (a). The phone number is still collected at registration and shown on the account. The sign-in label changes from "Email or phone" to "Email address" in HTTP mode; mock mode keeps both. |
| 3 | **Email checks and forgotten passwords, while the API cannot send email.** | (a) Neither in this batch: addresses are not verified, and a forgotten password is reset only by re-seeding (staff) or by a developer; the "Forgot password" link is hidden in HTTP mode. (b) Build both flows now with a development mailer that writes the link to the API log; in production the endpoints are switched off until a mail provider is added, so production behaves like (a). (c) Add a mail provider now (a new dependency and an account with a provider). | (b). The flows are built and tested once, a developer can use them locally, and production cannot send a link to a log: the four routes they need (request reset, reset, send verification, verify) answer 404 in production (section 4, "Endpoints exposed"). The reset link points at the web's reset page with the token, not at the API. Sign-in does not wait for verification until a provider exists. |
| 4 | **Who creates staff accounts?** | (a) Only the seed, in this batch: one super admin and one portal user per insurer, with `SEED_STAFF_PASSWORD`. (b) Also a super-admin screen to invite, deactivate and reset staff, in this batch. | (a). It matches today; the screen is a feature of its own with its own reviews and goes in a later batch. |
| 5 | **A second sign-in step (authenticator app code) for staff?** | (a) Not in this batch; required before production. (b) Now, for super admins and admins. | (a). Nothing is deployed and there is no recovery flow by email yet (question 3); adding codes without recovery locks people out. Better Auth's two-factor plugin is the route when it comes. |
| 6 | **Should admin changes to insurers be recorded in an audit trail?** Today nothing records who created, edited, deactivated, deleted or restored an insurer. An `audit_logs` table exists but is not used for this. | (a) Yes, in this batch: each change adds an append-only row with who, when, what changed. (b) Yes, in a later batch. (c) No. | (b), planned with the staff screens of question 4, so all admin actions are recorded the same way. This plan does not add it unless you choose (a). |
| 7 | **Confirm the new dependency.** `better-auth`, pinned exactly at `1.7.12` (latest, 2026-10-20, MIT), added to `apps/api` only. It brings `kysely`, `better-call`, `nanostores`, `@noble/hashes`, `@noble/ciphers`, `defu`, `@better-fetch/fetch` and the `@better-auth/*` core, utils, telemetry and adapter packages (drizzle, kysely, memory, mongo, prisma). The web gets no new dependency: it calls the endpoints through its existing HTTP client. | (a) `1.7.12`. (b) An older 1.7 patch that has been out longer (1.7.8, 2026-10-14). | (a), re-checked with `npm view better-auth version` on the day P0 runs; telemetry switched off in code. |
| 8 | **Can staff of a deleted insurer still use the insurer portal?** Today they can: nothing checks the insurer's status. | (a) Refuse sign-in and requests for staff of a deleted insurer; staff of an inactive insurer keep their current access (today that includes writes). Restoring the insurer (decision 3) lets them back in. (b) Leave as today. Making an inactive insurer read-only would be a further decision with its own work and tests; it is not planned. | (a). A deleted insurer should not keep working accounts; it costs one condition in the guard and the session hook. |
| 9 | **The demo customer's password.** The seed has one demo customer with sample records. | (a) The same `SEED_STAFF_PASSWORD`, described in `.env.example` as the password of all seeded accounts. (b) A separate `SEED_DEMO_PASSWORD`. | (a), so decision 7 ("no change") holds and there is one seeded secret. |
| 10 | **The old Keycloak database in existing local volumes.** Removing Keycloak from Compose does not delete the `keycloak` database already inside a developer's Postgres volume. | (a) Leave it; README says how to drop it by hand. (b) The batch drops it (a destructive step on a kept database). | (a). It is harmless and dropping data is your call. |
| 11 | **The RTSA anniversary fee amount.** The web uses K500 as a prototype value. | (a) K500: each developer sets `RTSA_ANNIVERSARY_FEE_NGWEE=50000` locally; `.env.example` keeps `CHANGE_ME` like every other setting and the README names 50000 as the local value; required with no default in code. (b) Another amount you give. | (a) until RTSA's real fee is confirmed. |
| 12 | **Approve the portal wording for rejection (decision 2).** Present text, `NcdTab.jsx`: "Closes the application without a discount code. This cannot be undone here." | Proposed: "Closes the application without a discount code. You can reopen it later if the customer sends more evidence." | Approve, or give your wording. |
| 13 | **The customers who signed up under Keycloak.** Their rows stay in the development database with no Better Auth login. Because email and phone must be unique, anyone who tries to register again with the same email or phone is told the account exists, and can never sign in to it. The plan never hands such a row to whoever registers with its email, because the email was never verified. | (a) At the switch, reset the development database: back up, drop, migrate to head, seed. Everyone, including you, registers afresh; the seeded staff and demo customer come back from the seed. (b) Keep the old rows, and accept that their emails and phones cannot be registered again until the database is reset. | (a). Nothing is in production and there is nothing to keep; it is the simplest state to reason about. The README documents the reset commands; you run them, after the backup. |
| 14 | **How many proxies stand in front of the API in production?** The API needs this number to know which address in the forwarding header is the real visitor, for rate limiting and consent records. Too low, and every visitor looks like the load balancer and shares one sign-in limit; too high, and a visitor can fake their address. | (a) Decide it with the hosting: 1 for a single load balancer, 2 for CloudFront in front of a load balancer, and the API reachable only through them. (b) If you already know the hosting, tell me the number now. | (a). `TRUST_PROXY_HOPS` is required with no default, so a deployment cannot start without stating it; `docs/DEPLOYMENT.md` explains the choice. Local development uses 0. |
| 15 | **Registration reveals whether an email or phone is already registered.** Whatever the wording, "this account exists" differs from "account created", so someone can test addresses and numbers, and, since neither is verified yet, can register another person's email or phone first. | (a) Accept this for now: it is limited to 3 attempts per minute per address. It is temporary, and adding mail delivery alone does not end it: that needs a later registration redesign with the same answer whether or not an email or phone is taken, proof that the person owns the email and the phone before either is reserved, and release of emails and phones held by registrations nobody completed. (b) Do that redesign now; it needs the mail provider of question 3 (c) and an SMS provider for phones. | (a) while there is no mail or SMS delivery; the redesign is planned with the providers. |
| 16 | **Protecting one account from password guessing spread over many addresses.** Keycloak locked an account after repeated failed sign-ins (`bruteForceProtected`). The plan's limits are per visitor address only (5 sign-ins a minute), so someone using many addresses can keep guessing one person's password. | (a) A limit per email for every account: for example at most 10 sign-in attempts within 15 minutes; the 10th starts a 15-minute lock during which sign-in with that email is refused whatever address it comes from. Attempts are counted, not only failures, and a successful sign-in resets a count that has not locked (it never ends a lock). It needs one new table of the application's own (`auth_sign_in_failures`, in M1), keyed on the lower-cased email, because Better Auth clears its own rate-limit table after 5 minutes. It answers the same for an email that has no account, so it does not reveal which emails are registered. The cost: anyone who knows a person's email can keep them out for 15 minutes at a time. (b) Accept address-only limits until staff two-factor sign-in (question 5). | (a). It closes the gap Keycloak covered, at the cost of a delay someone could cause on purpose; section 4, "Failed sign-ins per email", and T-A38 describe it. |
| 17 | **An unfinished quote is kept per browser tab.** In HTTP mode, to keep one person's data from reaching the next person on the same browser, each tab keeps its own copy of what is in progress (`sessionStorage`). An unfinished quote survives a refresh of the same tab, but not opening it in a new tab or closing the browser; today it survives both. Mock mode is unchanged. | (a) Accept this. (b) Keep unfinished quotes on the server (drafts tied to the account), so they follow the person anywhere; a later batch, with its own endpoints and tests. | (a). It is what makes the identity rules simple enough to trust; drafts on the server are the way to bring cross-tab resume back. |

## 9. Not verified

- **The Express mount order inside NestJS 12.** The Nest 12 source shows `enableCors()` installing at once and the
  JSON parser being registered during `init()`, so the order is as planned, but it was not proved by running it. T-H1
  fails if the order is wrong; the fallback is `NestFactory.create(AppModule, { bodyParser: false })` in `main.ts` and
  `startApp`, with `express.json()` added back after the mount in `configureApp`.
- **Better Auth behaviour read in the 1.7.12 source but not run** (section 1 lists what was read and where): the IP
  headers and shared bucket, the test-mode origin and CSRF switches, `generateId: 'uuid'`, the adapter's schema-key
  lookup, `disabledPaths`, `disableSignUp`, the plugin `onRequest` order, sign-in's email and password rules, the reset
  link, `getSession`'s `disableRefresh`, `session.disableSessionRefresh` leaving Better Auth's session read with no cookie write but
  a deletion (missing or expired session, stale `session_data` cookie) while the cookie cache is off (`api/routes/session.mjs:155-181`,
  `cookies/index.mjs:76`), `before` hooks running ahead of the endpoint's own body checks (`api/dispatch.mjs:210`),
  the rate-limit defaults and the precedence of `customRules`
  (`context/create-context.mjs:170-176`, `api/rate-limiter/index.mjs:240-270`), the pruning of every
  `auth_rate_limits` row older than the longest window (`api/rate-limiter/index.mjs:174-194`), the built-in
  change-password and send-verification-email rules (`:305-317`), `getSessionCookie` (`cookies/index.mjs:261-270`), the `Origin: null` inference
  (`origin-check.mjs:109-113`), after hooks seeing an endpoint's error as `ctx.context.returned`
  (`api/dispatch.mjs:229-243`), and the `better-auth/cookies` and `better-auth/crypto` exports. Not read in
  the source: `databaseHooks.session.create.before` refusing with an `APIError` and writing no session row, plugin
  endpoints (`createAuthEndpoint`) with their own rate-limit rule, `telemetry: { enabled: false }`, that `auth.api`
  endpoint objects expose `path` and `options.method` for T-A22's enumeration, the router's exact status for a
  non-JSON body (T-A30), that requests through `toNodeHandler` run plugin `before` and `after` hooks the same way
  (T-A38), and the exact field lists of the five models. A-package's first item is a spike test of each against the
  pinned version; T-S3, T-A9, T-A18, T-A19, T-A22, T-A24, T-A25, T-A30, T-A38 and T-A39 fail if any is wrong. If
  registration as a plugin endpoint is not possible, the fallback is a Nest route that checks `Origin` itself and is
  covered by a `customRules`-equivalent limit; the plan's rules and tests stay the same.
- **Accepted: one session read before any limit.** On the identity routes that the precondition checks, as on every
  Nest route, a request that carries a session cookie costs one session read before Better Auth's limiter runs (Nest
  routes have no limiter at all); a request without the cookie costs none. No per-address limit is put in front of
  the middleware in this batch.
- **Concurrent SQL of the per-email limit** (if question 16 (a)): that the admission upsert serializes one email's
  admissions, and that `FOR UPDATE SKIP LOCKED` cleanup neither waits on nor deadlocks with an admission, is taken
  from PostgreSQL's documented row locking, not run; T-A38's concurrent and cleanup cases prove it.
- **Express `trust proxy` with a numeric hop count** behaving as described (`req.ip` taken that many hops from the
  socket) was taken from Express's documented behaviour, not read in the source; T-A19 and T-A34 prove it.
- **The other web pages that write API results into the store** were found by search (`PaymentPage.jsx`,
  `submitRequest.js`, the admin and portal pages); a search found no `setState` outside tests, so the `leaving` check
  in the store actions covers them, but each page's code was not read line by line.
- **The identity header across origins.** In development the Vite proxy makes every call same-origin. If production
  serves the API on another origin of the same site, `X-InsurShield-User` makes each call need a CORS preflight; the
  `cors` package Nest uses reflects requested headers when `allowedHeaders` is not set, which was taken from its
  documentation, not read in the source. T-A36 includes a preflight from a trusted origin.
- **`BroadcastChannel`, `pageshow` and `sessionStorage` behaviour** is taken from the web platform specifications;
  W's tests run them in jsdom and in Playwright (T-W10, T-W12), not in every browser.
- **Whether Better Auth's adapter can join our `db.transaction`.** Registration therefore writes the user and account
  rows itself through `createCredentialUser`, rather than calling Better Auth's sign-up inside our transaction.
- The phone-number plugin's schema fields were not confirmed (the docs page renders them from a component); it is not
  used unless question 2 chooses (b).
- `npm view` runs only outside the repository: the npm on this machine's `PATH` is 11.5.1, below the repository's
  `devEngines` requirement of `^11.13.0`. The build itself was not run; nothing in this plan was compiled or tested.
- The four web-only commits on `origin/main` were read only where named in section 1; `apps/web/src/app/**` (guards
  and providers) was not read beyond the tests that name the session actions.
- Whether any public `POST` route is called with a session cookie by a browser (the origin check only applies to
  cookie-authenticated requests, so a public route is unaffected either way).

### Corrections to the brief

- The web does not call `POST /auth/login` or `POST /auth/staff/login`: they exist only as unused functions in the
  HTTP adapter. No page calls any `api.auth.*` function; all sign-in runs in the browser store in both modes.
- The web does not send the RTSA fee today (decision 6 said it "stops sending it"): it adds K500 to `amount` without
  sending `rtsaAnniversaryFee`, so aligned payments fail the amount check now.
- Decision 2 needs no API rule change: `canDecideNcd` already allows a REJECTED application to be decided again; the
  change is the web wording and the offered choices.
- The insurer status labels are not in `src/common/contract.ts` but in `src/insurers/dto/insurer-response.dto.ts`.

## 10. Review findings

| Id | Verified how | What changed and where, or declined and why |
| --- | --- | --- |
| R1-C1 = R1-R-M3 (High) | `schema.ts:114-116` at `9c24441`: unconditional unique email and phone indexes; registration inserts a new row | Section 4 "Identity model": no adoption of an unlinked row by email. New section 8 question 13 (recommend resetting the development database at the switch; alternative a reviewed cleanup step). Section 5 "The development database at the switch"; package C; K documents the reset; T-S8 (migration to registration); dependants row |
| R1-C2 = R1-R-H1 (High) | 1.7.12 core `utils/ip.mjs:180-206` (default `x-forwarded-for`, multi-value → no IP, no socket fallback) and `rate-limiter/index.mjs:236-248` (shared `no-trusted-ip` bucket) | Section 4 "Client address" and "Rate limiting": `trust proxy` from required `TRUST_PROXY_HOPS`, middleware sets the private `x-insurshield-client-ip` from `req.ip` and drops inbound copies, `ipAddressHeaders` only that header; consent `request.ip` from the same setting; `AUTH_CLIENT_IP_HEADER` removed from "Configuration". T-A19 rewritten; T-A31, T-A32, T-A34 added; new question 14; section 1 facts; K docs |
| R1-C3, R1-R-M1 ids (High) | core `db/adapter/get-id-field.mjs:45-61`, adapter `index.mjs:549` (pg supports UUIDs) | Section 4 "Tables": `advanced.database.generateId: 'uuid'`, ids from the existing `id()` helper; T-S3 inserts real session and rate-limit rows |
| R1-C4 = R1-R-H3 (High) | `api/sync.js:19-51`, `store/persistence.js:21-27`, `slices/session.js:16,60,88` at `9c24441`; no query library in the web | Section 1 corrected (no query cache; what is persisted). W scope adds `src/api/sync.js`, `src/api/index.js` (if needed) and `src/store/**`; "W, person-bound state" names every slice `resetPersonState()` resets, the `identityEpoch` check in `apiClient`, the cross-tab `storage` rule. T-W4, T-W5 rewritten; T-W9 (delayed A response after B signs in), T-W10 added; dependants rows |
| R1-R-H2 (High) | 1.7.12 `context/create-context.mjs:210-211`, `api/middlewares/origin-check.mjs:14-15` | Section 4 "Origins and CSRF" and A's notes: `disableOriginCheck: false`, `disableCSRFCheck: false` set in code. T-A25 (resolved context under `NODE_ENV=test`); T-A11 runs under the e2e env |
| R1-C5 (Medium) | `test/builders.ts:42-69`, `test/jwks.ts:104-116`, `tsconfig.json` strict at `9c24441`; no compiler run | Narrowing in the legacy builders with M1: S owns `test/builders.ts` in W1 for that only; commit 2 names it; dependants row. The nullability change stays in M1 |
| R1-C6 (Medium) | 1.7.12 `api/routes/sign-in.mjs:315-318`, `context/create-context.mjs:186-187` | Section 4 "Registration": body validation and the `createCredentialUser` contract (lowercased email in user and domain rows, explicit 8/128 bounds from the context, context hasher, `providerId 'credential'`, `accountId = user.id`). T-A26 |
| R1-C7 = R1-R-M2 (Medium) | 1.7.12 `api/index.mjs:165-180` (exact `disabledPaths`, limiter then plugin `onRequest`), `api/routes/sign-up.mjs:145`, `api/routes/password.mjs:58-92` | Section 4 "Endpoints exposed" rewritten as an allow-list plugin (exact method and raw path, 404 otherwise), `disableSignUp: true`, `disabledPaths` dropped; question 3 (b) routes listed, reset links generated as web links from the token, mail routes 404 in production. T-A22 rewritten (enumerates `auth.api`, dynamic routes, trailing slash, wrong method) |
| R1-C8 (Medium) | `policies.repository.ts:42-49`, `dto/policy.response.ts:89-96`, `CustomerAccountPage.jsx:314`, `quote-requests.repository.ts:63-66` at `9c24441` | D6 scope adds the policy repository and DTO, the quote-request files (fee only), the account screen (fee only) and customer e2e fee cases; current fee vs charged fee defined in D6's notes; W4 split into W4a and W4b so D4 and D6 never share files in a wave; commit order; T-D26 (reload after the fee changes); section 1 and dependants corrected |
| R1-C9 (Medium) | `auth.service.ts` `PORTAL_ROLE`, `AdminDashboard.jsx:205-206` at `9c24441` | Additive `staffSession.isSuperAdmin` on `/auth/me` (A), kept by W, read by D3 for the restore controls. T-A33 (API, all three roles), T-D25 (web, both roles); section 1 and dependants |
| R1-C10 = R1-R-M4 (Medium) | `auth.service.ts:70-73` wording; plan's own 201/409 behaviour; reviewer's staff-email shadowing case | Section 4 "Registration" no longer claims wording prevents enumeration and states the bounded disclosure; registration refuses staff emails case-insensitively; package C: the seed never links a seeded row to a user it did not create and stops naming the email instead. New question 15 (recommend accepting under the rate limit until mail). T-A23 (any case), T-A35, T-SD6, T-SD7 |
| R1-C11 (Medium) | `auth.guard.ts:35-61`, `insurer-portal.service.ts:59-63` at `9c24441` | One `resolveIdentity` for the session hook and the guard, refusing neither and both rows. Session renewal behaviour of the web defined (start and on visibility, at most hourly). Tests T-A9 (both rows at session creation), T-A27 (deleted insurer: sign-in, existing session, after restore), T-A28 (missing-Origin rule), T-A29 (cookie attributes over HTTP and HTTPS), T-W11 (web renews; renumbered T-W18 in round 2) |
| R1-C12 (Low) | `payments.service.ts:93-98`, `test/payments.e2e-spec.ts:174-178` | 409 `AMOUNT_MISMATCH` kept: T-D17, T-D18 and D6's notes; dependants row |
| R1-C13 (Low) | `insurer-portal.service.ts:59-63` | Question 8 says "keep their current access (today that includes writes)"; section 1 item 3 corrected; read-only inactive insurers listed as out of scope |
| R1-C14 (Low) | `PolicyConfirmationPage.jsx:7,40,56`; `VehicleIdentificationPage.jsx:52`, only production `lookupPlate` caller; `schema.ts:279,430` | Section 1 corrected (confirmation computes from the constant; ids not all UUID); dependants row for the lookup names the one caller and says no web change is needed |
| R1-C15 (Low) | `AGENTS.md` "Configuration" (`CHANGE_ME` placeholders) | `.env.example` keeps `CHANGE_ME` for the fee and for `TRUST_PROXY_HOPS`; K500 named as the proposed local value in the README and question 11 |
| R1-R-M1 cascade (Medium) | Plan M1 row omitted it | M1 and section 4 "Tables": `auth_sessions` and `auth_accounts` reference `auth_users` `ON DELETE CASCADE`; the adapter gets an explicit schema object keyed by default model names, `modelName` dropped (adapter `index.mjs:63`); T-S8 checks the cascade |
| R2-C1 (High) | `submitRequest.js:34-80`, `lib/files.js:66-79` at `9c24441`: an upload after an awaited conversion sends whatever identity is current then | The request-level epoch is gone. Section 4 "W, identity boundary" (identity design v3 with its amendments A1-A6, design-reviewed by the second model: build yes): per-tab `sessionStorage`, a binding per tab, `X-InsurShield-User` on every request; the server refuses a request for another person (new "Identity precondition", package A: `AuthGuard` and the middleware in front of the mount, `409 IDENTITY_CHANGED`), so a switch during conversion is refused by the server and `submitRequest.js` needs no change (its fallback runs only on `NETWORK`). T-W11, T-A36; package rows A and W; dependants rows (header, `apiClient`, `/auth/me`). W's notes: the wrong-portal sign-out is a transition that carries the "not a staff account" message (T-W3); T-W6 and T-W7 restated for per-tab storage and the boot rule; the renewal test is now T-W18 and only bound tabs renew |
| R2-C2 (Medium) | `store/store.js:22-30`, `store/persistence.js:18-28` at `9c24441`: one `localStorage` key shared by every tab | No shared person-bound state (per-tab `sessionStorage`), so no reset to broadcast; notifications go only from the acting tab and receivers never post; transitions conceal, stop persisting and reload in one task. T-W9, T-W10 (convergence, bounded requests, no chained resets), T-W12, T-W14, T-W16, T-W17. New question 17 (a journey no longer survives a new tab or closing the browser) |
| R2-R-F5 (Low) | Plan r2 "W, person-bound state" | `identityEpoch`, the `apiClient` cancellation, `resetPersonState()` and the `storage` listener are removed; guest tabs are never reloaded by another tab's sign-in and their public loads apply (T-W5); the catalogue is no longer reset to seeds |
| R2-C3 = R2-R-F8 Q13 (Medium) | `schema.ts:308,420,588` at `9c24441`: quote requests, payments and inspections restrict deleting a customer | Question 13 option (b) is now "keep the old rows and accept that their emails and phones cannot be registered again until the database is reset"; the selective cleanup is removed from section 5, package C and the dependants row; T-S8 checks that a kept row is never linked and that the (a) reset gives a working registration |
| R2-C4 (Medium) | 1.7.12 `api/routes/sign-up.mjs:155-156,192-204` (Better Auth's generic duplicate answer belongs to the sign-up this plan disables); `schema.ts:114-115` | Question 15 (a) stays a temporary acceptance; ending it needs a later registration redesign (uniform answers, ownership verification of email and phone, release of abandoned reservations); mail delivery alone does not end it. Section 2 "Out" says the same |
| R2-R-F1 (Medium) | 1.7.12 `api/index.mjs:165-180`: the router runs the limiter before plugin `onRequest` | The allow-list is an Express middleware in front of the mount (same exact method and raw path rule, 404 before Better Auth runs); the sentence about unlisted paths counting towards the limit is removed; middleware order stated. T-A37 (50 unknown paths, zero `auth_rate_limits` rows); dependants `configureApp` row |
| R2-R-F2 (Medium) | `infra/keycloak/realm-insurshield.json:16` at `9c24441` (`bruteForceProtected: true`) | New question 16 (recommend (a): a per-email failed sign-in limit for every account in `auth_rate_limits`, same answer for unknown emails, with the deliberate-lockout cost stated). Section 4 "Failed sign-ins per email (if question 16 (a))": before and after hooks, atomic upsert, key on the lower-cased email. T-A38; dependants row; section 2 "Out" line; section 9 (hooks through the router not run) |
| R2-R-F3 (Medium) | Plan r2 package table: D1 owned `insurers/dto/**` while D3 needs a query DTO in the same wave | D3 owns only the new `insurers/dto/insurer-list.query.ts`; D1 owns the rest of `insurers/dto/**` |
| R2-C5 (Low) | 1.7.12 `api/middlewares/origin-check.mjs:109-113` | Section 1 CSRF bullet describes the `Origin: null` + `Sec-Fetch-Site: same-origin` inference; the Nest guard's rule stays stricter (T-A28 unchanged) |
| R2-C6 (Low) | `schema.ts:77` (`$defaultFn(randomUUID)`), adapter `index.mjs:311-314` (inserts through Drizzle), core `get-id-field.mjs:45-61` | Section 1 "Ids" and section 4 "Tables" say the id comes from the Drizzle default on the adapter's insert; T-S3 requires successful adapter inserts with valid UUIDs, not SQL-generated ids |
| R2-R-F4 (Low) | 1.7.12 `context/create-context.mjs:170-176` (enabled only in production, window 10, max 100, memory), `api/rate-limiter/index.mjs:240-270` (custom rules after special rules) | Section 4 "Rate limiting" and A's defaults list name `rateLimit.enabled` (set by `AUTH_RATE_LIMIT`), `storage`, `window`, `max`, `customRules`; T-A18 checks the resolved context |
| R2-R-F6 (Low) | Plan r2 "Configuration" and the `env.ts` dependants row | A adds four settings; D6 adds `RTSA_ANNIVERSARY_FEE_NGWEE` in W4b; dependants row corrected |
| R2-R-F7 (Low) | 1.7.12 `api/index.mjs:172-173` | No plugin `onRequest` remains (the allow-list moved to Express; the per-email check throws an `APIError` from a `before` hook). T-A19 and T-A22 build the app from an injected environment (`startApp` env override); T-A32: the middleware deletes the inbound header and sets none when `req.ip` is undefined |
| R2-R-F8 Q14 (Low) | Plan r2 question 14 | Option (b) reads "If you already know the hosting, tell me the number now" |
| R3-C1 = R3-R-H1, R3-C4, R3-C5, R3-R-L4 (Medium) | 1.7.12 `api/rate-limiter/index.mjs:116-133,174-194` (a reused expired bucket prunes every row older than the longest window, any key), `api/routes/sign-in.mjs:315-336` (invalid credentials are `401 INVALID_EMAIL_OR_PASSWORD`; invalid email and over-long password 400), `api/dispatch.mjs:108-135` (an `after` hook's error after the session was created) | Section 4 "Failed sign-ins per email": counters move to the application's own `auth_sign_in_failures` (M1; `"emailKey"` `varchar(254)`, `failures`, `"windowStartedAt"`, `"lockedUntil"`), the rule as question 16 states it (window from the first failure, lock for 15 minutes from the tenth), one atomic upsert, only invalid-credential failures counted, the after hook logs its own errors, no key for a non-string or over-long email, times from the API clock, rows not pruned (bounded by the per-address limit). Registration caps email at 254. Section 4 "Tables", M1 row, dependants row, question 16 ("no new table" removed). T-A38 rewritten (cleanup between minutes 5 and 15, spaced failures, identical answers, post-expiry results, uncounted cases) |
| R3-C2 (Medium) | `apps/web/src/lib/apiClient.js:35-36` at `9c24441` (any 2xx resolves); 1.7.12 `api/routes/sign-up.mjs:255-257` (session creation checked apart from the account) | W step 3: a tab binds from registration only on `signedIn: true`; on `signedIn: false` it stays a guest with journey and `next`, posts nothing, and the page offers sign-in. Step 7 posts only on `signedIn: true`. New T-W19; W's test range T-W1–T-W20 |
| R3-C3 (Low) | 1.7.12 `api/routes/sign-out.mjs:42-54` (sign-out deletes the session the cookie names) | Section 4 "Identity precondition": skipping the cookie for `anonymous` is a rule of Nest `@Public()` and `@OptionalAuth()` routes only; the identity-route middleware inspects the session and answers 409 to `anonymous` when one exists. A's notes say the same. T-A36: `anonymous` with a session on `sign-out` answers 409 and the session survives |
| R3-R-M2 (Medium) | 1.7.12 `api/index.mjs:165-180` (limiter inside the router, behind the Express middleware); `cookies/index.mjs:261-270` (`getSessionCookie` reads the cookie without a query) | Section 4 "Identity precondition": no session cookie, no query (`anonymous` passes, a user id 409); only a request with the cookie reads the session. Section 9 accepts the one session read before any limit, as on Nest routes. T-A36 case |
| R3-R-M1 (Medium) | Plan r3 step 4 (a tab with no stored binding adopts at boot) against the guarantee | W's guarantee: a guest receives no one's personalised data while a guest; at its next boot it adopts the browser's session and its journey then belongs to that person; after a 409 it transitions (journey dropped with the store) and the next boot adopts. Step 4 says the same. T-W17 extended. The brief's "after a 409 the journey belongs to the adopted person" is stated as dropped, because step 6 clears the tab's store |
| R3-C6 (Low) | 1.7.12 `api/rate-limiter/index.mjs:249-276,305-317` | Documented, not overridden (nothing in section 4 contradicts them): section 4 "Rate limiting" names `change-password` 3 per 10 s and `send-verification-email` 3 per minute as retained built-in rules. T-A18 checks the change-password rule; section 9 lists the source read |
| R3-R-L1 (Low) | Plan r3 precondition (a bound tab with no session answers 409) | Step 6: the "401 from an authenticated call while bound" trigger removed; an ended session reaches the transition through the 409. T-W7 restated |
| R3-R-L2 (Low) | `App.jsx:32,51-56`, `StaffLoginPage.jsx:64` (no `next`; navigates by role), `CreateAccountPage.jsx:66` (`next`, default `/account`) at `9c24441` | Step 6: landing decided before the store is cleared: `/admin-login` for staff, `/` for a guest or customer; from the tab's own sign-in as a different person, the customer page's `next` with its query string, or the staff page, which sends an adopted staff session on to its portal; the wrong-portal sign-out lands on `/admin-login` with its parameter. New T-W20 |
| R3-R-L3 (Low) | Plan r3 "Endpoints exposed" (raw, case-sensitive comparison) and Express's case-insensitive matching | The allow-list, client-address and precondition middleware are registered on the mount's own path pattern, so a differently cased prefix reaches the allow-list and gets 404. T-A22 adds cased-prefix and cased-path cases |
| R4-C1 (Medium) | `CreateAccountPage.jsx:66` at `9c24441` (`next` taken from the query string unchecked); plan r4 step 6 (`location.replace(landing)`) | Step 6: a landing from `next` is used only when it is a same-origin application path (one leading `/`, no `//`, no backslash, no scheme, same origin by `new URL`), query string kept, otherwise `/account`. T-W20 adds external, protocol-relative, backslash and `javascript:` cases |
| R4-C2 = R4-R-L1 (Medium) | 1.7.12 `api/routes/sign-in.mjs:315-322` (an unknown email answers the counted 401); plan r4 "rows are not pruned" | Replaced by flow L's contract (F-L rows): opportunistic `SKIP LOCKED` cleanup of rows whose window ended and whose lock is absent or past, index on `"windowStartedAt"`; retention stated as opportunistic, not bounded by the per-address limit. T-A38 cleanup cases |
| R4-R-L2 (Low) | 1.7.12 `cookies/index.mjs:261-263` (`getSessionCookie` calls `.get` on a `Headers` or a request's headers); `api/dispatch.mjs:210` (`before` hooks run ahead of the endpoint's body checks) | Section 4 "Identity precondition": `getSessionCookie(fromNodeHeaders(req.headers), { cookiePrefix })` with one prefix constant (also "Sessions" and A's notes). "Failed sign-ins per email": a body that is not an object or an email that is not a string gets no key and does not throw. T-A36 (cookie plain and `__Secure-`), T-A38 (`null` and string bodies) |
| R4-R-L3 (Low) | Plan r4 T-A38 named no environment | T-A38 names `startApp`'s env override with `AUTH_RATE_LIMIT=on`, `TRUST_PROXY_HOPS=1` and a varying `X-Forwarded-For` |
| R4-R-L4 (Low) | Plan r4 "Registration" (no `signedIn`) and T-A1 | "Registration" answers `201` with `signedIn: true` after creating the session, or `signedIn: false` with the account kept and no cookie. T-A1 forces session creation to fail after the commit |
| F-L1 (High) | Flow review (Codex): admission and verification were not serialized; `api/dispatch.mjs:210`, `api/routes/sign-in.mjs:317-331`; a late success deleted a new lock | "Failed sign-ins per email" written as a contract (guaranteed, not guaranteed). Attempts are counted at admission in the `before` hook by one upsert whose row lock serializes one email's admissions; more than 10 in a window answer 429 before the password check; success deletes only a row without a lock. Column `failures` → `attempts` (M1, Q16, section 6). T-A38: 20 concurrent attempts with nine recorded admit at most one; a right password during a lock is refused and the lock remains |
| F-L2 (Medium) | Flow review (Codex): cleanup inside the counting transaction could deadlock and roll back an increment (`database.module.ts:63`, `lock_timeout`) | Cleanup is a separate statement outside any transaction holding the email's row, on one admission in N, selecting at most 100 rows `FOR UPDATE SKIP LOCKED`; its errors are logged. Section 9 lists the concurrent SQL as not run |
| F-L3 (Low) | Flow review (Codex): no deadline holds when no further admissions run | Retention is stated as opportunistic in "Not guaranteed"; a periodic sweep is a later concern |
| F-L4 (Medium) | Contract review (Codex): logging and continuing on a counting outage contradicts the admission limit | A failing admission statement refuses with `503 TRY_AGAIN` (fail closed); only success-clear and cleanup failures are logged without changing the answer. Section 6 row and T-A38 |
| F-L5 (Low) | Contract review (Codex): a check admitted before the lock can run its password verification after it | The guarantee reads "no new attempt is admitted during the lock (a check admitted before the lock may finish)" |
| F-L6 (Low) | Contract review (Codex): the reset assignments at a window's end were unspecified | A new window starts only when the old one ended and no lock is active, so a window's end never clears an active lock. T-A38: a window started at minute 0 and locked at minute 14 is still locked at minute 20 |
| F-I1 (High) | Flow review (Codex): a delayed renewal response could restore A's cookie after B signed in; 1.7.12 `api/routes/session.mjs:155-214`, `cookies/index.mjs:76`; `session.disableSessionRefresh` in core `types/init-options.ts:1078` | "Sessions": `session.disableSessionRefresh: true`, fixed 7-day sessions, cookie cache stays off, `deferSessionRefresh` not used, `/auth/me` forwards no deletion headers. The web's renewal is removed ("The guard", step 4, package W row) and T-W18 with it; T-A24 keeps only the guard rule; new T-A39; section 6 row "Session lifetime"; question 1 states the 7-day session. W's guarantees add "no background creation or renewal of the session cookie" and the not-guaranteed simultaneous cookie-writing actions |
| F-I2 (Medium) | Flow review (Codex): an unbound tab's pending boot ignored a notification and then rendered A; `auth.service.ts:109-115`, `apiClient.js:35-36` at `9c24441` | Step 5: a pending boot is its own state; a notification marks the pending answer stale, it is discarded and `/auth/me` is asked again (at most once more per notification) before rendering; step 7 defers to it; an established guest still ignores sign-in notifications. W's guarantees add I2. T-W17 adds the delayed-boot case |
| F-I3 (Low) | Contract review (Codex): "only user actions write the cookie" ignored the deletion `get-session` still writes | The guarantee reads "no background creation or renewal; the only background cookie write is a deletion for a missing or expired session". T-A39 checks `get-session` writes only a deletion and `/auth/me` none (T-A39's `get-session` case is superseded by R5-R-L1: the route is not exposed) |
| R5-R-L1 (Low) | Round 5 reviewer: `GET /identity/get-session` stayed allow-listed with no caller after renewal was removed | Removed from the allow-list (answers 404); Sessions, Identity precondition, W step 4, the Session lifetime row, T-A36 and T-A39 updated (coordinator edit) |
| R5-R-L2 (Low) | Round 5 reviewer: with the cookie cache off Better Auth also deletes a stale `session_data` cookie on a valid session (`api/routes/session.mjs:44-46`) | Sessions and section 9 say "only a deletion" for every case; T-A39 sends a stale `session_data` cookie and checks `/auth/me` and the guard set none (coordinator edit) |
| R5-R-L3 (Low) | Round 5 reviewer: the guard's `disableRefresh` query flag is redundant beside `disableSessionRefresh` | Kept as a second guard; A's notes say neither is removed because the other exists (coordinator edit) |
| R5-C-final (Low ×2) | Codex check of the coordinator's edit | T-A39 adds a server-side read without the query flag so `disableSessionRefresh` is tested on its own; the F-I3 row marks its `get-session` case superseded |
| Roadmap r1 R-M6 (Medium) | Roadmap review: package W's file list lacked `public/sw.js`, whose cache-first rule serves stale pages and could keep same-origin API answers (`public/sw.js` at `b279196`) | W's row gains `public/sw.js`, the production-build Playwright project and `tests/service-worker.spec.js`; "W, service worker" in section 4; T-W21–T-W23 in section 7 (2026-10-28) |
| B2-SW r1 (Codex 4 M; reviewer 5 M, 2 L) | Review of the amendment: Playwright projects would run each other's tests; the tests could pass without a controlling worker or a same-origin API; deploy and offline unspecified; cache rule ambiguous (API paths, query strings, navigations, manifest); no rule makes a new worker on a deploy (`CACHE_NAME` hand-written, `sw.js` copied unchanged); today's worker not treated as the old deploy; offline needs a precache | "W, service worker" rewritten: build step in `vite.config.js` (added to W) stamps build id, precache list and API path; answer order with API first; activate deletes every other site cache; tests in their own project with `testIgnore`, stubbed counted API at context level, controller wait; T-W21-T-W23 rewritten (2026-10-28) |
| B2-SW r2 (Codex 4 M; reviewer 2 M, 4 L; 4 introduced by r1's mechanism) | Re-review of the r1 rewrite: skipWaiting unstated; deploy and old-worker tests not buildable with fixed servers; precache through the HTTP cache; absolute same-origin API base; cache recognition; build-id source; parallel upgrade tests; test API not pinned same-origin | Two fix-introduced Mediums stopped piecemeal fixing: "W, service worker" restated as five guarantees with what is not guaranteed; the mechanism is W's, written in its handoff and reviewed with the code; T-W21-T-W23 tied to the guarantees; W's files gain `tests/service-worker/` (2026-10-28) |
| B2-SW r3 (Codex none, DESIGN yes; reviewer 3 L, DESIGN yes) | Design review of the guarantees: guarantee 4 read literally covered API navigations; "renders the app" offline had no pass condition; no new variable versus no ports in tests | Guarantee 4 says "outside the API" and names what is seen offline (T-W23 likewise); guarantee 5 covers the app, test servers take run-time ports (2026-10-28) |
| B2-A r2 (Codex 1 H, 1 M, 3 L; reviewer 5 L; 1 M and 3 L introduced by fix round 1) | Re-review of package A's fix round (`457bb3b`..`d989f84`), each finding checked against the code and Better Auth 1.7.12 | Fix round 2 (b2-a-fix2): change-password gets its own counter per user (Failed sign-ins); identity routes answer database failures as the Nest filter does, one definition; the chunked-body test made deterministic; encoded and dot-segment paths tested against the allow-list. Declined: the `dont_remember` cookie (Better Auth sets it only when `rememberMe` is false, which A forces true; no build that set it ran for anyone; it is signed). Recorded, not built: chunked identity bodies stay refused (Mounting; K documents the proxy); README `NODE_ENV` row goes to K (2026-10-29) |
| B2-A race (Codex design gates 1 and 2: BUILD no) | Password change versus a racing sign-in or change: Better Auth verifies before its writes (`api/routes/update-user.mjs:166-180`), adapter transactions off; a sweep plus a re-check after each session insert was refused twice (hook deferral in `runWithTransaction`, no user on reset, stale-authorised writes) | The user accepted the window on 2026-10-29: recorded under Sessions as not guaranteed; per-user serialisation is a later hardening item |
| B2-A r3 (Codex none in code, 2 L plan; reviewer 3 L, one older finding) | Review of fix round 2 (`d989f84`..`24d4045`) | Plan wording corrected (body length, the race window, both budgets accepted); the G2 test raises the error as Better Auth wraps it. Older finding confirmed: Better Auth logged raw errors whose messages carry query parameters (session token, password hash, email) -> fix round 3 (Logging) (2026-10-29) |
| B2-A r4 (Codex 2 M; reviewer 1 M, 2 L; none introduced by the fix) | Review of fix round 3 (`24d4045`..`0453295`) | Control characters escaped in Better Auth log lines (log forging through `callbackURL`); the change-password failure test asserts its answer; the fallback-join console print recorded under Logging as not guaranteed by the user (2026-10-29) |
