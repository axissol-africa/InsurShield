# Batch 13: Quote workflow, insurer queues and inspections before payment

## Purpose

Batch 12 gives every request its chosen product versions and lets an insurer quote or decline each one. That is the
minimum. Batch 13 turns it into a workflow people can run a business on.

For the customer, every chosen product shows where it really stands (pending, more information needed, inspection
needed, ready, declined, timed out, expired, cancelled), the ready quotes sit side by side in one consistent format,
and nothing is bought without the customer seeing the conditions that matter.

For the insurer, requests arrive in a queue with an owner, a priority and a deadline, and the officer can ask for more
information, decline with a reason, or return a full quote with its components. Where a product needs the vehicle
inspected before quoting or before payment, there is now one inspection model that the insurer schedules and decides
in the portal and the customer supplies photos for.

This is the roadmap's quote-flow steps 7 to 9 beyond batch 12's minimum, and the "before payment" gate on step 10
(`roadmap.md` section 3, batch 13 and the quote flow). Payment and issuance states belong to batch 14. Inspections
after payment and for claims belong to batch 16, which reuses the model built here.

Backlog items: the tracking part of US-CUS-013, US-CUS-014, US-CUS-015, US-CUS-024 and US-VEN-010 (first part:
inspections before quote and before payment), US-VEN-005, US-VEN-006. Requirements: FR-TRK-001, FR-CMP-001 to 005,
FR-IP-003, FR-IP-007, FR-INS-001 to 004, section 8.1 (quote-side states), section 8.4 (inspection states). Decisions
applied: 14 (the insurer moves inspections in the portal, the customer uploads photos), 24, and the section 0
inspection rule.

## Before this batch starts

