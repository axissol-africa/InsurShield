# Review appeals API

All paths below have the application's `/api/v1` prefix. `ReviewAppealsModule` is registered by the app owner.

| Audience | Base path | Permission |
| --- | --- | --- |
| Customer | `/review-appeals` | `review:manage` |
| Insurer administrator | `/portal/review-appeals` | `portal:review:manage` |
| Moderator | `/admin/review-appeals` | `admin:review:moderate` |

Customer and insurer `POST` bodies: `{ decisionId, reason, evidence? }`. The decision ID comes from the main reviews workflow. Reason is nonblank, at most 2,000 characters; evidence is optional plain text, at most 10,000 characters. Returns the created appeal with HTTP 201. There is one appeal per decision and party, including after private content expires.

`GET` returns up to 20 scoped appeals per page. Pending appeals appear first, then closed appeals, newest first in each group. Use `page` starting at 1 or filter by `decisionId`. Customer and insurer reads include their own party's appeals. Admin reads additionally include `reviewId` for legal-hold controls.

Appeal fields: `id`, `decisionId`, `party` (`CUSTOMER` or `INSURER`), `reason`, `evidence`, `createdAt`, `dueAt`, `decidedAt`, `outcome`, `outcomeReason`, `purgedAt`. Timestamps are ISO strings or null; `dueAt` is a Lusaka calendar date (`YYYY-MM-DD`). No customer/policy identifiers, moderator identities, or original review text are included in these views.

`POST /admin/review-appeals/:id/resolve` takes `{ outcome: "UPHELD" | "OVERTURNED", reason }` and returns HTTP 201 with the appeal plus `applied`. `applied` indicates whether overturning changed the revision; stale, withdrawn, superseded, or purged content is never resurrected. Restorations require confirmed effective policy and the main review publication text check. The original decision author cannot resolve the appeal. Customer outcomes enqueue `REVIEW_APPEAL_DECIDED` in the same transaction; insurer outcomes appear in portal reads.

`PATCH /admin/review-appeals/reviews/:reviewId/legal-hold` takes `{ held: boolean }` and returns `{ reviewId, held }` with HTTP 200. Holds, appeals, resolutions, withdrawal/moderation, and retention must serialize on the parent `insurer_reviews` row. Customer writes acquire `assertOpenCustomer` before that row.

Retention runs only under an active confirmed `REVIEW_POLICY`. It waits for the latest case-wide retirement, decision, withdrawal, or appeal-closure trigger plus `privateRetentionDays`, and for all decision appeal windows to end. Open appeals and legal holds prevent purge. Purge clears retired review ratings and text and the private fields of closed appeals. Closed appeal `outcomeReason` becomes `Private content expired`. Decision and duplicate-prevention metadata remain available.
