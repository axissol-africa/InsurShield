# Roadmap: every remaining MVP feature, in batches

Status: approved by the user on 2026-10-28 after review round 10, with section 0's coordinator choices, the section 5
amendments and the batch 2 plan change. Each batch gets its own plan
(`batch-<n>-<name>.md`, made with the plan-a-batch procedure) when it is next. This file fixes the order, the scope of
each batch and what each depends on.

## 0. Decisions (user, 2026-10-27)

Earlier decisions stand: Better Auth replaces Keycloak (2026-10-24), the batch 2 plan's 17 answers and its 8 product
decisions (2026-10-25). Added on 2026-10-27:

| # | Area | Decision |
| --- | --- | --- |
| 1 | Reviews, ratings, badges | Full spec at launch (BR-013, BR-014). Methodology questions are asked when batch 17 is planned. |
| 2 | Sponsored placements | Deferred past the MVP. |
| 3 | Claims | First notice plus insurer updates. Server checks policy, cover and reporting window; the insurer acknowledges with its reference and posts status updates the customer sees; no customer–insurer messaging; settlement stays in the insurer's system. |
| 4 | Outside providers | Adapters with local stand-ins now; production refuses to start on a stand-in. |
| 5 | Pricing | The insurer types the premium; InsurShield shows an estimate from approved rates and enforces the regulatory floor. |
| 6 | Products | Versioned products: several per insurer, drafts, effective dates, history, admin approval. |
| 7 | Roles | Full set now: insurer admin, quote officer, claims/NCD officer, support, finance, compliance read-only, beside super admin and admin. |
| 8 | Audit trail | Early batch covering every state, staff, configuration and money change; append-only; admin read-only view. |
| 9 | Choosing insurers | Insurers publish their products. The customer sees every product that covers them, each with an estimated price from approved rates, and sends one quote request to 1–5 products; each chosen insurer confirms or adjusts the price. The broadcast to every insurer (DEC-016 in code) is superseded. Instant confirmation per product comes after launch. (Revised by the user the same day: "each insurance adds or creates what ever cover types they provide … then someone looks at them and selects which ones he/she send a request for a quote".) |
| 10 | Staff MFA | Email code. |
| 11 | Customer phone OTP | None; email verification only. |
| 12 | Guest tracking links | Dropped; support triggers an audited password reset. |
| 13 | Complaints | External help desk; InsurShield gives a contact entry point and record references. |
| 14 | Inspections | The insurer moves them in the portal; the customer uploads photos. |
| 15 | Two-person approval | PIA floor; insurer activation, deactivation, deletion, restore; money adjustments. Not role grants. |
| 16 | Notifications | In-app centre plus email. |
| 17 | Cover periods | 3, 6, 9, 12 months; start from today up to 60 days ahead; the server computes the end. |
| 18 | Quote drafts | On the server for signed-in customers, kept 30 days. |
| 19 | Rule values insurers have not supplied | Admin-maintained, versioned, audited settings with provisional defaults; release blocked while any is provisional. |
| 20 | Service-worker cache defect | Fixed inside batch 2, package W (batch 2 plan amendment below). |
| 21 | Road tax | Deferred past the MVP (BR-009, FR-VEH-006); payment covers the premium plus approved taxes and fees, without road tax. |
| 22 | Two products of one insurer | Allowed in one request: that insurer gets one delivery listing its chosen products and returns one quote per product version; payment names the quote it pays. |
| 23 | Journey order | Common questions, then the product list with estimates, then the choice of 1–5, then only the chosen products' extra questions, then submit. |
| 24 | After submit | A product the insurer replaces or withdraws keeps the quotes it already gave valid until they expire, and its unanswered requests are still answered on the chosen version. An insurer InsurShield suspends has its unanswered requests cancelled and its unpaid quotes made unpayable. The customer is told; their other products continue. |

Coordinator choices, for the user to confirm with the roadmap:
- Policy service requests (FR-POL-003, US-CUS-021) stay inside InsurShield, routed to the insurer, because the
  insurer's decision must be recorded before a policy changes; like claims (decision 3) they carry the insurer's
  updates, not two-way messages (amendment in 5.1). Decision 13's external help desk covers complaints, and claims
  against an insurer that has been deleted. (2026-10-27, r1 C8; r2 R-M6; r9 R-M1.)
Three coordinator choices are stated as outcomes; each batch plan designs the mechanism within them (section 6). The
user confirmed every coordinator choice in this section on 2026-10-28.
- **Servicing and deletion.** A suspended or expired insurer receives no new requests or renewals and cannot publish
  products, but keeps portal access to service its existing policies: claim updates, NCD decisions, service requests
  and inspections already under way. The portal is not made read-only. An insurer is deleted only when nothing is
  left to service and no payment to it is in flight; otherwise deletion is refused and deactivation is used. Left to
  service: a policy awaiting its certificate, or whose end date plus its claim reporting window has not passed (judged
  by the dates, not the status; until batch 16 builds the window, every issued policy counts); an open
  claim, NCD application, service request, or an open inspection (from batch 13, one that still serves a live
  version). The check runs when the deletion is carried out (after the second approval from batch 8) and cannot
  interleave with a payment to that insurer; from batch 7, payment also refuses a quote whose insurer is not active,
  licensed and with current compliance evidence. Batch 7 builds both over every record that exists then (policies,
  claims, NCD applications and inspections are all in the code today); later batches add what they create (14
  pending provider payments, 15 service requests, 16 the reporting window). A deleted insurer's users lose portal
  access. From batch 16, any claim against a deleted insurer is refused with the help-desk contact (FR-CLM-004 as
  amended); every other late claim follows the late-submission process. (2026-10-28, r2 C5; r5 R-L3; r6
  C-M1/R-M3; r7 C-M1, R-M1, R-M2, R-L1, R-L2; r8 R-M1, R-L3, R-L4; r9 R-M1.)
- **Decision 24's "suspends"** covers InsurShield's actions on an insurer: deactivation, deletion, and an approval
  withdrawn (FR-ADM-007). Its cancellations and unpayable quotes are recorded at the moment of the action, from
  batch 7 (which builds the actions) on the recipient row and the quote, and from batch 12 also on the request's
  chosen-version row, so restoring or re-activating the insurer later does not revive them. From batch 7 a reply on a
  marked recipient row, an extension of a marked quote and a payment of one are refused, with their tests there. A licence or
  required compliance evidence passing its expiry date is not such an action: while it is expired the insurer takes
  no new business, cannot reply or extend and its quotes cannot be paid (steps 7 and 10), the customer sees that the
  insurer cannot respond for now, and on renewal its unexpired quotes and unanswered versions continue. An admin who
  expects no renewal deactivates the insurer, which cancels under decision 24. (2026-10-28, r4 R-M4; r5 R-M2, R-L2;
  r6 R-M2, R-L1, R-L2; r7 R-L3, R-L4; r9 R-L3.)
- **Inspections.** Every chosen version whose rule needs an inspection can get one that meets its method and stage,
  so none is left without a way forward. One inspection may serve several versions of its insurer only where it
  meets each one's rule (a physical inspection meets a self-capture rule, not the reverse; one before quote also
  meets a before-payment rule; neither meets an after-payment rule, which batch 16 inspects on its own). A version
  has at most one open inspection per stage, and every result is kept. A pass is final and satisfies the versions it
  serves; a fail declines only those, unless a version's rule allows reinspection (BR-007). A reinspection, a
  cancelled or no-show inspection, or the insurer's request when the evidence is unusable (US-VEN-010) opens a new
  inspection for the versions still unmet. (2026-10-28, r4 R-M2; r5 R-M1; r6 R-M1; r7 R-M3; r8 R-M2; r9 R-L2.)

## 1. What exists today (verified how)

Three read-only analysts read the code at `aaec0ea` against every backlog item; their reports, with `file:line` for
each claim, are in the session scratch folder (`reports/gap-cust.md`, `gap-ops.md`, `gap-platform.md`). Both
round-1 reviewers re-checked the claims against the code and confirmed every defect they sampled (Codex 12, the
reviewer agent 11), the four unused tables, the stand-ins and the hard-coded values below.

| Area | Done | Partial | Mock-only | Missing |
| --- | --- | --- | --- | --- |
| Customer US-CUS-001…026 | 0 | 18 | 1 | 7 |
| Insurer US-VEN-001…014 and admin US-ADM-001…016 | 0 | 11 | 1 | 18 |
| Platform EN-001…011 | 0 | 8 | 1 | 2 |

What works end to end on the real API: quote request, insurer response, a simulated payment, policy with certificate
pending, first claim notice, NCD application and decision, insurer and PIA administration. Missing across the board:
an audit writer (`audit_logs` has none), notifications, a job runner, products and rules, the extended workflow
states, real provider integrations, reviews (browser-only), sponsored content (nothing). `idempotency_records`,
`integration_deliveries` and `insurer_integrations` exist in `schema.ts` with no code using them.

Stand-ins today: the RTSA registry answers a fixed vehicle (`vehicles.service.ts` `lookupFromRegistry`); payments are
confirmed instantly (`payments.service.ts`); insurers act only in the portal; `INSURER_RATES`
(`web/src/domain/insurers.js`), usage loadings, the RTSA fee and the 4% floor default (`pia.dto.ts`) are hard-coded;
a browser-only quote request is created when the API is down in non-production builds (`submitRequest.js`).

## 2. The batches

Every batch ends at its own stop point: both reviews and the security hunt for every package, confirmed findings
fixed, the whole verification green with numbers, accessibility checks (WCAG 2.2 AA, NFR-ACC) for every screen it
adds or changes, and the user's approval of its commits. The next batch starts only then. (Accessibility per batch:
2026-10-27, r1 R-L9.)