1. **Batch 12 is merged** (PR #26, `f0d94ad`). It differs from the batch 12 plan in names and scope, and this plan
   follows the code:
   - The chosen-version table is **`quote_request_product_versions`** (migrations 0028, 0029, 0032), one row per
     chosen version with a snapshot of the product (code, version number, name, cover type, cover guide, inspection
     rule, timing and method) and the decision 24 mark (`cancelledAt`, `cancelledReason`). **It has no status
     column.** Wherever this plan says "chosen-version row" or `requestProductId`, it means a row of this table and a
     foreign key to its `id`.
   - `quote_requests.model` is an enum, `LEGACY | PRODUCT_SELECTION`.
   - Answers, declarations and documents live in `quote_request_product_requirement_answers`, `…_declarations` and
     `…_documents`; product requirements in `product_version_requirements` (migration 0031).
   - The insurer can quote and extend per version, but **cannot decline a version**. Batch 13 adds decline.
   - Requote and renewal refuse with `REQUOTE_REQUIRES_PRODUCT_SELECTION` and send the customer back to the product
     list. There is no prepared draft carrying the old picks; that is acceptable and batch 13 leaves it as is.
   - Payment takes `insurerQuoteId`; a body without it gets `RELOAD_REQUIRED`.
2. **The batch 11 security follow-up has landed** (PR #27). Batch 13 adds insurer queue events and inspection notices
   on top of the integration platform, so it builds on the fixed version.

## Starting point

Verified on `main` at `f0d94ad` (batch 12 merged).

- **Request status is three values.** `QUOTE_REQUEST_STATUSES` is `SUBMITTED | QUOTED | EXPIRED`
  (`src/common/domain/enums.ts`). Chosen versions have no state of their own: whether one is answered is read from
  `insurer_quotes`, and whether it is cancelled from `cancelledAt`.
- **A quote is a premium, a document and a validity.** `insurer_quotes` holds `premiumMinor`, `notes`,
  `insurerReference`, `validityDays`, `validUntil`, `extendedAt`, `documentId` and the decision 24 mark. There are no
  premium components, excess, priced add-ons, conditions or terms, and no withdrawn or superseded state.
- **The reply deadline is a setting nobody reads.** `QUOTE_REPLY_DEADLINE` (`{ days }`, default 7) exists in
  `src/settings/domain/rules.ts`. Nothing computes a due date or times a request out.
- **Insurer portal has no queue.** `InsurerPortalService.listQuoteRequests` returns every delivered request newest
  first. There is no owner, priority, assignment or internal note.
- **Inspections are a customer appointment, not part of underwriting.** `inspections`
  (`src/db/schema.ts`) has `customerId`, an optional `insurerId`, the plate and label, preferred and scheduled times,
  inspector details, location and notes. It is not linked to a request, a product version, a method or a blocking
  stage. `inspection_photos` holds one document per slot. `InspectionsController` has customer routes only
  (`inspection:read`, `inspection:request`, `inspection:update`, all `['customer']` in
  `src/common/auth/permissions.ts`); **the insurer cannot move an inspection through the API at all.**
- **Inspection statuses** are `REQUESTED, SCHEDULED, INSPECTOR_ASSIGNED, IN_PROGRESS, COMPLETED, REPORT_READY,
  APPROVED, FAILED`. Section 8.4 also asks for `Cancelled`, `No Show` and `Reinspection Required`.
- **The product version owns its inspection rule.** `insurer_product_versions` has `inspectionRule`
  (`NOT_REQUIRED | OPTIONAL | REQUIRED`), `inspectionTiming` (`BEFORE_QUOTATION | BEFORE_PAYMENT | AFTER_PAYMENT`) and
  `inspectionMethod` (`SELF_CAPTURE | PHYSICAL`). Nothing enforces it. There is no field saying whether a failed
  inspection may be retried.
- **Journey photos** live in `inspection_shots` on the quote request, separate from `inspection_photos`.
- **Insurer roles** (batch 7): `INSURER_ADMIN`, `QUOTE_OFFICER`, `CLAIMS_OFFICER`, `SUPPORT`, `FINANCE`,
  `COMPLIANCE_READ_ONLY`, plus the legacy `INSURER_USER`. `QUOTING` is `INSURER_ADMIN, QUOTE_OFFICER, INSURER_USER`.
- **Notifications are customer-only.** `notifications.customerId` is required, so insurer staff cannot receive an
  in-app notice through that table. Staff mail goes through the mail adapter (batch 6) directly.
- **The "best value" flag is a hard-coded column.** `insurers.isBestValue` exists with no approved ranking rule behind
  it (BR-012 is still open).

## Rules this batch must hold

1. Every chosen version has exactly one current state from one transition table, and every change goes through the
   batch 4 state-transition helper with actor, note and time.
2. The request's status is derived from its versions' states by one pure function and stored, so it never disagrees
   with them.
3. Customer-visible text and internal notes are separate fields. An internal note never reaches a customer response,
   a notification or an audit summary.
4. A decline needs a reason from an approved list. The customer sees the customer wording for that reason, never the
   internal one.
5. A quote that has been selected, paid or has expired is never edited. Before selection, the insurer changes a quote
   only by withdrawing it or replacing it, and the replaced quote is marked superseded (FR-CMP-003).
6. A version whose rule blocks before quotation cannot be quoted until a passing inspection serves it. A quote whose
   version blocks before payment cannot be paid until a passing inspection serves that version.
7. One inspection may serve several chosen versions of the same insurer only where it meets each one's rule: a
   physical inspection meets a self-capture rule, not the reverse; one done before quotation also meets a
   before-payment rule; neither meets an after-payment rule.
8. A version has at most one open inspection per stage. Every result is kept. A pass is final for the versions it
   serves. A fail declines only those versions, unless a version's rule allows reinspection. A reinspection, a
   cancelled or no-show inspection, or the insurer's request when the evidence is unusable opens a new inspection for
   the versions still unmet.
9. Decision 24 still holds: a suspended insurer's open versions are cancelled (including those waiting for
   information or an inspection), its open inspections for those versions are cancelled, and a restore revives none
   of it. A product withdrawn after submit does not stop its open versions from being answered or inspected.
10. Insurer users see only their own insurer's requests, versions, quotes, inspections and notes. Every refusal of a
    foreign id is audited as `access.refused`.

## The state model

### Chosen-version states

Batch 13 replaces batch 12's four values. Names follow section 8.1 where it has them.

| State | Meaning | Customer label |
| --- | --- | --- |
| `SUBMITTED` | Delivered, not yet picked up | Waiting for the insurer |
| `INSURER_PROCESSING` | An officer has opened or claimed it | The insurer is working on it |
| `VERIFICATION_REQUIRED` | The insurer asked for more information | The insurer needs more information |
| `INSPECTION_REQUIRED` | An inspection must pass before a quote | Inspection needed |
| `QUOTED` | A current quote exists | Quote ready |
| `DECLINED` | The insurer declined, or a failed inspection declined it | Declined |
| `TIMED_OUT` | No answer by the reply deadline | The insurer did not respond in time |
| `EXPIRED` | The quote's validity passed without payment | Quote expired |
| `CANCELLED` | Decision 24, or the customer removed it | Cancelled |
| `MANUAL_REVIEW` | InsurShield operations must look at it (a delivery exception, an inconsistent state) | Under review |

Permitted transitions (a pure table in `src/customer/domain/quote-workflow.ts`, unit-tested row by row):

- `SUBMITTED → INSURER_PROCESSING` (officer opens or claims it; automatic on the first insurer action)
- `SUBMITTED | INSURER_PROCESSING → VERIFICATION_REQUIRED` (request more information)
- `VERIFICATION_REQUIRED → INSURER_PROCESSING` (customer answers)
- `SUBMITTED → INSPECTION_REQUIRED` (automatic at submit when the rule is required before quotation)
- `INSURER_PROCESSING → INSPECTION_REQUIRED` (officer asks for an optional inspection before quotation)
- `INSPECTION_REQUIRED → INSURER_PROCESSING` (a passing inspection serves the version)
- `INSPECTION_REQUIRED → DECLINED` (a fail with no reinspection allowed)
- `SUBMITTED | INSURER_PROCESSING | VERIFICATION_REQUIRED → QUOTED` (return a quote)
- `SUBMITTED | INSURER_PROCESSING | VERIFICATION_REQUIRED | INSPECTION_REQUIRED → DECLINED` (decline with reason)
- `SUBMITTED | INSURER_PROCESSING | VERIFICATION_REQUIRED | INSPECTION_REQUIRED → TIMED_OUT` (deadline job)
- `QUOTED → INSURER_PROCESSING` (insurer withdrew its quote without replacing it)
- `QUOTED → EXPIRED` (validity job)
- any open state, and `QUOTED` while unpaid `→ CANCELLED` (decision 24, or the customer removes the product)
- any open state `→ MANUAL_REVIEW` and back (InsurShield operations only)

`VERIFICATION_REQUIRED` and `INSPECTION_REQUIRED` stop the reply clock while they last; the due date moves on by the
time spent waiting for the customer (open question 1 confirms this default).

### Request status

Add to `QUOTE_REQUEST_STATUSES`: `DRAFT` is not needed (batch 12 keeps drafts in their own table), so the new values
are `INSURER_PROCESSING`, `PARTIALLY_READY`, `QUOTES_READY`, `QUOTE_SELECTED`, `CANCELLED`. `QUOTED` stays in the enum
for legacy rows and is mapped to `PARTIALLY_READY` or `QUOTES_READY` by the backfill.

Derived, in order:
1. `QUOTE_SELECTED` when the customer has selected a quote that is still payable.
2. `QUOTES_READY` when at least one version is `QUOTED` and no version is still open.
3. `PARTIALLY_READY` when at least one is `QUOTED` and at least one is still open.
4. `INSURER_PROCESSING` when none is `QUOTED` and at least one is open and has left `SUBMITTED`.
5. `SUBMITTED` when every version is still `SUBMITTED`.
6. `EXPIRED` when every version is closed and none is `QUOTED` because of time (timed out or expired).
7. `CANCELLED` when every version is cancelled.
8. Otherwise (every version declined, or a mix of closed states) `EXPIRED`, which the customer sees as "no quotes
   available" with the requote action.

"Open" means `SUBMITTED, INSURER_PROCESSING, VERIFICATION_REQUIRED, INSPECTION_REQUIRED, MANUAL_REVIEW`.

Payment states (`Payment Pending`, `Paid`, `Payment Failed`) and issuance states are batch 14's.

### Inspection states

Add `CANCELLED`, `NO_SHOW`, `REINSPECTION_REQUIRED` to `INSPECTION_STATUSES`. Transitions:

`REQUESTED → SCHEDULED → INSPECTOR_ASSIGNED → IN_PROGRESS → COMPLETED → REPORT_READY → APPROVED | FAILED`

plus: `REQUESTED | SCHEDULED | INSPECTOR_ASSIGNED → CANCELLED | NO_SHOW`, `REPORT_READY → REINSPECTION_REQUIRED`
(evidence unusable), `FAILED → REINSPECTION_REQUIRED` (only when every version it serves allows reinspection). A
self-capture inspection skips scheduling: `REQUESTED → COMPLETED` once every required slot has a scanned photo, then
`REPORT_READY → APPROVED | FAILED`. `APPROVED`, `FAILED` (when final), `CANCELLED`, `NO_SHOW` and
`REINSPECTION_REQUIRED` are terminal for that inspection; the last three open a successor for the versions still unmet.

## Delivery order

Each package starts with failing tests for the rules it adds. One commit per package, Lore format. Packages B13.1 to
B13.5 are API; B13.6 is web; B13.7 is verification.

### B13.1 Schema and migration

Enum values added with `ALTER TYPE … ADD VALUE` cannot be used in the transaction that adds them, so this is **two
migration files**: the first adds enum values only, the second adds tables, columns and backfills. Both additive;
backup before migrating, as usual.

1. **Enums.** `QuoteRequestStatus` gains the values above. New enum `QuoteProductStatus` with the ten states, added as
   a `status` column on `quote_request_product_versions` (nullable, backfilled, then `NOT NULL`): `CANCELLED` where
   `cancelledAt` is set, `QUOTED` where an `insurer_quotes` row exists for that request and version, otherwise
   `SUBMITTED`. `InspectionStatus` gains the three
   values. New `InspectionPurpose` (`UNDERWRITING`, and `GENERAL` for the existing customer-requested appointments;
   batch 16 adds `CLAIM`). New `QuoteStatus` for quotes: `ACTIVE | WITHDRAWN | SUPERSEDED`.
2. **`quote_request_product_versions`** also gains: `replyDueAt` (timestamptz, computed at submit from the `QUOTE_REPLY_DEADLINE`
   version in force, backfilled for open rows from `quote_requests.submittedAt`), `pausedAt` and `pausedMs` (the clock
   stop for verification and inspection), `assignedStaffId` → `staff_users` (set null), `assignedAt`, `priority`
   (`NORMAL | HIGH`, default `NORMAL`), `slaWarnedAt`, `timedOutAt`, `declineReasonCode`, `selectedAt` is **not** here
   (selection is per quote, see 4).
3. **`quote_information_requests`**: `id`, `requestProductId`, `requestedByStaffId`, `customerMessage` (shown to the
   customer), `questions` jsonb (typed: text, choice, date), `documentKinds` (customer-uploadable kinds only), `dueAt`,
   `answeredAt`, `answers` jsonb, `answerDocumentIds` uuid[], `createdAt`. One open request per chosen version
   (partial unique index on `requestProductId WHERE answeredAt IS NULL`).
4. **`insurer_quotes`** gains: `status` (`QuoteStatus`, default `ACTIVE`), `withdrawnAt`, `withdrawnReason`,
   `supersededById` → `insurer_quotes` (set null), `componentsMinor` jsonb (typed list: base premium, loadings,
   discounts including NCD, levies; each `{ code, label, amountMinor }`, and the server checks they sum to
   `premiumMinor`), `excessMinor`, `addOns` jsonb (each offered add-on with `priceMinor`, `included` and its terms),
   `conditions` jsonb (each `{ code, text, purchaseCritical }`), `termsDocumentId` → `documents` (restrict, optional),
   `inspectionAction` (text, optional, shown to the customer). Existing quotes default to empty components and no
   conditions.
5. **`quote_selections`**: `quoteRequestId` (unique: one current selection per request), `insurerQuoteId`,
   `selectedAddOnCodes` text[], `acceptedConditionCodes` text[], `selectedAt`, `customerId`. Re-selecting replaces the
   row and writes history through the audit trail. Batch 14 reads it at payment.
6. **`quote_internal_notes`**: `id`, `requestProductId`, `insurerId`, `authorStaffId`, `body` (max 4000), `createdAt`.
   Append-only like `audit_logs` (no update or delete grant for the app role).
7. **`decline_reasons`** come from a new rule setting `QUOTE_DECLINE_REASONS`
   (`{ reasons: [{ code, customerText, internalText }] }`, provisional default with a short starter list), so the
   approved list is versioned and audited like every other rule. Also add `QUOTE_SLA_WARNING`
   (`{ hoursBeforeDue }`, provisional default 24) and `INSPECTION_EVIDENCE_SLOTS`
   (`{ slots: [...] }`, default front, rear, left, right, dashboard or mileage, engine bay).
8. **Inspections.** `inspections` gains: `purpose` (default `GENERAL` for existing rows), `quoteRequestId` →
   `quote_requests` (set null), `method`, `stage` (`InspectionTiming`), `predecessorId` → `inspections` (the
   reinspection chain), `result` (`PASSED | FAILED | null`), `resultReason`, `reportDocumentId` → `documents`,
   `decidedByStaffId`, `decidedAt`, `customerActionText`. New `inspection_request_products` links an inspection to the
   chosen versions it serves: `inspectionId`, `requestProductId`, unique on both; plus a partial unique that enforces
   rule 8, at most one open inspection per (`requestProductId`, `stage`), maintained by an `isOpen` boolean the
   service sets on every transition (Postgres cannot index a join to the inspection's status).
9. **Product versions** gain `reinspectionAllowed` boolean, default `false`. Existing approved versions keep the default
   and stay approved; the insurer revises to change it.
10. **Insurers.** Stop reading `insurers.isBestValue` anywhere a customer sees it (rule in B13.5). Leave the column for
    batch 18, which owns badges.
11. **Backfill.** Legacy requests with `QUOTED` move to `PARTIALLY_READY` or `QUOTES_READY` by the derivation above.
    Legacy quotes become `ACTIVE`. Customer-requested inspections become `purpose = GENERAL` and keep working as
    today.
12. **State history.** Add `QUOTE_REQUEST_PRODUCT` (if batch 12 has not) and `INSURER_QUOTE` to the entity types if
    the column is constrained.
13. Tests: the enum migration runs before the table migration on a populated database; the backfill maps every legacy
    row; a second open inspection for the same version and stage is refused by the index; internal notes refuse
    `UPDATE` and `DELETE` for the app role; components that do not sum to the premium are refused by the service.

### B13.2 Insurer actions on a chosen version (US-VEN-006, FR-IP-003)

All routes under `/insurer/quote-requests/:requestId/versions/:versionId/…`, tenant-scoped, audited, each running the
transition helper and recomputing the request status in the same transaction.

1. **Open or claim**: `POST …/claim` sets `INSURER_PROCESSING` and assigns the caller when nobody owns it. Any first
   insurer action does the same implicitly.
2. **Request more information**: `POST …/information-requests` with the customer message, typed questions, document
   kinds and a due date (no later than the reply due date plus a configured maximum; default 7 days). Moves to
   `VERIFICATION_REQUIRED`, pauses the clock, notifies the customer (`quote.information_requested`). The customer
   answers with `POST /quote-requests/:id/versions/:versionId/information` (answers validated against the questions;
   documents owned, scanned clean and of the requested kinds). Answering resumes the clock, moves back to
   `INSURER_PROCESSING` and tells the assigned officer by email. An unanswered request at its due date leaves the
   version as it is and puts it in the officer's "needs action" filter; it does not decline automatically.
3. **Decline** (new; batch 12 has none): `POST …/decline` with `reasonCode` (from `QUOTE_DECLINE_REASONS`), an optional
   customer note and an optional internal note. The customer sees the reason's customer text and the customer note.
4. **Return a quote**: the batch 12 quote route gains the full content: components, excess, add-ons with prices,
   conditions with the purchase-critical flag, an optional terms document, an optional inspection action, validity.
   The server checks the components sum to the premium, the premium is not below the PIA floor (batch 3, per version),
   add-on codes exist in the version's offered add-ons, and the insurer may take new business. Quoting a version whose
   rule blocks before quotation is refused until a pass serves it (rule 6).
5. **Withdraw or replace a quote**: `POST …/quote/withdraw` with a reason (moves the version back to
   `INSURER_PROCESSING`), and `POST …/quote/replace` with a full new quote (inserts the new quote, marks the old one
   `SUPERSEDED` with `supersededById`, keeps the version `QUOTED`). Both are refused once the quote is selected, paid or
   expired. A selected quote can be withdrawn only after the customer deselects it; batch 14 decides what happens to a
   quote with a pending provider payment. The customer is notified of both (`quote.withdrawn`, `quote.replaced`).
6. **Extend** stays as batch 12 built it, refused for a withdrawn, superseded or marked quote.
7. **Internal notes**: `POST …/notes` and `GET …/notes`, for any insurer role that may read the request; never
   included in a customer response.
8. **Ask for an inspection** (optional rules only): `POST …/inspection` opens an inspection for this version (B13.4)
   and moves it to `INSPECTION_REQUIRED`.
9. Permissions: add `portal:quote:decline`, `portal:quote:request-info`, `portal:quote:withdraw`,
   `portal:queue:assign` (`INSURER_ADMIN` only, and `QUOTE_OFFICER` for assigning to themselves),
   `portal:note:write` (`QUOTING`), `portal:note:read` (`READS_REQUESTS`). Update the permission-coverage e2e test so
   every new route is listed.
10. Tests: every row of the transition table, allowed and refused; a decline with an unknown code refused; internal
    note absent from every customer response and notification; components not summing refused; quote before a
    required pre-quote inspection refused; replace marks the old quote superseded and the customer sees only the new
    one as payable; withdraw refused after selection; another insurer's version is 404 and audited; a suspended
    insurer cannot claim, ask, decline or quote.

### B13.3 Queues, deadlines and warnings (US-VEN-005, FR-IP-007)

1. `GET /insurer/queue` returns this insurer's open chosen versions, one row each, with: request reference, product
   and version, owner, priority, age, reply due date (after pauses), SLA state (`ON_TRACK | DUE_SOON | BREACHED`),
   current state and required action. Filters: state, owner (me, unassigned, anyone), priority, SLA state, product,
   submitted date range; search by request reference or plate. Cursor pagination. Rate-limited like other bulk reads.
2. `POST /insurer/queue/:requestProductId/assign` (to a named staff user of the same insurer with a quoting role) and
   `…/priority`. Both audited.
3. **Jobs** on batch 6's runner, each idempotent per row and per day:
   - *SLA warning*: versions within `QUOTE_SLA_WARNING.hoursBeforeDue` of their due date and not yet warned. Sets
     `slaWarnedAt` and emails the owner, or the insurer's admins if unassigned, through the mail adapter with a
     versioned template.
   - *Time out*: open versions past their due date (paused time excluded) move to `TIMED_OUT`, the customer is told
     (`quote.version_timed_out`), the insurer's admins are emailed, and the request status is recomputed.
   - *Quote expiry*: `QUOTED` versions whose quote's `validUntil` has passed and which are not selected-and-paid move
     to `EXPIRED`; the customer is told.
4. A breach is shown in the portal queue as `BREACHED` until the version leaves the open states. InsurShield admins
   see breached and timed-out counts per insurer on the operations screen (read-only).
5. Tests: due date computed from the deadline version in force at submit; a pause moves the due date; a warning is sent
   once; a timed-out version can no longer be quoted; a quote expires at `validUntil`; assignment to another
   insurer's staff refused; queue filters return only this insurer's rows.

### B13.4 Inspections before quote and before payment (US-CUS-024, US-VEN-010 part one)

1. **Opening an inspection.** At submit (batch 12's submit, extended here), for each insurer, group its chosen
   versions whose rule is `REQUIRED` with timing `BEFORE_QUOTATION` or `BEFORE_PAYMENT`:
   - if any needs `PHYSICAL`, open one physical inspection serving all of them;
   - otherwise open one self-capture inspection serving all of them;
   - set the stage to `BEFORE_QUOTATION` if any served version needs it, else `BEFORE_PAYMENT`.
   This satisfies rule 7: physical meets self-capture, and before-quotation meets before-payment. `AFTER_PAYMENT`
   rules are left for batch 16. `OPTIONAL` rules open one only when the insurer asks (B13.2.8). Versions with
   `BEFORE_QUOTATION` move to `INSPECTION_REQUIRED`; `BEFORE_PAYMENT` versions stay quotable.
2. **Journey photos.** When the customer already captured the journey photos (`inspection_shots`) and the inspection
   is self-capture, attach them to the inspection's slots at submit, so the customer is not asked twice. The
   inspection stays `REQUESTED` until every slot in `INSPECTION_EVIDENCE_SLOTS` has a scanned-clean photo.
3. **Insurer portal routes** (`/insurer/inspections`, new permissions `portal:inspection:read` for `READS_REQUESTS`
   and `portal:inspection:manage` for `QUOTING`): list (filters: state, stage, method, due), detail (purpose, method,
   stage, schedule, served versions, evidence with short-lived links, report, full history), schedule (date, time,
   location), assign inspector (name and phone, shown to the customer), start, complete, upload report
   (`INSPECTION_REPORT` document kind, a new kind with retention class from batch 5), approve, fail with reason,
   mark no-show, cancel, request reinspection because the evidence is unusable. Each move uses the inspection
   transition table and is audited.
4. **Decisions and their effects**, in the same transaction as the decision:
   - *Approve*: every served version whose stage is satisfied is unblocked. `INSPECTION_REQUIRED` versions move to
     `INSURER_PROCESSING`. Before-payment versions record the pass so the payment gate (5) lets their quotes through.
   - *Fail*: every served version that does not allow reinspection moves to `DECLINED` with reason code
     `INSPECTION_FAILED`. Versions that allow it get a successor inspection (`predecessorId` set) in
     `REINSPECTION_REQUIRED` then `REQUESTED`.
   - *No-show, cancelled, unusable evidence*: a successor is opened for the served versions still unmet; the old
     inspection keeps its result.
   - *Decision 24*: a suspension cancels the open inspections whose every served version is cancelled, and removes
     cancelled versions from the rest. A restore reopens nothing.
5. **Payment gate.** Batch 12's payment re-check (`PaymentsService.pay`) gains one condition: when the paid quote's own
   version has a `REQUIRED` rule with timing `BEFORE_PAYMENT`, payment is refused with `INSPECTION_PENDING` until an
   approved inspection serves that version. A quote whose version does not need it is never held up by another
   version's inspection.
6. **Customer routes** (extend `InspectionsController`): the customer's inspections now include underwriting ones,
   with method, stage, the products they serve, schedule, inspector where assigned, status, customer action text and
   the reason after a fail. Photo upload to a slot (`POST /inspections/:id/photos/:slot`, owned document, scanned
   clean, one per slot, replaceable until `COMPLETED`). Customers can still change preferred date, time and location
   while the inspection is `REQUESTED` or `SCHEDULED`, as today; underwriting inspections cannot be created or
   cancelled by the customer (removing the product does that).
7. **Legacy.** Existing `GENERAL` inspections keep today's customer request flow. The insurer can now move them too,
   through the same portal routes, limited to inspections whose `insurerId` is theirs.
8. **Notifications**: `inspection.scheduled`, `inspection.inspector_assigned`, `inspection.approved`,
   `inspection.failed`, `inspection.reinspection_required`, `inspection.photos_needed`, through batch 6's service,
   each linking to the inspection and naming no sensitive detail.
9. Tests: grouping (physical plus self-capture gives one physical; before-quotation plus before-payment gives
   before-quotation; after-payment ignored); a second open inspection for one version and stage refused; a pass
   unblocks quoting for the versions it serves only; a fail declines only non-reinspectable versions and opens a
   successor for the others; no-show opens a successor; payment of a before-payment quote refused until a pass, and a
   quote of another version of the same request is not held up; journey photos fill the slots; a suspended insurer's
   inspections cancelled and not revived; another insurer's inspection is 404 and audited; a customer cannot approve
   or fail.

### B13.5 Customer tracking, comparison, selection and disclosure (US-CUS-013 tracking, US-CUS-014, US-CUS-015)

1. **Tracking.** The customer response for a request lists every chosen product with its state label from the table
   above, the expected next step, the due date where useful ("the insurer should reply by …"), any open information
   request with its questions, any inspection with its next action, and the decline or time-out reason. FR-TRK-001's
   ready, pending, declined, timed out, inspection required, more information and failed are all distinguishable.
2. **Comparison** (`GET /quote-requests/:id/comparison`): every `ACTIVE`, payable quote of the request in one shape:
   insurer and product, final premium, components, cover type and summary, excess, benefits and exclusions from the
   version's cover guide and comparison taxonomy items, add-ons with price and terms, conditions, inspection status,
   validity, and links to the quotation and terms documents. A value the insurer did not give is returned as
   `null` with `unavailable: true`, never a default. Pending, declined and timed-out products are listed beside the
   quotes, so the customer sees what is still coming.
3. **Sort and filter** (FR-CMP-004): final price, cover level, excess, inspection requirement, add-ons, status. The
   default order is final price ascending, ties by excess ascending then by insurer name, and the response says what
   the order is. There is no "recommended" or "best value" label until BR-012 is approved; `insurers.isBestValue` is
   not returned to customers.
4. **Selection** (`POST /quote-requests/:id/selection`): the customer picks one quote by id, chooses its optional
   add-ons and accepts every purchase-critical condition by code. The server refuses an unpayable quote (FR-CMP-003:
   expired, withdrawn, superseded, declined, marked under decision 24, insurer not taking new business) and refuses
   when a purchase-critical condition is not accepted. Selection sets the request to `QUOTE_SELECTED`. The customer can
   change or clear it until payment. Payment (batch 12's route) now requires the paid quote to be the selected one and
   charges premium plus the selected add-ons' prices, still computed by the server; batch 14 keeps this.
5. **Disclosure before purchase** (FR-CMP-005): the payment screen repeats the selected quote's excess, exclusions,
   selected add-ons and accepted conditions, with links to the documents.
6. Tests: each state shows its label; a missing value is `unavailable`; sort orders are stable and disclosed; no
   "best value" in any customer response; selecting an expired, withdrawn or superseded quote refused; selection
   without accepting a purchase-critical condition refused; payment of a quote other than the selected one refused;
   payment amount includes selected add-ons and ignores any client-supplied amount mismatch as today.

### B13.6 Web

WCAG 2.2 AA for every new or changed screen (keyboard use, focus order, labels, error association, contrast in both
themes, status changes announced politely).

1. **Customer.**
   - Request tracking page: one card per chosen product with its state, next step and due date; inline forms to answer
     an information request; a link to the inspection.
   - Comparison page rebuilt on the comparison route: side-by-side on wide screens, stacked cards on phones, sort and
     filter controls, pending products shown greyed with their state, "not provided" for missing values.
   - Selection flow: add-on toggles with price impact, condition acceptance checkboxes, a summary before payment.
   - Inspections page: underwriting inspections with method, stage, products served, schedule, inspector and photo
     slots (reuse `GuidedCapture` and `photoQuality` for capture).
2. **Insurer portal.**
   - Queue view (`RequestQueue.jsx`) with owner, priority, age, SLA badge, state and action; filters and search;
     assign and priority controls for those allowed.
   - Version detail: answers and documents the product asked for, information request history, internal notes panel
     (clearly marked "not visible to the customer"), actions: claim, ask for information, decline with reason, quote
     with components, add-ons and conditions, withdraw, replace, extend, ask for inspection.
   - Inspections tab: list and detail with the moves in B13.4.3, report upload and decision with reason.
3. **InsurShield admin.** Read-only per-insurer counts of breached, timed-out and manual-review versions; manual
   review controls for operations staff.
4. **Mock adapter** follows every contract, including the state derivation, so the mock Playwright lane exercises the
   same flows.
5. Tests: reducer and component tests for tracking, comparison sort and filter, selection with conditions, the queue
   filters and the inspection actions; Playwright on both lanes for: a request where one product times out, one is
   declined, one needs more information and then gets a quote; a before-quotation inspection that passes and unblocks
   a quote; a before-payment inspection that holds payment of one quote but not another.

### B13.7 Verification and records

1. `npm run lint`, `npm run test`, `npm run build`, API `tsc --noEmit`, API e2e, web Playwright mock and HTTP lanes.
   Report the numbers. Report any infrastructure-only failure separately.
2. The two reviews and the security hunt per package; confirmed findings fixed before the user approves the commits.
3. Update `apps/web/src/api/contracts.js`, `docs/INSURER_API_INTEGRATION.md` (the new delivery and callback event
   kinds, if insurer API events are added for information requests and inspection outcomes), the README for new
   settings, and the roadmap status line.

## Security and privacy

- Every new route is tenant-scoped (insurer) or owner-scoped (customer); refusals of foreign ids are audited.
- Internal notes are append-only, readable only by the owning insurer's roles, and never appear in customer responses,
  notifications, insurer API payloads or audit summaries.
- Information-request answers are stored only for questions the insurer asked, and shown only to that insurer.
- Inspection evidence and reports use batch 5's scanning, retention classes and short-lived download links; pre-loss
  evidence captured here stays immutable for batch 16's claim comparison.
- Jobs write audit entries as the `SYSTEM` actor with the rule version they applied.
- The queue and comparison routes are rate-limited; the comparison returns only the signed-in customer's request.

## Explicit boundaries

- Batch 14: payment provider, payment and issuance states, what happens to a selected quote when a provider payment
  is pending, settlement.
- Batch 15: renewal reminders and repricing.
- Batch 16: after-payment inspections, claim inspections, pre-loss and post-loss comparison.
- Batch 18: ratings, badges and any "recommended" label.
- No customer-to-insurer messaging; information requests are structured questions and answers (decision 3's
  approach, applied to quotes).
- No automatic decline when the customer does not answer an information request.

## Open questions for the user

These have provisional defaults so the batch can proceed; each default is a setting or a single rule that can change
later without a migration.

1. **BR-005, the reply clock.** Does time waiting for the customer (more information, inspection) stop the insurer's
   reply deadline? Default: yes, it pauses.
2. **BR-005, timed out.** After a version times out, may the insurer still reply late? Default: no; the customer
   requotes.
3. **Decline reasons.** Who supplies the approved list and its customer wording? Default: a provisional starter list
   in `QUOTE_DECLINE_REASONS` (risk outside appetite, vehicle not eligible, information not provided, inspection
   failed, other), confirmed by compliance before release.
4. **BR-007, reinspection.** Is reinspection allowed by default for new products? Default: off unless the insurer sets
   `reinspectionAllowed` on the version.
5. **SLA warning.** How long before the due date should the warning go out, and who receives it? Default: 24 hours,
   to the owner or else the insurer's admins.
6. **Waiting for all quotes.** Can a customer select and pay while other chosen products are still pending (US-CUS-014
   allows it "unless the approved rule requires waiting")? Default: yes.

## Size and split

L in the roadmap; with the inspection model it is closer to XL. If it splits, split after B13.3: the workflow, queues
and comparison (B13.1 to B13.3, B13.5 and their web parts) first, then the inspection model and payment gate (B13.4
with its web part). The first half must still refuse to quote a version whose rule blocks before quotation, with the
message "inspection needed, the insurer will contact you", so no product is quoted against its own rule in between.

## Delivery in parts

Batch 13 is delivered in three pull requests, so each one can be reviewed and tested on its own.

### Part 1: the per-product workflow (this pull request)

What it builds:

- `QuoteProductStatus` with all ten states, stored as `status` on `quote_request_product_versions`, with
  `statusChangedAt`, `replyDueAt`, `pausedAt`, `declineReasonCode` and `declineCustomerNote`. Migration 0033 backfills
  every existing row from its facts: `QUOTED` where a quote exists (unless decision 24 cancelled it before payment),
  `CANCELLED` where it was cancelled, `INSPECTION_REQUIRED` with the clock stopped where the rule needs an inspection
  before quotation, and `SUBMITTED` for the rest. Existing rows take the request's `expiresAt` as their reply due date.
- The transition table in `src/customer/domain/quote-workflow.ts`, tested row by row, and `QuoteWorkflowService`, which
  applies a transition only from the state it was decided from and writes it to the state history as
  `QUOTE_REQUEST_PRODUCT`.
- At submit, each chosen product starts `SUBMITTED` (or `INSPECTION_REQUIRED` with its clock stopped) and is due by the
  `QUOTE_REPLY_DEADLINE` rule in force at that moment.
- Insurer actions on one chosen product: decline with a reason from the new `QUOTE_DECLINE_REASONS` rule, ask the
  customer a question (the clock stops), and append-only internal notes. Quoting is refused while an inspection is
  needed and once the reply deadline has passed with the clock running.
- The customer answers a question from the comparison page; the clock starts again and the due date moves on by the
  time spent waiting.
- An hourly sweep times out products nobody answered and expires unpaid quotes past their validity, telling the
  customer each time. Decision 24 now cancels open and unpaid quoted products and closes any open question.
- Four new notification templates: `quote.version_declined`, `quote.information_requested`, `quote.version_timed_out`
  and `quote.expired`.
- Web: the portal shows each product's state, a panel to ask, decline and keep notes, and hides the quote form while
  an inspection is needed. The customer sees each product's state, the decline reason in the approved customer
  wording, and answers questions in place. The browser-only prototype does the same.

Where part 1 differs from the plan above, on purpose:

- The request-level status is not derived yet. Requests keep `SUBMITTED | QUOTED | EXPIRED`; each product's own state
  is what the customer and the insurer see. Deriving the request status moves to part 2 with the comparison work.
- Answers are text only. Typed questions and document answers come with part 2, because answer documents have to be
  added to the document access rules first.
- `INSURER_PROCESSING` is reached when the customer answers. Claiming a product, assignment, priority, SLA warnings and
  the queue endpoint are part 2.
- A question's answer window is 1 to 14 days, set by the insurer; it is not tied to the reply due date yet.
- The insurer's officer is not emailed when the customer answers; the portal shows the answer on the next load.
- `MANUAL_REVIEW` exists in the enum but nothing moves a product into it yet.

### Part 2a: the insurer's queue (delivered)

- A product has an owner (`assignedStaffId`, `assignedAt`), a priority (`NORMAL | HIGH`) and `slaWarnedAt`
  (migration 0034).
- `POST .../claim` takes an unowned product and starts work on it (`SUBMITTED` to `INSURER_PROCESSING`). The first
  quote, question or decline on an unowned product also makes the person who did it its owner.
- `POST .../assign` and `POST .../priority`: any quoting role may assign to themselves; only `INSURER_ADMIN` assigns
  to a colleague, clears an owner or changes priority. A colleague must be an active member of the same insurer with a
  quoting role.
- `GET /insurer/queue` lists this insurer's open products, urgent first then by due date, with owner, priority and
  deadline state (`ON_TRACK | DUE_SOON | BREACHED | PAUSED`). Filters: status, owner (me, unassigned, any), priority,
  deadline state, and a search on request reference or plate. It returns at most 200 rows; cursor paging waits until a
  real insurer's queue needs it.
- The hourly sweep emails the owner, or the insurer's administrators when nobody owns it, once per product, when the
  reply is due within the new `QUOTE_SLA_WARNING` rule (default 24 hours). The email is a job, so a mail outage delays
  it rather than losing it. Its wording is in code for now, because notification templates are for customers only.
- Web: owner, urgency and deadline on each queue row; All, Mine and Unassigned views; take, assign and priority
  controls on the product panel.

### Part 2b: quote content, changes and the customer's choice (delivered)

- `insurer_quotes` gains `status` (`ACTIVE | WITHDRAWN | SUPERSEDED`), the withdrawal time and reason, the quote that
  replaced it, a premium breakdown, an excess, add-ons and conditions (migration 0035). Only one quote per chosen
  version is current; withdrawn and replaced ones stay as history and never reach the customer as offers.
- A quote's breakdown, when given, must add up to the premium. An add-on must be in the `ADD_ON_CATALOGUE` rule in
  force. Each condition says whether it is purchase-critical.
- `POST .../quote/withdraw` (with a reason) takes a quote back and returns the product to `INSURER_PROCESSING`.
  `POST .../quote/replace` stores a new quote and marks the old one superseded. Both are refused once the customer has
  chosen or paid for the quote, or it has expired, and the customer is told either way (`quote.withdrawn`,
  `quote.replaced`). Extending, the expiry sweep and payment only ever see the current quote.
- `POST /quote-requests/:id/selection` records the quote the customer chooses and the conditions they accept, in the
  new `quote_selections` table. Every purchase-critical condition must be accepted, and payment of a quote with one
  is refused until a selection of that quote accepted it.
- Each request response carries `progress` (`SUBMITTED, INSURER_PROCESSING, PARTIALLY_READY, QUOTES_READY,
  QUOTE_SELECTED, NO_QUOTES, CANCELLED`), worked out from its products by one pure function, and the selection.
- Web: the quote form takes an excess and conditions and can replace a sent quote; sent quotes can be withdrawn with a
  reason. The customer sees the excess and conditions, ticks the required ones to choose a quote, and can sort by
  price or excess.

Where part 2b differs from the plan above:

- `progress` is computed in the response, not stored, so it can never fall out of step with the products. The stored
  request status keeps its three values for older requests.
- Add-ons are shown with their prices, but choosing optional add-ons and paying for them waits for batch 14, which
  owns the payment total. The premium breakdown and add-ons are taken by the API; the web form sends only the excess
  and conditions for now.
- Sorting is by price (the default, as disclosed) or excess, in the browser. There is no comparison endpoint yet.

### Part 3: optional inspections (delivered)

The insurers confirmed that an inspection is not needed under normal circumstances: the live photos the customer
takes in the journey are enough. So an inspection is **optional and never affects buying insurance**. This replaces
rules 6 and 8 above and the payment gate in B13.4.5.

- Migration 0036: inspections gain a purpose (`GENERAL` for the existing customer appointments, `UNDERWRITING`), the
  request, method and stage, the inspection they repeat, and the result with its reason and who decided it.
  `InspectionStatus` gains `CANCELLED` and `NO_SHOW`. The new `inspection_request_products` table links an inspection
  to the products it serves. Product versions gain `reinspectionAllowed`, default off.
- At submit, each insurer gets one optional inspection for its products whose terms ask for one. Every product still
  starts waiting for its insurer and can be quoted at once.
- The insurer can book, staff and record a result from `/insurer/inspections` (`portal:inspection:read` and
  `portal:inspection:manage`). A missed or cancelled appointment is booked again. A fail is recorded and declines
  nothing by itself; the insurer declines the product through the normal decline action if it wants to.
- Payment never waits for an inspection.
- Migration 0037 releases any product that 0033 had held for an inspection, moving its reply due date on by the time
  it was held.
- The customer's inspection list shows these inspections, says they do not hold up the purchase, and shows the reason
  after a fail. The customer is told when one is booked, passed, failed or booked again.
- Web: an optional Inspections section in the insurer portal, and the customer's inspection detail shows the new facts.

Left for later: a separate photo upload per inspection slot and inspection reports (batch 16), and the insurer asking
for an inspection on a product whose terms do not.
