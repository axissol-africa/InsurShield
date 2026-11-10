# Batch 6: Jobs, email, notifications and verified accounts

## Purpose

Give the platform a way to do work after a request has committed, and a way to tell someone about it.

Two mechanisms arrive here that most later batches depend on: a database-backed job and outbox runner, and the email
adapter behind a notification service. `roadmap.md:456-457` lists the runner as used by batches 6, 8, 11, 12, 13, 14,
15, 16 and 18, and the email adapter and notification service by 7, 8, 12, 13, 14, 15, 16 and 17. Their shape matters
more than the speed of delivering them: a later batch that needs a different contract pays for it across nine others.

With those in place, the batch finishes what batch 2 left. Email verification and password reset become real rather
than logged, protected records stay closed until an address is verified, and a customer can say how they want to be
contacted.

This batch changes no pricing, no quote journey and no insurer workflow. What it adds is work that happens after a
commit, and messages that follow from it.

## Starting point

Verified in the code on `main` at `4676cf8`.

- **Mail is a function, not an adapter.** `src/auth/dev-mailer.ts:15` returns a bare object with `sendResetPassword`
  and `sendVerificationEmail`. No port, no token, no `@Injectable`, no registry registration. Its one caller is
  `src/auth/auth.instance.ts:84`, wired at `:112` and `:114`. `deliver` (`dev-mailer.ts:16-19`) silently drops mail
  when `NODE_ENV` is production.
- **The identity flows are configured but fenced off.** `auth.instance.ts:108-113` has `emailAndPassword` enabled with
  `requireEmailVerification: false` (`:111`) and `sendResetPassword` wired; `emailVerification` (`:114`) has only
  `sendVerificationEmail`, no `sendOnSignUp`. The four mail routes are appended to the allow-list only when
  `mailRoutesEnabled` (`src/auth/auth.constants.ts:21-23`, true for development and test), so in production they 404.
- **No mail settings exist.** `src/config/env.ts` has no SMTP, MAIL, EMAIL or FROM key. This batch adds the first.
- **No scheduling of any kind exists.** No `@nestjs/schedule`, no queue dependency, no `setInterval`, no `@Cron`, no
  bootstrap loop. The dependencies that would serve are already present: `pg` and `drizzle-orm`. The idioms are in
  the tree too — a transaction-scoped advisory lock is used by `src/db/migrator.ts:424`, and bounded batch claiming
  with `FOR UPDATE SKIP LOCKED` by `src/auth/sign-in-limit.plugin.ts:92`.
- **`integration_deliveries` is a half-built outbox already in the schema** (`src/db/schema.ts:758-783`) with
  `attempt`, `status`, `requestPayload`, `error` and a `status, createdAt` index — and no reader or writer anywhere.
  It is insurer-keyed (`insurerId NOT NULL`) and its kinds are insurer-facing (`src/common/domain/enums.ts:91`).
- **Idempotency records never expire in practice.** `idempotency_records` (`schema.ts:740-756`) has `expiresAt` and
  an index on it (`:754`), but `IdempotencyService.execute` (`src/common/idempotency/idempotency.service.ts:61-71`)
  never compares it, and nothing deletes a row. A 24-hour-old key still replays today.
- **Verification state exists twice and is dead both times.** `customers.emailVerifiedAt` (`schema.ts:213`) is never
  written or read outside the schema. `auth_users.emailVerified` (`schema.ts:113`) is Better Auth's own and is never
  read by application code. `resolveIdentity` (`src/auth/identity.ts:21-52`) reads `deletedAt`, `isActive` and
  `insurerStatus`, and the `Principal` it returns has no verification field.
- **Consent is privacy and terms only.** `consent_records` (`schema.ts:228-243`) holds `privacyVersion` and
  `termsVersion`. No marketing consent, no channel, no purpose, no withdrawal. There is no contact-preference table
  and no notifications table; `claim_notifications` (`schema.ts:588-621`) is a claim record, not a message.