| Batch | Name | Backlog items | Depends on | Outside parties | Size |
| --- | --- | --- | --- | --- | --- |
| 2 | Better Auth (in progress, at W2a) | EN-001 and EN-009 (identity part), US-CUS-002 (sign-in and registration), the 8 product decisions, decision 20 | — | none | XL |
| 3 | Real-API repair and shared guards | the defects in section 3, the floor check, the shared rate limiter and idempotency, CI, EN-008 (test lanes), spec and story amendments | 2 | none | L |
| 4 | Audit trail and state history | EN-002, the audit view of US-ADM-013 | 3 | none | L |
| 5 | Documents and the provider gate | EN-003 | 4 | malware scanner (stand-in) | M |
| 6 | Jobs, email, notifications and verified accounts | EN-005, US-CUS-019, US-CUS-002 (remainder), US-CUS-003/004 (consent and contact preferences) | 4, 5 | email provider (stand-in) | L |
| 7 | Roles, staff and insurer onboarding | EN-001 (roles and tenancy), US-VEN-001/002, US-ADM-001/002/003 | 4, 6 | none | L |
| 8 | Staff security and two-person approval | staff MFA, lockout and sessions (NFR-SEC-002), US-ADM-010, FR-ADM-003 | 6, 7 | none | M |
| 9 | Versioned products and approval | US-VEN-003, US-ADM-004, cover guide on the API | 7 | launch insurers' product data | XL |
| 10 | Rule settings, taxonomy and estimates | US-VEN-004, US-ADM-005/006, decision 19 settings, the per-product estimate | 9 | insurers' rule values (provisional until supplied) | L |
| 11 | Integration platform | EN-004, US-VEN-011, US-ADM-007/008, RTSA and insurer-API adapters, secret key management | 6, 7 | RTSA, insurer APIs (stand-ins) | XL |
| 12 | Product choice and the request model | US-CUS-001, 005–012, the declarations of US-CUS-003, US-CUS-013 (submit), US-CUS-020 (renewal recipients) | 10, 11 | none | XL |
| 13 | Quote workflow, insurer queues and inspections before payment | US-CUS-013 (tracking), 014, 015, US-CUS-024 and US-VEN-010 (inspections before quote and before payment), US-VEN-005/006 | 12 | none | L |
| 14 | Payments, issuance and reconciliation | US-CUS-016/017, US-VEN-007 (issuance), US-ADM-009, money adjustments | 13, 8, 11 | payment provider (stand-in) | XL |
| 15 | Accounts, portfolio, renewal and service requests | US-CUS-018, US-CUS-020 (renewal journey), US-CUS-021, US-VEN-007 (renewals), EN-009 (data lifecycle), US-ADM-012 (entry point) | 14 | retention values (DEC-011, provisional) | L |
| 16 | Claims, NCD and later inspections | US-CUS-022/023, US-VEN-008/009, US-CUS-024 and US-VEN-010 (inspections after payment and for claims) | 14, 6 | insurers' NCD and claim rules (provisional) | L |
| 17 | Verified reviews and insurer profiles | US-CUS-025, US-VEN-013, US-ADM-015 (moderation) | 14, 16 | compliance approval of BR-013 | XL |
| 18 | Ratings and performance badges | EN-010 (calculation), US-CUS-026 (badges), US-ADM-015 (badge governance) | 17 | compliance approval of BR-014 | L |
| 19 | Reporting, content and compliance | US-ADM-011, US-ADM-013 (privacy and retention review), US-ADM-014, US-VEN-012 | 15, 16, 18 | regulator reporting needs | L |
| 20 | Production readiness and release gate | EN-006, EN-007, EN-008 (remaining kinds), encryption at rest, breach response, real adapters, the US-CUS-001 re-check, the section 12 release gate | 19 | hosting, RPO/RTO, providers, client UAT | L |

Why this order:
- Batch 3 makes every existing screen honest on the real API and defines the guards later batches reuse (rate
  limiter, idempotency, floor check), so none is defined twice.
- Audit (4) comes before every batch that adds a staff or money action, so no module is revisited to add it.
- Document security (5) comes before the batches that add documents (12, 13, 14, 16), and defines the provider gate of
  decision 4 with its first adapter. (2026-10-27, r1 R-M4, R-L8.)
- Jobs and email (6) come before staff MFA (8, email code), the support reset (8), quote deadlines (13), renewals
  (15) and claim updates (16).
- Roles and onboarding (7) come before products (9): insurer admins submit products, admins approve them, and only a
  verified insurer may publish.
- The integration platform (11) comes before the request model (12), which sends each request to its chosen
  insurers through it, and before payments (14), which reuse its callbacks and retries. (2026-10-27, r1 R-M5.)
- Products and rules (9, 10) come before product choice (12), which shows the products, their estimates, the
  questions and the add-ons they define.
- The request model and its screens land together in 12, so no build ever sends a request without its chosen
  products and no insurer is left unable to answer two of them; the insurer-side workflow (13) then adds the full
  states and queues, with the inspection model beside the "Inspection Required" state that needs it, and batch 16
  reuses that model for claims. (2026-10-28, r2 R-M1, R-M5; r3.)
- A paid, issued policy (14) comes before renewals (15), claims (16) and verified reviews (17).
- Reviews (17) come before badges (18), which are calculated partly from them.

## 3. What each batch contains

### Batch 2: Better Auth (in progress)
As `batch-2-better-auth.md`, plus decision 20. Package W gains `apps/web/public/sw.js` (an amendment to the batch 2
plan's file list, reviewed before W2b starts): the worker caches only the app shell and fonts, never API paths;
page loads go network-first with the cache as the offline fallback, so a new deploy is never masked by a stale page;
the next worker version deletes old caches on activate. Tests run on a production build (the worker registers only
there): a signed-in API read is never answered from the cache; after sign-out no customer response is left in Cache
Storage; a deploy with new build files loads without a reload loop. (2026-10-27, r1 R-M6.)

### Batch 3: Real-API repair and shared guards
Every defect gets a failing test first.
- The server refuses an insurer premium below the PIA floor for the request's declared value, with a reason; batch 10
  later reads the floor from its versioned setting. (2026-10-27, r1 R-H1.)
- Admin overview, revenue, recent policies and Find customer read the `/admin/*` routes, not the browser store.
- The insurer portal loads its own profile (`GET /insurer/profile`); the cover-guide save stops sending `coverGuides`
  to `PATCH /insurers/:id` (until batch 9 moves the guide to the product).
- Policy dates are computed by the server (decision 17); the confirmation page shows the server's policy number.
- "Get fresh quotes" calls the requote endpoint, and the replacement request carries the original dates (recomputed
  by the server) and its inspection photos and documents, so nothing reaches payment without them. (2026-10-27, r1 C4.)
- The White Book upload uses the right document kind and is attached to the request.
- One idempotency mechanism, keyed by the caller and the endpoint, with the request body's hash checked so a reused
  key with a different body is refused; applied to quote-request and claim submits; the web keeps one key per attempt
  across retries. Payments keep their existing key until batch 14 moves them onto it. `idempotency_records` today has
  `key` as its only primary key, so batch 3 names the migration that keys it by caller and endpoint, and the job that
  purges expired rows (a scheduled purge once batch 6 has the job runner; until then, expired rows are ignored on
  read). (2026-10-27, r1 R-M3; 2026-10-28, r2 R-L4.)
- One shared rate limiter for the rest of the API, applied to the public routes (`/vehicles/lookup`,
  `/insurers/directory`, `/config/pia`, the NCD code check) and to quote, claim and upload submits. It uses batch 2's
  client-address rule (`TRUST_PROXY_HOPS`) and its on/off setting rather than a second definition, and its plan says
  whether it shares Better Auth's limit storage. (2026-10-27, r1 R-M2; 2026-10-28, r2 R-M8.)
- The public NCD code check reveals only validity; an invalid NCD code on a quote request is refused with a reason.
  The quote form's NCD code field and its use in the estimate come in batch 12. (2026-10-27, r1 R-L1.)
- The NCD decision refuses going back to `SUBMITTED` and percentages above the automatic cap; `notifyCustomer` is
  removed until batch 6 sends notifications.
- `reconcileInsurers` stops adding demo insurers in HTTP mode; uploads are checked by their content, not the declared
  type; insurer website and logo addresses are validated on update as they already are on create; an expired licence
  stops new requests (FR-ADM-007). (URL scope: 2026-10-27, r1 C10.)
- The browser-only reviews and ratings are hidden in the HTTP build until batch 17.
- The web's `support` role is removed until batch 7 defines it.
- Batch 2 leftovers: `"userId"` on customers and staff becomes NOT NULL once no row lacks it (a narrowing migration,
  code first). (2026-10-27, r1 R-L6.)
- Test lanes (EN-008, part): a CI pipeline running lint, type check, unit, build and the API e2e suite; a web
  Playwright lane against the real API beside the mock lane.
- Records: DEC-016 (superseded by decision 9) and DEC-019 written into the register; the spec and story amendments of
  section 5, once the user approves their wording.

### Batch 4: Audit trail and state history
One audit writer used by every service that changes data, called inside the same transaction as the change. `audit_logs`
is append-only, enforced in the database (no update or delete for the app's role). A shared state-transition helper
records actor, note and time for quotes, policies, claims, NCD and inspections. The PIA floor and other settings keep
their history instead of overwriting one row. An admin read-only audit view with filters. Migrations: the audit and
history tables and their grants (additive).

### Batch 5: Documents and the provider gate
Document security before any batch adds documents, building on batch 3's content check: a malware-scan adapter with
its stand-in, protected short-lived download links, and a retention class on every document kind. The retention
values are settings owned by batch 10; the deletion job runs in batch 15. The provider gate of decision 4, defined
once: each adapter registers itself, and a production start fails while any registered adapter is a stand-in.
(2026-10-28, r2 R-M4, R-L7.)

### Batch 6: Jobs, email, notifications and verified accounts
A database-backed job and outbox runner (one runner at a time, retries with backoff). The email adapter with a log
stand-in, absorbing batch 2's development mailer. Notification orchestration: versioned templates, consent and
contact preferences stored (marketing consent included), delivery receipts, retry. The in-app notification centre.
Existing events wired: quote ready, payment, policy issued, claim received and updated, NCD decided, inspection
updated. The scheduled purge of expired idempotency records (batch 3). The rest of US-CUS-002 (2026-10-27, r1 C2/R-H3): password reset and email verification switched on in
production on the email adapter; protected records and sensitive actions wait for a verified email (amended
FR-CUS-003); registration answers the same whether or not an email is taken, and abandoned registrations release
their email (batch 2 question 15).

### Batch 7: Roles, staff and insurer onboarding
The full role set as one permission matrix, enforced on the server, with insurer tenancy. Insurer admins manage their
own insurer's users and teams; InsurShield admins govern all staff. Insurer onboarding and verification (US-ADM-002,
2026-10-27, r1 C1/R-H2): organisation, licence and compliance evidence, contacts, agreements, technical model; no
activation while evidence is incomplete, expired or unapproved (a later expiry follows section 0); activation records
effective and renewal dates, approver and conditions; a suspended or expired insurer follows the servicing rule in
section 0 (no new requests, renewals or publication; existing policies still serviced in the portal), which answers
batch 2's question 8. Deletion is refused while the insurer has anything to service or a payment in flight, and
payment refuses a quote of an insurer that may not take new business (section 0); insurers that exist before
batch 7 get their licence and evidence records first (the seed and the rows already in a database), so the check
does not refuse them all. Deactivation, deletion and approval withdrawal record decision 24's marks on the recipient
row and the quote, the reply, extension and payment checks refuse marked ones, and the customer is notified (section
0). (2026-10-28, r2 C5; r6 C-M1/R-M3; r7; r8 R-M1, R-L6; r10 R-L1, C-L1.)

### Batch 8: Staff security and two-person approval
Staff email-code MFA (decision 10), lockout and session limits (NFR-SEC-002). Support triggers an audited customer
password reset (decision 12, US-ADM-010). The two-person approval mechanism (FR-ADM-003), applied to the PIA floor and
to the insurer activation, deactivation, deletion and restore actions batch 7 built (batch 8 re-routes those actions
through it); money adjustments use it in batch 14, and batch 10 keeps it on the floor when the floor becomes a
versioned setting. (2026-10-28, r2 R-L8.)

### Batch 9: Versioned products and approval
Products per insurer and cover type with drafts, versions, effective dates and history. Only a verified, active
insurer submits; admins approve and publish; customers only ever see an approved version, and each quote records the
version it was made on (the column arrives with batch 12, step 7). The per-insurer inspection rule moves onto the
product version (quote-flow step 1). The cover guide moves to the product and the API. (r4 R-L7.)

### Batch 10: Rule settings, taxonomy and estimates
Admin-maintained settings (decision 19): quote reply deadline, NCD tiers and validity, driver and risk questions,
add-ons, durations per product within 3/6/9/12, retention periods; each versioned, audited, marked provisional until
confirmed. The PIA floor becomes one of these settings and keeps batch 8's two-person approval. Retention values per
document class (batch 5). The comparison taxonomy and mappings. The estimate per product, computed from the
product's approved rates and never below the floor, replacing the hard-coded `INSURER_RATES` and loadings; each
product says whether an estimate may be shown (FR-ELG-003 "where allowed"), and the estimate route is behind the
shared rate limiter. (2026-10-28, r2 R-L8, R-L10.)

### Batch 11: Integration platform
Idempotent delivery and callback processing built on the batch 3 idempotency mechanism: outbound deliveries, signed
callbacks, retries, an exception queue with manual fallback. Migration: `integration_deliveries` widened beyond
insurer deliveries (nullable or generalised `insurerId`, more delivery kinds) so payments can use it (additive;
2026-10-27, r1 R-M3). Key management for stored integration secrets (`insurer_integrations."clientSecretEncrypted"`;
r1 R-M9). The RTSA vehicle adapter, whose stand-in becomes manual entry instead of a fixed vehicle, behind the shared
rate limiter. The insurer-API adapter with a stand-in (the portal stays the standard path). Integration and
operational monitoring screens for insurers and admins.

### The quote flow under decisions 9, 22, 23 and 24 (design, 2026-10-28, r2 and r3)
One flow from a published product to a paid policy. Each step names the batch that builds it. Batch 12 builds the
whole minimum of steps 2–7, 9 and 10 that two products of one insurer need; batch 13 adds the richer workflow.

1. **Published products** (9, 10). An insurer that is verified, active and licensed (7) has approved product versions,
   each with its rates, its common and extra questions, its add-ons, durations within 3/6/9/12, whether an estimate
   may be shown, and its inspection rule: method and blocking stage (before quote, before payment, after payment, or
   none; FR-INS-001). Batch 9 moves today's per-insurer `inspectionRule`, `inspectionTiming` and `inspectionMethod`
   onto the product version and maps them to those stages. A rule is shown to the customer from batch 12 but enforced
   only from batch 13 (before quote, before payment) and batch 16 (after payment), as today, when nothing enforces
   it. (2026-10-28, r4 C-H1/R-M1.)
2. **Common questions** (12). Cover, vehicle (RTSA adapter or manual entry, 11), declared value, use, drivers, NCD
   code, cover start (today to 60 days ahead) and duration. Every estimate is computed from these answers only.
3. **Product list** (12). Every current approved version whose eligibility rules accept the answers, from insurers
   that may take new business, each with its estimate (where allowed), benefits, excess, add-ons, conditions and
   inspection rule. The list and the estimate route are behind the shared rate limiter.
4. **Choice** (12). The customer picks 1–5 distinct product versions; two may belong to one insurer (decision 22).
5. **Extra questions and documents** (12). Only the questions and documents the chosen versions ask for, deduplicated
   where two versions ask the same thing; declarations (FR-ELG-004). A missing mandatory document names the product
   it belongs to; the customer uploads it or removes that product. Changing a common answer re-runs the list and the
   estimates, removes any pick that no longer qualifies with the reason, re-evaluates the extra questions and
   documents, and asks the customer to confirm the updated choice. The server draft (decision 18) holds steps 2–5; a
   resumed draft is re-checked the same way. (r3 C5, R-L2.)
6. **Submit** (12). The server re-checks everything the browser sent: 1–5 distinct versions, each still current,
   approved and eligible for the answers, each insurer still taking new business, every required answer and document
   present. It stores one request with its chosen versions (a new link table), builds one recipient per distinct
   insurer, and sends one idempotent delivery per insurer through batch 11, listing that insurer's chosen versions
   (FR-QTE-006 as amended).
7. **Insurer reply per version** (12 minimum, 13 workflow). In batch 12 the portal shows each chosen version and the
   insurer quotes or declines each one; "has a quote" and "extend a quote" work per version; the floor check of batch
   3 applies to each quote, and only an insurer that may take new business now (section 0) can reply or extend.
   `insurer_quotes` gains the product version, and its uniqueness moves from (request, insurer) to (request, product
   version), an additive migration; a reply on a request with chosen versions must
   name one of them, a reply or an extension without a version (an old portal tab) is refused with the reload
   message, and (request, insurer) stays unique for quotes without a version, so a legacy request still gets one
   quote per insurer. The batch 12 plan also decides the existing uniqueness on (request, insurer reference). Batch
   13 adds the other replies: more information, return, and inspection required. (r3 C1/R-H1; r4 R-M3; r5 R-L4; r6
   R-M2.)
8. **Inspection** (13 before quote and before payment; 16 after payment and for claims). The product's inspection rule
   says when an inspection blocks. Batch 13 builds one inspection model the insurer schedules and decides in the
   portal, with the customer's photos (decision 14), serving the chosen versions whose method and stage it meets
   (section 0):
   before quote, a pass lets the insurer quote the versions that need it and a fail declines them; before payment,
   batch 13 adds the gate to the payment path that exists then, and payment of a quote waits for a pass only when
   that quote's own version requires it. Batch 16 reuses the model for inspections after payment and for claim
   assessment, with pre-loss and post-loss evidence kept apart. (r3 C4/R-M1; r4 C-H1, R-M1, R-M2; r5 R-M1; r6 R-M1.)
9. **Comparison and choice of a quote** (12 minimum, 13 full). From batch 12 the customer's view lists each quote by
   its id with its product version, so two quotes of one insurer never overwrite each other; batch 13 adds the full
   side-by-side comparison while others are pending. The customer picks one quote by its id.
10. **Payment** (12 lookup, 13 inspection gate, 14 provider). From batch 12, payment names the quote id in the web and
    the API (`payments.service.ts` today finds the quote by insurer). At payment the server re-checks FR-CMP-003: the
    quote is unexpired, not withdrawn, declined or superseded, not made unpayable under decision 24 (so a quote of a
    restored insurer stays unpayable, with its own test), and its insurer may take new business now (active,
    licensed and with current compliance evidence, section 0). The mark and status checks run from batch 7, with
    their tests there. A quote is "withdrawn" or "superseded" only by the insurer's action on that quote; a product
    being replaced or withdrawn does not make its quotes superseded (decision 24). Batch 13 adds the inspection gate
    of step 8; batch 14 adds the provider. (r4 R-M1, R-L8; r5 R-L1; r9 R-L3.)
11. **Changes after submit** (12 rules, 13 states). Decision 24: when an insurer replaces or withdraws a product, its
    given quotes stay valid until expiry and its unanswered versions are still answered on the chosen version; when
    InsurShield suspends an insurer, its unanswered versions are cancelled, its unpaid quotes become unpayable, and the
    customer is notified through batch 6's notification service from batch 7 (which builds the actions); batch 12
    shows the cancelled version as "cancelled" until batch 13 adds the full state; the other versions continue. The reply and payment checks enforce
    it, and the cancellation is recorded so a later restore does not revive it. A provider payment already pending
    when the mark is made is settled by the batch 14 plan (completed or refunded, never left open). (r3 C3/R-M2; r4
    R-M4, R-L1; r6 R-L4.)
12. **Requote and renewal** (12). Today both send to every active insurer (`quote-requests.service.ts` requote,
    `policies.service.ts` renewal). From batch 12 both use one rule: each chosen product moves to its current version
    when that version is approved and eligible; a product that no longer qualifies is dropped with its reason and the
    others are kept, as in step 5; when none is left, the customer returns to the product list with the answers kept.
    A pick whose current version asks extra questions or documents not yet given goes through steps 5 and 6 again, and
    the customer confirms before the request is sent. The answers, documents and inspection photos carry over to the
    new request, as batch 3 does for requotes. A renewal finds its product through the policy's quote
    (`insurerQuoteId` → quote → version), which cannot be deleted while its payment exists
    (`payments_insurerQuoteId_fkey` is `restrict`); a policy issued before batch 12 has no version and goes to the
    list. A request made before batch 12 has no chosen versions, so its requote goes to
    the list. Neither ever widens the recipients to all insurers. (r3 C2-closure, R-M3, R-L8; r4 R-L2, R-L3, R-L5; r5 R-L5, R-L6, R-L7.)

**Cutover at batch 12** (r3 C2/R-M4). The app is not in production, so batch 12 switches in one commit, with no
period in which both request shapes are accepted:
- An open tab running the old web gets a clear refusal on submit and on payment ("InsurShield has been updated;
  reload the page"), never a silent failure or a request without chosen versions.
- The new web against an old API fails closed (the API refuses unknown fields), so the API deploys first.
- The migration is additive, so the previous API keeps working on the migrated database until the new API accepts
  its first write: a request, a reply, a payment or a decision-24 cancellation. From then on rolling the API back is
  unsafe, even for a one-product request: the previous API knows nothing of chosen versions, so it would requote and
  renew to every insurer (`quote-requests.service.ts:113-132`) and could not show or pay per-version quotes. Recovery is then restoring the backup taken before the migration (the
  land-a-migration procedure), which loses every request, quote and payment made since; in development that is
  acceptable, and production has its own runbook (batch 20). (r4 C-M1, R-L4; r5 C-M1; r10 C-L2.)
- The batch 12 plan gives the old web's payment body (which names the insurer) its own refusal with the reload
  message, not the generic validation error. (r4 R-L9.)
- Requests and quotes made before the cutover keep working: their quotes have no version, are listed and paid by id,
  and their requote goes to the list.

### Batch 12: Product choice and the request model
Steps 2–7 (minimum reply), 9 (minimum view), 10 (quote-id payment and its FR-CMP-003 check), 11 (rules) and 12 above,
and the cutover. The common questions, the product list with estimates, the choice of 1–5, extra questions and
documents, declarations (the declarations part of US-CUS-003), the NCD code and its use in the estimate, server drafts
for 30 days (purged by the job runner), the submit checks (the submit criteria of US-CUS-013), the request-to-version
link and the `insurer_quotes` migration, deliveries per insurer, replies per version in the portal, the customer's
view by quote id, payment by quote id, requote and renewal recipients (the recipients part of US-CUS-020). Clear entry
points and journey introductions on every route (US-CUS-001), re-checked in batch 20. Tests include: a sixth version
refused; two versions of one insurer give one delivery, two portal replies and two quotes the customer sees apart;
paying the second quote of one insurer pays that quote; a version withdrawn between list and submit refused with a
reason; a changed common answer drops a pick that no longer qualifies; an insurer suspended after submit cannot be
paid, and stays unpayable after a restore (for a legacy request too, through its recipient row); a marked quote cannot be extended; an expired licence or compliance evidence blocks reply
and payment until renewed, and the customer sees that the insurer cannot respond for now; a requote after a withdrawal returns to the list; an old-web submit refused with the reload
message. (2026-10-27, r1 C5/R-H2, R-L2; 2026-10-28, r2, r3, r6 R-L5.)

### Batch 13: Quote workflow, insurer queues and inspections before payment
Steps 7–9 beyond batch 12's minimum. The quote-side states of requirements section 8.1 (Draft, Submitted, Insurer
Processing, Partially Ready, Quotes Ready, Quote Selected) and its exception states Verification Required, Inspection
Required, Declined, Timed Out, Expired, Cancelled and Manual Review, per chosen version, with decision 24's
cancellations; the insurer actions of US-VEN-006 (request more information, decline, return). Insurer queues with
deadline warnings and breach notices (US-VEN-005). The inspection model and inspections before quote and before
payment (US-CUS-024, US-VEN-010, first part). The customer's tracking view per version (the tracking part of
US-CUS-013), comparison (US-CUS-014), and each quote's add-ons, conditions and recommendation basis (US-CUS-015).
The inspection gate on payment for "before payment" products (step 8). Payment and issuance states belong to batch 14.
(2026-10-27, r1 C9, R-M7; 2026-10-28, r2 R-M5, r3, r4.)