- **Every event this batch must announce already has a transition point**, each writing through `AuditService` in the
  caller's transaction: quote ready `src/insurer-portal/insurer-portal.service.ts:155` (guarded so only the first
  insurer reply transitions, `:154`), payment `src/payments/payments.service.ts:158`, policy created `:174`,
  certificate issued `insurer-portal.service.ts:240`, claim received `src/customer/claims.service.ts:95`, claim
  acknowledged `insurer-portal.service.ts:298`, NCD decided `:384`.
- **The audit writer strips what a message needs.** `src/common/audit/audit.service.ts:6` drops any key matching
  `email|phone|token|url` from snapshots, so an outbox row cannot be written through `AuditService`.

## What the requirements ask

| Source | What it requires |
| --- | --- |
| EN-005 (`user-stories.md:866`) | Template version, consent, channel, delivery receipt and retry on every notification |
| US-CUS-002 | A single-purpose, time-limited verification link; protected records closed until it is used; denial revealing nothing about whether an account exists; the approved cooldown on attempts and resends |
| US-CUS-003 | Acceptance records keeping notice type, version, purpose, actor or session, and timestamp; a changed version asks again |
| US-CUS-004 | Sensitive contact changes re-verified before they take effect; disabling marketing never suppresses a mandatory notice |
| US-CUS-019 | A centre showing read state, the linked record, the event time and the next action; retries that never duplicate a successful delivery; no protected content on an unverified device |
| FR-CUS-003 | Tokens time-limited, single-purpose, rate-limited and validated by the server |
| `roadmap.md:180` | The scheduled purge of expired `idempotency_records`, which batch 3 deferred to this runner |
| `roadmap.md:189` | The customer notification on an NCD decision, which batch 3 removed with `notifyCustomer` until this batch could send it |

## Delivery order

Every numbered package starts by adding a failing behaviour test, then applies the smallest durable fix.

### B6.1 The job runner

1. One table, `jobs`, serving both scheduled work and the outbox: `kind`, `key`, `payload`, `runAfter`, `attempt`,
   `maxAttempts`, `status`, `leaseUntil`, `lastError`. A unique index on `(kind, key)` is what makes a fact enqueued
   twice one row, and is therefore the whole answer to "at least once, never duplicated" — the consumer does not have
   to be idempotent by luck.
2. Claim by lease, not by session lock: one `UPDATE … SET status='RUNNING', leaseUntil = now() + interval
   WHERE id IN (SELECT id … FOR UPDATE SKIP LOCKED LIMIT n) RETURNING *`. A runner that dies leaves rows whose lease
   expires and which are then claimable again, with `attempt` already counted. `AGENTS.md` forbids `pool.connect()`
   and a session-level lock does not fit `db.transaction`'s lifetime, so exclusion is transaction-scoped.
3. One runner at a time, as the roadmap asks, through `pg_try_advisory_xact_lock` per tick: a second instance that
   cannot take it simply does not poll. The lease above is what keeps that safe rather than merely orderly.
4. Retries back off on `attempt`, up to `maxAttempts`, then the row ends `FAILED` and stays — a failure is visible in
   the table, not only in a log.
5. Started after the provider gate passes and the port opens, not in `onModuleInit`: `main.ts:21-30` runs the gate
   after `app.init()` and closes the app when it trips, so a runner started at module init would be draining jobs
   before the gate had refused the deployment. Stopped from the existing shutdown hook (`main.ts:15`), finishing the
   batch in hand and releasing its leases.
6. `integration_deliveries` is left alone. It is insurer-keyed and its kinds are insurer-facing, so it cannot carry
   customer notifications unchanged, and adopting it would leave two delivery mechanisms. Batch 11 owns it.

### B6.2 The email port, its stand-in and its live adapter

1. A port around the operation the use case needs: send this message, answer `sent` with the provider's own
   identifier, or `failed` with whether a retry could succeed. No provider SDK in the port.