### Batch 14: Payments, issuance and reconciliation
The payment adapter and its stand-in with pending, confirmed, failed and reversed outcomes arriving by callback,
using batch 11's deliveries and batch 3's idempotency (FR-PAY-003); payment names the quote id and re-checks
FR-CMP-003, as batch 12 built, and keeps batch 13's inspection gate; a pending provider payment joins the insurer
deletion check (section 0). The payment and issuance states of section 8.1. (r7 R-M2.)
Policy issuance by the insurer and the policy documents. Reconciliation of payments, policies and settlements;
refunds and manual adjustments under two-person approval. Payable amount: premium plus approved taxes and fees, no
road tax (decision 21).

### Batch 15: Accounts, portfolio, renewal and service requests
The customer's portfolio. Renewal: eligibility window, reminders by the job runner, repricing by the insurer,
changed risk details; recipients as in step 12 of the quote flow (built in batch 12). Policy service requests inside InsurShield
(coordinator choice in section 0): a reference, the reason and evidence, routing to the insurer, status, the
insurer's updates, and no policy change before the insurer's recorded decision. A contact-support entry point that
hands over to the external help desk with record references (decision 13). Data lifecycle: export, account closure,
and the deletion job applying batch 5's retention classes with batch 10's values. (2026-10-28, r2 R-M4, R-M6.)

### Batch 16: Claims, NCD and later inspections
Claims (decision 3): first notice with server checks of policy, cover and reporting window (late reason captured;
the window kept in batch 10's settings, which the insurer deletion check then uses; any claim against a deleted insurer
refused with the help-desk contact, FR-CLM-004 as amended),
the insurer's reference and status updates, the customer uploading the evidence an "additional information
required" update asks for, notifications. NCD: tiers and validity from settings, binding to vehicle and policy,
application and decision. Inspections after payment and for claim assessment on batch 13's inspection model, with
pre-loss and post-loss evidence kept immutable and apart (US-CUS-024, US-VEN-010, second part). (2026-10-28, r2 R-M5,
R-M7; r3 C4/R-M1.)

### Batch 17: Verified reviews and insurer profiles
Before planning: the BR-013 methodology questions (who may review and when, scale, one-review rule, edits and
withdrawals, prohibited content, appeals, retention). Then reviews from customers with an eligible policy,
moderation, insurer public profiles and responses, appeals.

### Batch 18: Ratings and performance badges
Before planning: the BR-014 questions (metrics, data sources, thresholds, minimum sample, period, suspension). Then
rating calculation with its disclosed method, badge award, expiry and recalculation by the job runner, and their
display. The sponsored part of US-CUS-026 is deferred with decision 2.

### Batch 19: Reporting, content and compliance
Customer content and notification templates for admins (US-ADM-011); privacy and retention review over the audit
trail (US-ADM-013); reports and the manual risk review (US-ADM-014); insurer performance and finance reports
(US-VEN-012).

### Batch 20: Production readiness and release gate
Logs, metrics, traces, correlation ids, alerts, backup and recovery against the agreed RPO and RTO (EN-006).
Accessibility audit, performance, low-bandwidth and browser-compatibility testing (EN-007, EN-008 remaining kinds).
Encryption at rest and the breach-response procedure (NFR-SEC-004, NFR-PRI-001; r1 R-M9). The real adapter for each
contracted provider. The US-CUS-001 re-check of entry points and introductions across every journey (r2 R-L3). The
release gate, which checks every item of requirements section 12 as amended (r1 C3,
R-L10): all Must acceptance tests passed; rule matrices approved and automated; no stand-in and no provisional
setting; legal and content approvals by their accountable owners; no unresolved critical or high defect without a
documented acceptance; client UAT sign-off and go-live approval. Each item names its owner and its evidence. The
staging and production runbooks.

### After the MVP
Sponsored placements (EN-011, US-VEN-014, US-ADM-016, the sponsored part of US-CUS-026); road tax (BR-009,
FR-VEH-006); instant confirmation per product; phone OTP; in-app support tickets and complaint workflow; native apps.

## 4. Dependants across batches