2. The stand-in logs the message and keeps emitting a parseable link, because `test/identity.e2e-spec.ts:845` and
   `:895` drive the reset and verification flows by parsing it out of the log.
3. The live adapter, selected by a setting, registering with batch 5's gate with its mode derived from that setting
   the way storage derives its own (`src/storage/storage.module.ts:27-31`) rather than asserted.
4. `mailRoutesEnabled` (`auth.constants.ts:21`) is split. It means two things today — whether the four mail routes
   are served, and whether mail is actually delivered — and production now needs the first true and the second true,
   which the single flag cannot express.

### B6.3 Notification templates and the centre

1. `notification_templates`, versioned and addressed by `(key, version)`, each carrying its channel and whether it is
   mandatory. A message records the version it was rendered from, so a later edit cannot rewrite what was sent.
2. `notifications` for the in-app centre: recipient, template key and version, the linked record, the next action,
   read state, created time. The row carries a link to the record, never the protected content behind it.
3. The notification service is the only thing that decides whether a message is sent: it resolves the active template
   version, applies consent and preference, writes the centre row and enqueues the email job in the caller's
   transaction.
4. Delivery receipts: the provider's identifier and status against the job row, so a retry can tell a message that
   was accepted from one that was not.

### B6.4 Consent and contact preferences

1. `contact_preferences` per customer and category, with the channel and whether it is enabled. Per category, not per
   event: no requirement asks for finer, and a finer grain is a product decision.
2. Marketing consent recorded as consent, not as a preference flag, so it carries the version, purpose and timestamp
   US-CUS-003 asks for and withdrawals are a new row rather than an edit.
3. A mandatory notice ignores preference and records the rule that made it mandatory, so the decision is auditable
   rather than implicit in the template.
4. A changed email or phone is re-verified before it is used, so a mistyped address cannot silently redirect a
   customer's notifications.

### B6.5 Verified accounts

1. `customers.emailVerifiedAt` becomes authoritative, and `auth_users.emailVerified` stays Better Auth's business.
   One of the two dead columns has to win; the application's own is the one the application should read.
2. `resolveIdentity` (`identity.ts:21-52`) carries verification on the principal, and the gate on protected records
   lives there rather than in each controller.
3. Registration answers the same whether or not an address is taken. This is where the batch is hardest, and it is
   the subject of decision 3 below.
4. Verification and reset tokens are stored hashed, time-limited and single-purpose, with the cooldown the existing
   `/request-password-reset` rule already applies (`auth.instance.ts:127`).

### B6.6 Wiring the events

Each event enqueues in the same transaction as the state change it follows, beside the existing audit write: quote
ready, payment confirmed, policy created, certificate issued, claim received, claim acknowledged, NCD decided. The
NCD notification is the one batch 3 removed with `notifyCustomer` (`roadmap.md:189`).

"Inspection updated" is not wired, because there is nothing to wire it to — see decision 4.

### B6.7 The idempotency purge

1. A recurring job deleting `idempotency_records` whose `expiresAt` has passed, in bounded batches, using the index
   that already exists (`schema.ts:754`).
2. `expiresAt` is currently never consulted on read, so purging changes replay behaviour at the 24-hour boundary: a
   key that would have replayed yesterday stops existing. The read path starts honouring expiry in the same change,
   so the behaviour is one decision rather than an accident of timing.

### B6.8 The browser side

The notification centre, the preference screen, and the verification prompts that stand in front of protected
records. Existing screens keep their behaviour; an unverified session sees the prompt, not an error.

### B6.9 Coverage, configuration and documentation

Unit tests for the runner's claiming and backoff, the template resolver, the consent and preference rules, and the
stand-in adapter. E2e tests for each acceptance check below. `apps/api/.env.example` and the README Configuration
table gain every new setting.

## Privacy and security rules

- A notification carries what the recipient needs to act and a link to the record. Never a premium, a policy
  document, a claim narrative, a signed download URL, or anything the recipient would otherwise sign in to see.
- A job payload carries identifiers, not copies. The consumer reads the record when it delivers, so a payload cannot
  drift from the record or outlive its retention.
- Verification and reset tokens are stored only as hashes, so a copy of the table does not let anyone complete a flow.
- Registration, resend and reset answer the same whether or not an address is registered — in the response, the
  status and the timing. `registration.plugin.ts:47` already equalises hashing cost for this reason; build on it.
- Marketing consent gates only marketing. A mandatory notice is sent whatever the preference says, and the rule that
  classified it is recorded with the message.
- Delivery receipts record the provider's identifier and status. A provider response carrying personal data is not
  stored verbatim.

## Acceptance checks

1. A state change and its job row commit together: a failed transaction leaves neither.
2. The same fact enqueued twice is one row, and a successful delivery is never repeated by a later retry.
3. Two runners started at once do not deliver the same row twice; a runner killed mid-delivery leaves the row
   claimable again rather than stuck, with its attempt counted.
4. A delivery that keeps failing backs off, stops at its limit, and ends visible in the table rather than silent.
5. A notification is rendered from the template version active when it was generated, and records that version.
6. Registration with an address already in use is indistinguishable, in response, status and timing, from
   registration with a new one.
7. Protected customer records stay closed until the address is verified, and the refusal does not reveal whether the
   address exists.
8. A customer who has disabled marketing still receives a mandatory notice, and the record says which rule required it.
9. A changed contact address is not used for notifications until verified in its own right.
10. The centre shows read state, the linked record, the event time and the next action, and shows no protected
    content on an unverified session.
11. Expired idempotency records are purged on a schedule, the purge cannot remove an unexpired one, and an expired
    key no longer replays.
12. A production start is refused while the email adapter is a stand-in, by batch 5's gate and with no second gate.
13. Existing customer, insurer, payment, inspection and admin journeys keep their established outcomes.

## Deliberate boundaries

- No queue, broker or external scheduler. The runner is a table and a loop, as `apps/api/AGENTS.md` prescribes for
  work that must survive a crash. A broker is a batch 20 decision if load ever asks for one.
- SMS and WhatsApp are not channels here. Decision 16 (`roadmap.md:30`) settles the MVP at an in-app centre plus
  email. The channel column exists so a later batch adds one without a migration.
- `integration_deliveries` stays untouched and unused, for batch 11.
- Renewal reminders, deadline warnings, draft purges, MFA codes and badge recalculation are named by later batches as
  users of this runner. This batch builds the runner and wires only the events listed in B6.6.
- Phone verification is out of scope; see decision 3.

## Decisions

*Resolved items keep their reasoning, so a later reader sees what was chosen against.*

**1. The roadmap asks for two things that cannot both be true.** `roadmap.md:217-218` asks for "the email adapter
with a log stand-in", and `:221-222` asks for password reset and email verification "switched on in production on the
email adapter". Under batch 5's gate a registered stand-in refuses a production start, so a log-only adapter means
production cannot run at all. Batch 5's own plan already expects the live adapter here
(`batch-5-documents-and-provider-gate.md:40`: "email in 6"). So this batch should ship both a stand-in and a live
adapter — and a live adapter needs a provider and a way to talk to it:

- (a) An HTTP email API over the built-in `fetch`, adding **no dependency**, with the provider chosen by setting.
- (b) SMTP, which needs a mail library and so an explicit dependency authorisation under `AGENTS.md`.

**Decided (user, 2026-11-09): (a), the HTTP email API over built-in `fetch`.** No dependency is added. The provider's
own request and response shape is confined to one mapping function, so naming the provider is a separate question and
is only needed before the adapter can register as `live`. Until then the gate holds production closed, which is the
behaviour we want rather than a gap.