| Shared thing | Introduced in | Used by |
| --- | --- | --- |
| Session, roles and tenancy checks | 2, 7 | every later batch |
| Client-address rule and Better Auth limits | 2 | 3 (shared limiter reuses them) |
| Shared rate limiter, idempotency, floor check | 3 | 6 (idempotency purge), 10 (estimate never below the floor; estimate route limited), 11, 12 (floor on each per-version quote), 13, 14, 15 (insurer repricing at renewal), 16 |
| Audit writer and state-transition helper | 4 | 5–19 |
| Document security and retention classes | 5 | 10 (retention values), 12 (request documents), 13 (inspection photos and reports), 14 (policy documents), 15 (deletion job, data lifecycle), 16 (claim evidence), 19 |
| Provider gate | 5 | 6, 11, 14, 20 |
| Job runner and outbox | 6 | 6 (idempotency purge for batch 3's records), 8 (MFA codes), 11 (retries), 12 (draft purge), 13 (deadlines), 14, 15 (renewal reminders, deletion), 16, 18 (badge expiry and recalculation) |
| Email adapter and notification service | 6 | 7 (decision 24 notices), 8, 12 (per-version cancelled display), 13, 14, 15, 16, 17 |
| Insurer status, the new-business rule, decision-24 marks (recipient row, quote), the payment refusal and the deletion check | 7 | 8 (two-person approval re-routes its actions), 12 (list, submit and reply checks; decision 24 marks on chosen versions), 13 (cancellations; inspections serving a live version), 14 (pending provider payments in the deletion check), 15 (renewals; service requests in the deletion check), 16 (servicing continues; reporting window in the deletion check) |
| Two-person approval | 8 | 8 (floor, insurer status), 10 (floor as a versioned setting keeps it), 14 (money adjustments) |
| Product versions | 9 | 10, 12 (chosen versions; a policy's product derived through its quote), 13, 15 (renewal), 17 |
| Rule settings | 10 | 12, 13, 15, 16, 20 (release gate) |
| Integration deliveries and callbacks | 11 | 12 (one delivery per insurer), 13, 14, 20 |
| Request-to-version link, per-version quotes, payment by quote id and decision-24 marks on chosen versions | 12 | 13 (full replies and states per version), 14 (provider payment), 15 (renewal), 19 (reports) |
| Inspection model and blocking stages | 13 (model, before quote, payment gate) | 14 (provider payment keeps the gate), 16 (after payment and claims) |
| Paid, issued policy | 14 | 15, 16, 17 |

(Rows added or changed: 2026-10-27, r1 R-L7, R-M2, R-M4; 2026-10-28, r2 R-M4, R-M8, R-L8, the quote-flow design, and r3 R-L3, R-L4, R-M1, R-M2, R-M3.)

## 5. Spec, story and plan changes needing the user's approval

Present text is quoted exactly from `docs/requirements-spec.md` and `docs/user-stories.md` at `aaec0ea` (spec v0.10).
Once approved, batch 3 applies them. Both reviewers confirmed the round-1 quotes; rows added in round 1 are marked.

### 5.1 Requirements

| Id | Present text | Proposed text |
| --- | --- | --- |
| FR-ELG-002 | "The customer shall be able to select one to five eligible insurers for a quote request." | "The customer shall be able to select one to five eligible insurer products for a quote request." (Acceptance criteria unchanged.) |
| FR-QTE-001 (r2) | "…vehicle, cover, usage, declared value, selected insurers, policy start date…" | "…vehicle, cover, usage, declared value, selected insurer products, policy start date…" |
| FR-TRK-001 (r3) | "The platform shall show per-insurer quote status and allow partial quote availability." | "The platform shall show the quote status of each selected product and allow partial quote availability." (Acceptance criteria unchanged.) |
| FR-QTE-006 (r2) | "The platform shall distribute one idempotent quote request to each selected insurer." | "The platform shall distribute one idempotent quote request to the insurer of each selected product, one per insurer, listing that insurer's selected products." (Acceptance criteria unchanged.) |
| FR-CUS-003 | "The platform shall verify the customer's phone or another approved identity factor before exposing protected records or completing sensitive actions." / "Issued OTP/token is time-limited, single-purpose, rate-limited, and validated by the server." | "The platform shall verify the customer's email address before exposing protected records or completing sensitive actions." / "Verification and reset tokens are time-limited, single-purpose, rate-limited, and validated by the server." |
| NFR-SEC-003 | "Customer OTPs/tokens shall be random, expiring, rate-limited, single-purpose, and resistant to enumeration." | "Customer verification and reset tokens shall be random, expiring, rate-limited, single-purpose, and resistant to enumeration." |
| FR-QTE-007 | "The customer shall receive a secure request reference and tracking link through an approved channel." / "Delivery status is recorded; failed delivery can be retried or recovered by authorised staff." | "The customer shall receive a request reference in their account and by email." / "Delivery status is recorded; failed delivery is retried." |
| FR-TRK-002 | "A customer shall recover a quote request using approved identifiers and OTP verification." / "Invalid identifiers or OTPs reveal no request data; expiry and attempt limits are enforced." | "A signed-in customer shall see every quote request they made; access is recovered by password reset." / "No other customer's request is shown; reset requests reveal no account data and are rate-limited." |
| FR-ADM-005 | "Authorised staff shall recover and resend customer tracking links after identity checks." / "Resend is rate-limited, records actor/reason/channel, and never exposes the token in logs." | "Authorised support staff shall send a customer a password-reset email after identity checks." / "Sending is rate-limited, records actor, reason and channel, and never exposes the token in logs." |
| FR-CLM-004 (r9) | "Claims outside the approved reporting window shall require the configured late-submission process." | "Claims outside the approved reporting window shall require the configured late-submission process; a claim against an insurer no longer on InsurShield is refused with the help-desk contact." / Acceptance criteria add: "A refused claim shows the help-desk contact and the record reference, and the entered data is not lost." (r10 R-L2.) |
| FR-CLM-006 | "Customer and authorised insurer operators shall exchange claim messages and documents." / "Messages record sender role, time, delivery status, and attachment controls." | "Authorised insurer operators shall record their claim reference and post status updates that the customer sees on the claim; the customer uploads the evidence an update asks for." / "Updates and uploads record author role and time, attachment controls apply, and the customer is notified of each update." (r2 R-M7.) |
| Section 8.2 (r1) | "`Submitted → Under Review → Additional Information Required → Approved → Settled`" | "`Submitted → Received by Insurer → Under Review → Additional Information Required → Approved or Declined → Closed`. Settlement happens in the insurer's system; InsurShield shows the insurer's updates." |
| Section 8.2, line after the model (r2) | "`Rejected`, `Withdrawn`, `Closed`, and dispute/appeal handling must be approved before implementation." | "`Withdrawn` and dispute/appeal handling must be approved before implementation; `Declined` replaces `Rejected`, and `Closed` is part of the model above." |
| FR-POL-003 (r2) | "Request is routed to the responsible insurer/operations queue with status, messages, and audit history; direct policy mutation is not permitted without insurer approval." | "Request is routed to the responsible insurer/operations queue with status, the insurer's updates, and audit history; direct policy mutation is not permitted without insurer approval." |
| FR-SUP-003 (r2) | "The platform shall support a customer-support ticket or managed-chat workflow if included in the signed MVP." | Unchanged text; marked "Not included in the MVP (DEC-012: external help desk)". |
| Section 10, claims bullet (r1) | "Claim, timeline, evidence, messages, and decisions." | "Claim, timeline, evidence, insurer updates, and decisions." |
| FR-ADM-012 | "Administrators shall review customer complaints and escalations and route them to the responsible vendor or internal owner." / "SLA, messages, internal notes, evidence, resolution, and closure reason are tracked." | "Customer complaints and escalations shall be handled in the approved external help desk; InsurShield shall give customers a contact entry point and staff the record references they need." / "Every customer-facing record has a reference support can search; support actions in InsurShield are audited." |
| Section 9, SMS/email row (r1) | "OTP, tracking, quote, payment, policy, claim, NCD, inspection, and renewal notices" | "Email verification, password reset, quote, payment, policy, claim, NCD, inspection, and renewal notices (email; SMS after the MVP)" |
| Section 9, identity row (r1) | "Secure sessions, MFA for staff, OTP/token controls for customers, role/tenant enforcement, and audit." | "Secure sessions, MFA for staff, verification and reset token controls for customers, role/tenant enforcement, and audit." |
| Section 2 (r1 wording) | "Full customer accounts, profiles, portfolios, verified ratings/reviews, insurer performance badges, and clearly disclosed sponsored content." | "Full customer accounts, profiles, portfolios, verified ratings/reviews, and insurer performance badges." |
| Sponsored rows (r1 extended) | FR-ADS-001/002, FR-IP-016, FR-ADM-019, BR-015, section 8.6, the section 10 sponsored-campaign bullet, release item 15 | Move to section 13 "Out of scope for MVP" as "Sponsored placements and paid promotion (deferred, DEC-015)". |
| NFR-TRU-001 (r1) | "Reviews, ratings, badges, and advertising shall implement abuse prevention, moderation, appeals, transparency, accessibility, and privacy-by-design controls." | "Reviews, ratings, and badges shall implement abuse prevention, moderation, appeals, transparency, accessibility, and privacy-by-design controls." |
| Road tax (r1, decision 21) | FR-PAY-002 "…plus approved taxes, fees, and optional road-tax amount."; FR-VEH-006; BR-009 "Road tax"; "road-tax" in FR-ADM-011, NFR-REL-003 and release item 3; RTSA row "…and optional road-tax services" | FR-PAY-002 "…plus approved taxes and fees."; FR-VEH-006 and BR-009 to section 13; remove "road-tax" from FR-ADM-011, NFR-REL-003 and release item 3; RTSA row "Vehicle/ownership/registration verification". (BR-009: r2 C4/R-M3.) |
| Section 3, support row | "Assist customers, recover tracking links, monitor operational queues" | "Assist customers, send password resets, monitor operational queues" |
| Section 15 register | Every row DEC-001 to DEC-015 has an empty outcome; DEC-016 and DEC-019 are cited in code but absent | Outcomes from section 0 where the user has decided: DEC-001 (responsive web; native apps after the MVP), DEC-003 (floor enforced by the server, formula still to approve), DEC-004/005 (5, 9, 17, 19, 22), DEC-006 (19, provisional), DEC-007 (4, 21), DEC-009 (11, 12, 18), DEC-010 (3, 14), DEC-012 (13), DEC-014 (1, methodology pending), DEC-015 (2). DEC-002 (launch insurers and products), DEC-008, DEC-011 and DEC-013 stay open: they need outside parties; decision 6 settles only the product model. Add DEC-016 "every request to all insurers" as superseded by decision 9, and DEC-019 "payment alone never issues a policy". (r1 R-L4; r2 R-L5.) |

FR-QTE-002 needs no change: its options "may include" 1–12 months, and decision 17 picks 3, 6, 9 and 12.

### 5.2 User stories (r1 C6, R-M1)

| Story | Present acceptance criterion | Proposed |
| --- | --- | --- |
| US-CUS-002 | "…then an expiring single-purpose OTP is sent through the approved channel." / "Given I enter the correct unexpired OTP within the allowed attempts, when I submit it, then a time-limited customer session is created." / "Given I enter an incorrect, expired, or reused OTP…" | "Given I register with my email, when I submit, then a single-purpose verification link is sent and protected records stay closed until I use it." / "Given I sign in with a verified email and correct password, then a time-limited session is created." / "Given a wrong password, an expired or reused link, or an unknown email, then access is denied without revealing whether an account exists." |
| US-CUS-008 (r2) | "…relevant to my selected insurers…" (statement) / "Given my cover, vehicle, usage, and selected insurers are known, when risk questions load…" | "…relevant to the products I choose…" / "Given I have answered the common questions and chosen my products, when the extra questions load, then only the questions those products require are displayed, each asked once." |
| US-CUS-009 | Title "View and select eligible insurers"; statement "…see and select eligible approved insurers…"; "Given insurer cards are shown…"; "Given I select insurers, when the count is between one and five, then I may continue."; "Given I attempt to select a sixth insurer…" | Title "View and select eligible insurer products"; "…see and select eligible approved insurer products…"; "Given product cards are shown…"; "Given I select products, when the count is between one and five, then I may continue."; "Given I attempt to select a sixth product…". (r2 C3/R-L1.) |
| US-CUS-008, 011, 012 (r3) | "…then the relevant insurer request cannot be submitted." (008); "…usage, and selected-insurer information is present." (011); "…then only the affected insurer or request is blocked according to the approved rule." (012) | "…then the request cannot be submitted until the products that need it are answered or removed."; "…usage, and selected-product information is present."; "…then the product that needs it is named, and I upload it or remove that product before submitting." |
| US-CUS-012, 013, 014 (r2) | "…required for my selected insurers…" (012 statement); "…submit one request to my selected insurers…" (013 statement); "…one idempotent request per selected insurer are created." (013); "Given some selected insurers are pending…" (014) | "…required for the products I chose…"; "…submit one request for the products I chose…"; "…one idempotent request per insurer of the chosen products are created."; "Given some chosen products are pending…" |
| US-CUS-013 | "…then I see the reference, current status, expected next step, and tracking method." | "…then I see the reference, current status and expected next step, and the request appears in my account." |
| US-CUS-022 | "…then I can view the timeline and exchange permitted messages/documents." | "…then I can view the timeline and the insurer's updates." |
| US-VEN-008 | "…evidence, timeline, messages, SLA, and current action are visible." / "Given I send internal notes or customer messages, when saved, then visibility rules prevent internal content from reaching the customer." | "…evidence, timeline, updates, SLA, and current action are visible." / "Given I add internal notes or customer-visible updates, when saved, then internal notes never reach the customer." |
| US-ADM-010 | "…then the matching request can be selected without displaying the existing secret token." / "Given resend is allowed, when I choose an approved channel, then a new/valid protected link is sent and delivery status is recorded." | "…then I can send the customer a password-reset email without seeing any token." / "Given sending is allowed, then the reset email is sent, rate-limited, and actor, reason and delivery status are recorded." |
| US-ADM-012 | The four criteria on complaint capture, escalation, internal notes and closure | Replaced by: "Given a customer contacts support, when the help desk ticket is raised, then it quotes the InsurShield record reference, and any support action in InsurShield is audited." |
| US-CUS-026 | Title "Understand performance badges and sponsored placement"; statement "…understand insurer performance badges and recognise sponsored content so that I can distinguish measured performance, paid visibility, and objective quote comparison."; "Given a listing, banner, or placement is paid…" and "Given sponsored content links to a profile/product…" | Title "Understand performance badges"; "…understand insurer performance badges so that I can distinguish measured performance from objective quote comparison."; the two sponsored criteria move to the deferred sponsored scope (decision 2). (r3 C6.) |
| US-VEN-014, US-ADM-016 (r3) | Both stories, Must | Marked "Deferred past the MVP (DEC-015)" with their text unchanged. |
| US-CUS-016, US-ADM-009 (r2) | "…add-ons, and optional road-tax amount equal the authoritative total." (016); "…reconcile payments, policies, road tax, fees/commission…" (009 statement) | "…and add-ons equal the authoritative total."; "…reconcile payments, policies, fees/commission…" (decision 21) |
| Titles and statements (r2 R-L9) | US-VEN-008 "Process claims and customer messages" / "…and communicate with the claimant…"; US-ADM-010 "Recover customer tracking access" / "…recover and resend a customer's tracking access…"; US-ADM-012 "Manage complaints and support escalations" / "…manage customer complaints and insurer escalations…" | "Process claims and post updates" / "…and post updates the claimant sees…"; "Help a customer regain access" / "…send a verified customer a password-reset email…"; "Link support to InsurShield records" / "…find the InsurShield records a help-desk ticket refers to…" |
| Delivery slices and decisions (r2 R-L9) | Section 8 slices naming sponsored work (lines 874, 882, 894–896) and "Administrator complaint" (902); section 11 item 7 "RTSA ownership and road-tax service scope." | Sponsored items and the complaint workflow struck from the slices and marked "after the MVP"; item 7 "RTSA ownership (road tax after the MVP)." The roadmap's batches replace the slices as the delivery order. |

### 5.3 Batch 2 plan (r1 R-M6)
Package W's file list gains `apps/web/public/sw.js` and the tests of section 3 "Batch 2"; the amendment is reviewed
before W2b starts.

### 5.4 Found while applying 5.1 and 5.2 (approved by the user, 2026-10-28)

| Location | Present text | Proposed |
| --- | --- | --- |
| DEC-005 outcome (requirements) | "As DEC-004." (written when applying the register row) | "Each chosen insurer confirms or adjusts the price of each chosen product within the quote reply deadline (an admin setting); quotes expire on the date the insurer sets; responses are shown as they arrive." |
| Section 4.13 heading (requirements) | "Ratings, reviews, badges, and sponsored disclosure" | "Ratings, reviews, and badges" |
| US-CUS-002 statement | "…verify my phone or another approved identity factor so that…" | "…verify my email address so that…" (decision 11) |
| US-CUS-026 references | "FR-BDG-001, FR-ADS-001, FR-ADS-002, BR-012, BR-014, BR-015" | "FR-BDG-001, BR-012, BR-014" |
| US-CUS-026 criteria | The two sponsored-label criteria ("Given a listing, banner, or placement is paid…", "Given sponsored content links…") | Deleted; they return with the sponsored scope (DEC-015). The criterion that sponsorship does not change quote values stays. |
| US-VEN-014 and US-ADM-016 references | "…FR-ADS-001, FR-ADS-002" and "…FR-ADS-001, FR-ADS-002, BR-015" | "FR-IP-016, DEC-015" and "FR-ADM-019, DEC-015" |
| Stories section 3 backlog summary | Must 12 and 15 for vendor and admin; total 52 Must, 4 Should | A Deferred column: vendor 11 / 2 / 1, admin 14 / 1 / 1, total 50 / 4 / 2 |
| EN-011 (stories section 7) | "…billing, and ranking-separation services." | "…billing, and ranking-separation services. Deferred past the MVP (DEC-015)." |

Kept as they are: FR-CMP-002 and BR-012 (sponsorship kept apart from objective ranking stays true while sponsorship
is deferred) and the RTSA row's "reconciliation for paid services".

### 5.5 Found by the review of the applied amendments (approved by the user, 2026-10-28)

| # | File and place | Present text | Proposed text |
| --- | --- | --- | --- |
| F1 | user-stories US-ADM-012 statement and references; US-CUS-021 references | "…so that issues have ownership, SLA, communication, and closure evidence." / "FR-ADM-012, FR-SUP-003" / "FR-POL-003, FR-SUP-001, FR-SUP-002, FR-SUP-003" | "…so that support can find and act on the right record, and every support action in InsurShield is audited." / "FR-ADM-012" / "FR-POL-003, FR-SUP-001, FR-SUP-002" |
| F2 | user-stories epic headings C6 and V4 | "Epic C6 - Ratings, reviews, badges, and sponsored content" / "Epic V4 - Public profile, reputation, and promotion" | "Epic C6 - Ratings, reviews, and badges" / "Epic V4 - Public profile, reputation, and promotion (promotion after the MVP, DEC-015)" |
| F3 | user-stories section 11 items 10 and 12 | "10. Claims, inspections, support/live chat, privacy/retention, and regulatory reporting rules." / "12. Sponsored placement inventory, approval, disclosure, targeting/frequency, measurement/attribution, pricing/billing, complaints, and ranking separation." | "10. Claims, inspections, help-desk record references, privacy/retention, and regulatory reporting rules." / "12. Sponsored placement scope (after the MVP, DEC-015)." |
| F4 | user-stories US-CUS-013, last criterion | "…then the reference remains recoverable and authorised retry is available." | "…then the request stays in my account with its reference and the email is retried." |
| F5 | user-stories US-ADM-010 statement and third criterion | "…so that a verified customer can continue without exposing their token." / "when I attempt resend" | "…so that they can regain access without anyone seeing a reset token." / "when I attempt to send a reset" |
| F6 | requirements-spec section 13, two bullets | "- Sponsored placements and paid promotion (deferred, DEC-015)." / "- Road-tax renewal and payment (deferred, DEC-007)." | "- Sponsored placements and paid promotion (deferred, DEC-015; FR-ADS-001, FR-ADS-002, FR-IP-016, FR-ADM-019, BR-015)." / "- Road-tax renewal and payment (deferred, DEC-007; FR-VEH-006, BR-009)." |
| F7 | user-stories section 2, after the Should line | (none) | "- **Status: Deferred:** Outside the MVP; the priority applies when the scope returns." |
| F8 | requirements-spec register, Owner of DEC-016 and DEC-019 | (empty) | "Product owner/Insurers" (as DEC-004, which supersedes it) / "Finance/Product owner" (as DEC-008) |
| F9 | requirements-spec FR-QTE-005 acceptance | "The platform blocks only the affected insurer/product or the whole request according to the approved orchestration rule." | "Missing or rejected evidence blocks only the product that needs it; the customer uploads it or removes that product before submitting." |
| F10 | both files, header | "**Version:** 0.10" / "**Date:** 26 August 2026" | "**Version:** 0.11" / "**Date:** 28 October 2026". The docx and Zoho exports in `output/` stay at 0.10 until regenerated in a separate, approved step. |
| F11 | requirements-spec section 13, after the road-tax bullet | (none) | "- Customer-support ticketing and live chat (external help desk, DEC-012; FR-SUP-003)." |
| F12 | user-stories US-ADM-012 statement, as written by F1 | "…so that support can find and act on the right record, …" | "…so that support can act on the right record, …" |

## 6. What this roadmap guarantees, and what it leaves to each batch plan

Guaranteed by this roadmap (each round of review checks these):
1. Every backlog item is in exactly one batch, or split with each part named, or deferred in "After the MVP".
2. Every decision in section 0 is applied in the batch that delivers it, and no batch contradicts one.
3. No batch needs something a later batch builds.
4. Every shared rule, check or mechanism has one defining batch (section 4); later batches reuse it.
5. Every spec or story text a decision contradicts has an amendment in section 5, quoted exactly.
6. Every item of requirements section 12 is delivered or gated by some batch.
7. The quote flow of section 3 holds end to end: what the customer chooses is what the server checks, delivers,
   quotes, compares and pays.

Deliberately left to each batch's own plan (a finding at this level goes to that plan, not into this roadmap):
- Package boundaries, file ownership, table and column names, migration statements and tests per rule.
- The exact design of a mechanism this roadmap only places (the limiter's storage, the idempotency key's columns,
  the job runner's locking), beyond the constraints stated here. This includes how section 0's three outcome rules are
  built: how deletion is serialised with payment, how an inspection is attached to the versions it serves, and how a
  lapsed licence is shown. A finding there is a defect only if the stated outcome fails. (2026-10-28, r7.)
- Values insurers, providers or compliance have not supplied (decision 19).

## 7. Not verified

- The analysts read the code; they ran nothing. Each batch 3 defect gets a failing test before it is fixed.
- Sizes are estimates. A batch marked XL may split when it is planned.
- Whether launch insurers will supply product, rule, NCD and claim data in time; each batch runs on provisional
  settings until they do.
- Whether old build files survive a deploy on the chosen hosting (affects the service-worker design; batch 2 tests a
  deploy locally).
- The Word and Zoho exports in `output/` are not updated by this roadmap.

## 8. Review findings

Round 1 (snapshot `dab1ebf`; batch numbers in this table are the round-1 numbering, superseded in rounds 2 and 3): Codex (gpt-6-astra) 0 Critical, 3 High, 6 Medium, 1 Low; reviewer agent (Opus) 0
Critical, 3 High, 9 Medium, 10 Low. Every finding was checked against the spec, the batch 2 plan or the code at
`aaec0ea` before the plan changed; none was declined.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C1 / R-H2 | US-ADM-002 and US-CUS-001 absent from every batch (`user-stories.md:39, 642`) | US-ADM-002 in batch 7, US-CUS-001 in batch 13 with a batch 20 re-check |
| C2 / R-H3 | Batch 2 plan lines 252, 271-272 defer production reset, verification and enumeration-resistant registration | Batch 6 takes the US-CUS-002 remainder |
| C3 / R-L10 | Spec section 12 items 1, 3, 9, 11, 12 not in the gate | Batch 20 release gate lists every section 12 item with owner and evidence |
| R-H1 | `portal.dto.ts:17-22` accepts any premium ≥ 0.01; no floor use outside `pia/` | Floor check in batch 3; estimate never below the floor in batch 10 |
| C4 | `quote-requests.service.ts` requote copies no dates or photos | Batch 3 requote item carries dates and evidence |
| C5 | see C1 | — |
| C6 / R-M1 | Stories at `user-stories.md:62-64, 163-164, 216-222, 356, 414-415, 531-534, 764-768, 795-800` contradict decisions | Section 5.2 added |
| C7 / R-M1 | Spec lines 242, 276-278, 311, 328 keep sponsored obligations | Sponsored row extended; NFR-TRU-001 row added |
| C8 / R-M1 | FR-POL-003 (spec line 117) and US-CUS-021 need a routed queue | Coordinator choice in section 0; batch 15 keeps service requests in InsurShield |
| C9 | Spec 8.1 exception states (line 250) | Batch 12 names the quote-side states; batch 14 the payment and issuance states |
| C10 | `insurer.dto.ts:85-86` validates on create, `:114-115` not on update | Batch 3 item scoped to update |
| R-M2 | No limiter on `/vehicles/lookup`, `/insurers/directory`, `/config/pia`, submits | Shared limiter in batch 3 |
| R-M3 | `idempotency_records.key` is a global primary key; `integration_deliveries."insurerId"` NOT NULL | One mechanism in batch 3; batch 11 migration widens deliveries |
| R-M4 | Documents added in 13, 14, 16 before security in old batch 11 | New batch 5 |
| R-M5 | FR-QTE-006 (spec line 79) delivers each request through the integration layer | Integration platform (11) before the quote workflow (12) |
| R-M6 | Batch 2 package W file list (plan line 558) lacks `sw.js`; cache-first page | Section 3 batch 2 design and 5.3 amendment |
| R-M7 | Old batch 8 and 6 too large | Quote work split into 12 and 13; staff work into 7 and 8 |
| R-M8 | Road tax in FR-PAY-002, BR-009, FR-VEH-006 unplaced | User decision 21 (deferred); road-tax amendment row |
| R-M9 | No batch for NFR-SEC-004, NFR-PRI-001; `clientSecretEncrypted` unused | Key management in 11; encryption at rest and breach response in 20 |
| R-L1 | NCD code in three batches | Batch 3 refusal only; field and use in 13; NCD lifecycle in 16 |
| R-L2 | FR-ELG-004 declarations unplaced | Batch 13 |
| R-L3 | Unlabelled splits | Each split item now names its part in section 2 |
| R-L4 | Register mapping wrong for DEC-009 | Register row rewritten |
| R-L5 | Section 2 wording left a dangling comma | Exact replacement sentence |
| R-L6 | `userId` NOT NULL and read-only inactive portal unscheduled | Batch 3 and batch 7 |
| R-L7 | Job-runner uses and documents missing from section 4 | Rows added |
| R-L8 | Provider gate only in batch 20 | Defined in batch 5 |
| R-L9 | Accessibility only in batch 20 | Every batch's exit criteria |

Round 2 (snapshot `f84e4cc`): Codex 0 Critical, 1 High, 4 Medium, 2 Low; reviewer agent (Opus) 0 Critical, 1 High, 8
Medium, 10 Low. Most were introduced by round 1's changes and the user's revised decision 9. Because more than one
Medium or worse came from the round's own changes, the quote flow was redesigned as a whole (section 3, "The quote
flow under decisions 9, 22 and 23") instead of patched finding by finding, and the user answered two questions
(decisions 22 and 23). Each finding was checked against the spec, stories or code at `aaec0ea`; none was declined.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C1 / R-H1 | `schema.ts:443-446, 475` unique (request, insurer); `payments.service.ts:54` finds the quote by insurer | Decision 22; quote-flow steps 6, 7, 10; batch 12 migration and payment lookup |
| C2 | `quote-requests.service.ts:103-133` requote and `policies.service.ts:40-79` renewal send to all active insurers | Quote-flow step 11, batch 12; batch 15 renewal recipients |
| C3 / R-L1 | `user-stories.md:152, 157, 162, 164` still count insurers | US-CUS-009 row rewritten |
| C4 / R-M3 | BR-009 (`requirements-spec.md:236`), `user-stories.md:261, 749, 935` keep road tax; decision text differed from FR-PAY-002 | Road-tax row adds BR-009; story rows; decision 21 wording matches FR-PAY-002 |
| C5 | `user-stories.md:654`; batch 2 plan line 940; claim acknowledgement is a portal write | Coordinator choice in section 0 (servicing continues, no read-only portal); batch 7 |
| C6 | Unescaped pipe in the 8.2 row | "Approved or Declined" |
| C7 / R-L2 | Batch 20 row lacked EN-008 | Row restored |
| R-M1 | Batch 12 delivered to choices made in batch 13 | Request model and screens together in batch 12; batch 13 is the insurer-side workflow |
| R-M2 | `user-stories.md:143, 147, 201, 215, 219, 235`; FR-QTE-001, FR-QTE-006 | Decision 23; quote-flow steps 2–5; amendment rows |
| R-M4 | Retention values in 5 and 10; deletion needs the job runner (6) | Classes in 5, values in 10, deletion job in 15 |
| R-M5 | FR-INS-001 (`requirements-spec.md:143`), "Inspection Required" in old 12, inspections in old 16 | Underwriting inspections in batch 13; batch 16 is claims and NCD |
| R-M6 | FR-POL-003 acceptance "status, messages" (`requirements-spec.md:117`) | FR-POL-003 amendment row (insurer's updates); batch 15 |
| R-M7 | US-VEN-008 asks for evidence (`user-stories.md:532`); 8.2 keeps "Additional Information Required" | FR-CLM-006 row and batch 16: customer uploads requested evidence |
| R-M8 | Batch 2 plan lines 380-394 define the client-address rule and auth limits | Batch 3 limiter reuses them; section 4 row |
| R-L3 | Batch 20 body lacked the US-CUS-001 re-check | Added |
| R-L4 | `idempotency_records.key` sole primary key (`schema.ts:733`) | Batch 3 names the key migration and the purge |
| R-L5 | Every DEC outcome is empty (`requirements-spec.md:404-418`) | Register row rewritten; DEC-002, 008, 011, 013 stay open |
| R-L6 | Spec line 258 still lists `Rejected`, `Closed` | New 8.2 row |
| R-L7 | Content check owned by both 3 and 5 | Batch 3 owns it; batch 5 builds on it |
| R-L8 | Floor and insurer status re-touched by 8 and 10 | Batches 8 and 10 state what they re-apply; section 4 rows |
| R-L9 | Titles, statements and slices at `user-stories.md:522, 527, 758, 763, 788, 793, 874-902, 935`; FR-SUP-003 | Story rows; FR-SUP-003 row |
| R-L10 | FR-ELG-003 "where allowed" (`requirements-spec.md:67`) | Per-product estimate switch and rate-limited estimate route in batch 10 |

Round 3 (snapshot `bcb5d5d`): Codex 0 Critical, 2 High, 3 Medium, 1 Low, `DESIGN: no`; reviewer agent (Opus) 0
Critical, 1 High, 4 Medium, 8 Low, `DESIGN: no`. Both rejected the round-2 redesign for the same gaps, so the flow was
revised as a whole again, and the user answered one question (decision 24). Each finding was checked against the
code, spec or stories at `aaec0ea`; none was declined. The batch numbers below are current.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C1 / R-H1 | `insurer-portal.service.ts:96-118` refuses a second quote of one insurer; `insurer-portal.repository.ts:98-101, 143-149, 181-192` per insurer; `quote-request.response.ts:62-73` keys replies by insurer name | Batch 12 builds the minimum reply per version, the customer view by quote id and payment by quote id (quote-flow steps 7, 9, 10) |
| C2 / R-M4 | `customer.dto.ts:53-87` with `forbidNonWhitelisted` (`app.setup.ts:22`); old `findQuote` by insurer with no order (`payments.repository.ts:88-101`) | "Cutover at batch 12": reload refusal, API first, rollback unsafe after a two-version request, legacy requests listed and paid by id |
| C3 / R-M2 | FR-CMP-003 (`requirements-spec.md:103`), FR-ADM-007 (`:210`); reply and payment check no product or insurer status | Decision 24; quote-flow steps 10 and 11; section 4 insurer-status row |
| C4 / R-M1 | FR-INS-001 stages (`requirements-spec.md:143`); US-CUS-024 claim assessment (`user-stories.md:377`); US-VEN-010 post-loss evidence (`:555, 562`) | Inspection rule with blocking stage (step 1, 8); model and pre-payment stages in 13; after payment and claims in 16; payment waits in 14 |
| C5 / R-L2 | US-CUS-008 recalculation (`user-stories.md:150`), US-CUS-010 revalidation (`:177`) | Quote-flow step 5 |
| C6 | US-CUS-026 title and statement (`user-stories.md:403, 408`); US-VEN-014, US-ADM-016 | Story rows rewritten and the two stories marked deferred |
| R-M3 | `policies` has no product column (`schema.ts:535-556`); `policies.service.ts:57-59` handles a pruned request | Step 12: product derived through the quote, otherwise the list; section 4 product-versions row |
| R-L1 | US-CUS-013 submit criteria in 12, tracking in 13; US-CUS-020 recipients in 12 | Section 2 rows name both splits |
| R-L3 | Purge listed for batch 3 with no builder | Batch 6 builds it |
| R-L4 | Floor applies to each per-version quote and to renewal repricing | Section 4 floor row |
| R-L5 | `user-stories.md:148, 191, 207`; FR-TRK-001 (`requirements-spec.md:99`) | Story rows and FR-TRK-001 row |
| R-L6 | `insurer_quotes` unique on (request, insurer reference) (`schema.ts:476-479`) | Step 7 leaves it to the batch 12 plan by name |
| R-L7 | Status line and round-1 rows used old numbers | Status line updated; round-1 table marked as old numbering |
| R-L8 | Requote and renewal used different version rules | One rule for both (step 12) |

Round 4 (snapshot `a288b97`): Codex 0 Critical, 1 High, 1 Medium, 0 Low, `DESIGN: no`; reviewer agent (Opus) 0
Critical, 0 High, 4 Medium, 9 Low, `DESIGN: no`. Each finding was checked against the code at `aaec0ea`; none was
declined.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C-H1 / R-M1 | Batch 12's payment check and listing relied on inspections built in 13; `payments.service.ts:37-120` reads no inspection; the rule is per insurer (`schema.ts:283-285`) | Step 1: rule moves onto the version in batch 9, shown from 12, enforced from 13 and 16; the payment gate is batch 13's (steps 8, 10; batch 13 and 14 bodies; section 4) |
| C-M1 / R-L4 | Old requote broadcasts (`quote-requests.service.ts:103-133`) even for a one-product request | Cutover: rollback unsafe from the first request with chosen versions; the restore's data loss stated |
| R-M2 | `inspections` keyed by customer, insurer and plate (`schema.ts:673-699`) | Coordinator choice in section 0: one inspection per insurer and vehicle; the gate reads only the paid quote's own rule (step 8) |
| R-M3 | NULLs are distinct in a unique index; `hasQuote` per insurer (`insurer-portal.service.ts:96-101`) | Step 7: version required on versioned requests, old portal tab refused, (request, insurer) unique where the version is null |
| R-M4 | `INSURER_STATUSES` is ACTIVE, INACTIVE, DELETED (`enums.ts:12`) | Coordinator reading of decision 24 in section 0; steps 10 and 11 |
| R-L1 | No owner for the decision-24 notice | Step 11: batch 12 sends it through batch 6; section 4 email row |
| R-L2 | Requote rule unclear for one bad pick of three | Step 12 keeps the valid picks |
| R-L3 | A pruned request nulls `policies.insurerQuoteId` (`schema.ts:480`) | Step 12: renewal reads the policy's version from batch 14 |
| R-L5 | Requote dropped documents and photos | Step 12 carries them |
| R-L6 | Batch 16 heading | Renamed |
| R-L7 | Batch 9 claimed batch 12's column | Batch 9 body |
| R-L8 | FR-CMP-003 "withdrawn, superseded" refers to quotes | Step 10 |
| R-L9 | Old web pays with `insurer` (`payment.dto.ts:12`) | Cutover note for the batch 12 plan |

Round 5 (snapshot `d59bc7f`): Codex 0 Critical, 0 High, 1 Medium, 0 Low, `DESIGN: yes`; reviewer agent (Opus) 0
Critical, 0 High, 2 Medium, 8 Low, `DESIGN: no`. Both reviewer Mediums were introduced by round 4's fixes; Codex's
Medium was a round-4 fix left incomplete. Each finding was checked against the code at `aaec0ea`; none was declined.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C-M1 | Decision 24 can cancel a quote made before the cutover; the old payment reads no cancellation (`payments.service.ts:81-99`, `payments.repository.ts:88-101`) | Cutover: rollback unsafe from the new API's first write of any kind |
| R-M1 | Each rule has a method and a timing (`schema.ts:283-285`, `enums.ts:48-55`) | Section 0 inspection choice and step 8: a pass counts only where it meets the version's method and stage |
| R-M2 | `licenceExpiry` is a date, not a status (`schema.ts:280`); nothing acts when it passes | Section 0: a batch 12 job on batch 6's runner records the cancellations and notices; section 4 job runner row |
| R-L1 | Step 10's checks all pass for a restored insurer | Step 10: "not made unpayable under decision 24", with its test |
| R-L2 | "Recorded on the version" could mean the shared product version | Section 0: the request's chosen-version row |
| R-L3 | "Deleted" now counted as suspended, and suspended insurers keep servicing access | Section 0: a deleted insurer's users lose portal access |
| R-L4 | Extend finds the quote by request and insurer (`insurer-portal.service.ts:131`) | Step 7: a version-less extension on a versioned request is refused |
| R-L5 / R-L6 | A policy's payment (`schema.ts:574`, `restrict`) holds its quote (`payments_insurerQuoteId_fkey`, `restrict`), so the quote cannot be pruned; round 4's R-L3 premise was wrong | Round 4's batch 14 policy-version column withdrawn; step 12 reads through the quote; section 4 row |
| R-L7 | A newer version may ask new extra questions | Step 12: such a pick goes through steps 5 and 6 again with confirmation |
| R-L8 | Status line said round 3 | Status line |

Round 6 (snapshot `a24bb7d`, also a design review of the whole quote flow because round 5 found two Mediums
introduced by round 4's fixes): Codex 0 Critical, 0 High, 1 Medium, 0 Low, `DESIGN: no`; reviewer agent (Opus) 0
Critical, 0 High, 3 Medium, 5 Low (two of them notes for batch plans), `DESIGN: no`. All three Mediums were
introduced by round 5's own fixes, each in a rule added to section 0; the fixes below remove mechanism rather than
add it (the licence-lapse job is withdrawn). Each finding was checked against the code at `aaec0ea`; none was
declined.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C-M1 / R-M3 | Soft deletion checks nothing (`insurers.service.ts:73-88`); claim acknowledgement needs an insurer user (`insurer-portal.service.ts:59-63, 215-225`); batch 2 refuses a deleted insurer's sign-in (`batch-2-better-auth.md:940`) | Section 0 and batch 7: deletion refused while anything remains to service; each later batch adds its items to the check; section 4 row |
| R-M1 | A self-capture pass could never meet a physical rule, and no further inspection was allowed | Section 0 and step 8: an inspection serves only the versions whose rule it meets; a version not yet served gets its own; a fail declines the versions it serves |
| R-M2 | `licenceExpiry` is one overwritable date (`schema.ts:280`), so a lapse job's outcome depended on its timing | Section 0: a lapse blocks reply and payment while it lasts and is not a decision-24 action; the job is withdrawn; steps 7 and 10; section 4 |
| R-L1 | A legacy request has no chosen-version rows | Section 0: its mark goes on the recipient row |
| R-L2 | `extendOpenQuote` reads no mark (`insurer-portal.service.ts:131`) | Section 0: a marked quote cannot be extended; batch 12 test |
| R-L3 | Section 4 named no owner for the marks | Batch 12's row |
| R-L4 | A pending provider payment when the mark is made | Step 11: settled by the batch 14 plan, never left open |
| R-L5 | Batch 12's tests missed the restore and lapse cases | Batch 12 test list |

Round 7 (snapshot `c0537a2`, whole quote flow again): Codex 0 Critical, 0 High, 1 Medium, 0 Low, `DESIGN: no`;
reviewer agent (Opus) 0 Critical, 0 High, 3 Medium, 6 Low, `DESIGN: no`. The Mediums were again introduced by the
previous round's section 0 rules, each at the level of a mechanism (which records, what ordering, which inspection).
So section 0's three rules are now stated as outcomes, and section 6 leaves their mechanisms to the batch plans; each
finding below is closed at that level. Each was checked against the code at `aaec0ea`; none was declined.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C-M1 / R-M1 | Claims, NCD applications and inspections exist today with an insurer (`schema.ts:579, 633, 673`; `claims.service.ts:54-65`; `ncd.service.ts:26-39`) | Section 0: batch 7's check covers every record existing then; section 4 row |
| R-M2 | Payment locks the customer and request only, then inserts a policy (`payments.service.ts:62-117`) | Section 0: no payment in flight; the check runs at execution and cannot interleave with payment; batch 14 adds pending provider payments |
| R-M3 | Two inspections could serve one version with opposite results | Section 0: at most one inspection per version and stage, results final |
| R-L1 | `POLICY_STATUSES` has no expired value (`enums.ts:15`) | Section 0: judged by the end date plus the reporting window |
| R-L2 | An inspection for cancelled versions would block deletion | Section 0: only one serving a live version counts |
| R-L3 | A lapse never renewed left the customer uninformed | Section 0: the customer sees it; the admin's way out is deactivation |
| R-L4 | FR-ADM-007 covers compliance evidence (`requirements-spec.md:210`) | Section 0: treated as a lapse |
| R-L5 | Batch 12 tests lacked the legacy restore case | Batch 12 test list |
| R-L6 | Status line said round 5 | Status line |

Round 8 (snapshot `76b0641`, the outcome form of section 0): Codex 0 Critical, 0 High, 0 Medium, 1 Low,
`DESIGN: yes`; reviewer agent (Opus) 0 Critical, 0 High, 2 Medium, 5 Low, `DESIGN: no`. Each finding was checked
against the code and spec at `aaec0ea`; none was declined. Mechanism notes went to the batch plans named.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C-L1 / R-L5 | Section 4's deletion-check row omitted 13 and 14 | Section 4 row |
| R-M1 | Payment reads no insurer status (`payments.service.ts:57-117`; `payments.repository.ts:88-101`), so a deleted insurer's quote stayed payable from batch 7 to 11 | Section 0, batch 7 and step 10: from batch 7 payment refuses a quote of an insurer that may not take new business |
| R-M2 | The spec keeps reinspection (`requirements-spec.md:234, 268`; `user-stories.md:384, 560`) | Section 0: a fail reopens for reinspection where the version's rule allows it |
| R-L3 | No reporting window exists before batch 16 (`claims.service.ts:44-80`) | Batch 10 settings; until then every issued policy blocks deletion |
| R-L4 | A late claim on a deleted insurer fails "Insurer not found" (`claims.repository.ts:52`) | Section 0: refused with the help-desk route |
| R-L6 | Batch 7 cut vendor access on expired evidence; US-ADM-002 blocks at activation (`user-stories.md:651`) | Batch 7: at activation; later expiry follows section 0 |
| R-L7 | Step 10 and batch 12's tests named the licence only | Step 10; batch 12 test list, with the "cannot respond for now" display |

Round 9 (snapshot `df38265`, the difference only): Codex 0 Critical, 0 High, 0 Medium, 0 Low, `DESIGN: yes`;
reviewer agent (Opus) 0 Critical, 0 High, 1 Medium, 2 Low, `DESIGN: yes`. Each finding was checked against the code
and spec at `aaec0ea`; none was declined.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| R-M1 | Section 0 kept the help desk to complaints; FR-CLM-004 (`requirements-spec.md:134`) gives late claims a process; no batch built the refusal | Section 0: help desk also covers claims against a deleted insurer; FR-CLM-004 amendment in 5.1; the window and the refusal move to batch 16; section 4 row |
| R-L2 | Spec 8.4 has Cancelled and No Show (`requirements-spec.md:268`); US-VEN-010 asks for reinspection on unusable evidence (`user-stories.md:560`) | Section 0: one open inspection per stage; reinspection, cancellation, no-show or the insurer's request opens a new one |
| R-L3 | Batch 7 builds deactivation and restore, but marks came in batch 12 | Section 0 and step 10: marks recorded and checked from batch 7 on the recipient row and quote |
| Note | Seeded insurers have no evidence records | Batch 7: evidence records first |

Round 10 (snapshot `05fae35`, the difference only): Codex 0 Critical, 0 High, 0 Medium, 2 Low, `DESIGN: yes`;
reviewer agent (Opus) 0 Critical, 0 High, 0 Medium, 2 Low, `DESIGN: yes`. This is the stopping round: neither
reviewer found anything above Low. Each Low was checked against the code and spec at `aaec0ea` and fixed below;
these fixes were not re-reviewed.

| Id | Verified how | What changed and where |
| --- | --- | --- |
| C-L1 | Cancellations start in batch 7 but notices were batch 12's | Step 11, batch 7 and section 4: notices from batch 7; batch 12 shows the per-version state |
| C-L2 | The cutover blamed the previous API for skipping cancellations, which batch 7 now checks | Cutover: rollback reason is the missing chosen versions (`quote-requests.service.ts:113-132`) |
| R-L1 | `submitQuote` checks only that the request is open (`insurer-portal.service.ts:103`); `extendOpenQuote` reads no mark (`:131`) | Section 0 and batch 7: reply, extension and payment refuse marked rows from batch 7; section 4 rows |
| R-L2 | Section 0 refused late claims only; the amendment refused any | Section 0, batch 16 and the FR-CLM-004 row: any claim against a deleted insurer, with an acceptance criterion |
| Note | Seeded insurers have no licence number or expiry (`reference-data.ts:36`) | Batch 7: licence and evidence records for the seed and existing rows |