**2. Switching the verified-email gate on locks out every existing customer.** Both verification columns are dead, so
every customer today is unverified by both measures. Turning the gate on without a rule closes protected records for
the entire existing user base.

**Decided (user, 2026-11-09): grandfather them.** The migration sets `emailVerifiedAt` for customers that already
exist, from a column the row already carries rather than from the migration's own clock, so the timestamp says when
the account was created rather than pretending the address was checked at migration time. The backfill is recorded in
the migration's comment as a grandfathering step, not as verification, so a later audit of who proved an address can
tell the two apart.

**3. The roadmap under-scopes what its own cited decision requires.** `roadmap.md:222-223` asks that registration
answer the same whether or not an email is taken. Batch 2's question 15 answer
(`batch-2-better-auth.md:1003`, `:1097`) requires the same for **phone**, and ownership proof before either is
reserved — which needs an SMS provider this batch does not have. Three things also conflict with a uniform answer
today: the endpoint returns `409 ACCOUNT_CONFLICT` for a taken address (`registration.plugin.ts:58`, `:65`, `:81`);
it creates the account and signs it in immediately (`:85-94`), which cannot be mimicked for a taken address; and
`customers.email` and `customers.phone` are both `NOT NULL` and uniquely indexed. Doing email only, as the roadmap
says, leaves phone enumerable through the same endpoint. I recommend email only in this batch, with phone recorded
as a known gap for the batch that brings SMS — but that is a deliberate narrowing of an approved decision and is
yours to make.

**4. "Inspection updated" has no transition to announce.** `InspectionsService.update`
(`src/inspections/inspections.service.ts:95`) changes the customer's own preferences and refuses once work has
started (`:106-111`); nothing in the insurer portal or admin moves an inspection past `REQUESTED`. So the customer
would only ever be notified of their own edit. Either the event means a staff-side update that does not exist yet —
which is batch 13's inspection model — or it is dropped here. Recommended: drop it from B6.6 and let batch 13 wire it
when there is something to announce.

**5. Which categories a customer may turn off.** B6.4 stores preferences per category. The categories, and which are
mandatory rather than optional, are a product decision: my proposal is that quote, payment, policy, claim, NCD and
inspection notices are mandatory operational messages, and only marketing is optional.

## What this batch did not finish

Two acceptance checks have no implementation and therefore no test. Both are
recorded here rather than quietly dropped, because a batch that closes with an
unstated gap is how a requirement goes missing.

**Acceptance check 6 — registration answering the same whether or not an address
is taken.** Still answers `409 ACCOUNT_CONFLICT` for a taken address
(`registration.plugin.ts:58`, `:65`, `:81`). Three things block a uniform
answer, none of them hard but none of them small: the endpoint creates the
account and signs it in immediately, which cannot be mimicked for an address
that is taken; `customers.email` and `customers.phone` are both NOT NULL and
uniquely indexed, so a reservation cannot be held loosely; and batch 2's
question 15 requires the same treatment for phone, which needs an SMS provider
this batch does not have. The recommendation in decision 3 — email only here,
phone with the batch that brings SMS — is still unanswered by the user.

**Acceptance check 9 — a changed contact address re-verified before use.** B6.4
deferred it to B6.5 on the grounds that the verification machinery would exist
there; B6.5 built the gate and the grandfathering but not this. A customer can
still change their email and have notifications follow it without proving the
new address.

Neither blocks what this batch does deliver, and neither is covered by a test
that would fail: they are absent, not broken.

## Completion evidence

- Lint, type check, build, API unit tests, API e2e tests and the real-API web journey pass, with counts reported.
- The migration applies on a fresh database and on one holding existing customers, consent records and idempotency
  rows, and its catalog and snapshot checks pass.
- Both reviews and the security hunt are complete for every package, with confirmed findings fixed.
- Accessibility checks (WCAG 2.2 AA, NFR-ACC) pass on the notification centre and the preference screens.
