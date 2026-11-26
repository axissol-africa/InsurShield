# Governed customer content

US-ADM-011 / FR-ADM-006: plain-text FAQ, NOTICE and LEGAL information for the customer Support page. This module does not change consent/agreement versions or create legal policy wording. Partner contacts remain sourced from the controlled insurer directory. Existing Support FAQs are separate platform defaults; governed slugs are independent publications and do not override those defaults.

All paths below are relative to `/api/v1`. Five staff routes require `admin:content:manage`, enforced in both controller and service. The one public read uses the existing public-read rate limit.

| Method | Path | Input / output |
| --- | --- | --- |
| GET | `/customer-content/public` | `{ items: PublicVersion[] }` |
| GET | `/customer-content/admin?page=1` | `{ items: StaffVersion[], page, hasMore }`, 20 versions per page |
| GET | `/customer-content/admin/:slug/history` | `{ items: StaffVersion[] }`, descending version |
| POST | `/customer-content/admin/:slug/versions` | `{ type, title, body, effectiveFrom, expiresOn?, expectedVersion }` → StaffVersion |
| POST | `/customer-content/admin/:slug/versions/:id/approve` | empty body → StaffVersion |
| POST | `/customer-content/admin/:slug/versions/:id/withdraw` | `{ reason }` → StaffVersion |

PublicVersion: `id, slug, type, version, title, body, effectiveFrom, expiresOn`.
StaffVersion additionally: `status, audience, channel, ownerStaffId, approvedByStaffId, approvedAt, withdrawnByStaffId, withdrawnAt, withdrawalReason, createdAt`.

Types: `FAQ | NOTICE | LEGAL`. Statuses: `DRAFT | APPROVED | WITHDRAWN`. Audience/channel are fixed to `CUSTOMER` / `SUPPORT` for this supported publishing surface. Business dates are `YYYY-MM-DD`, timestamps ISO, absent values null. Slugs are lowercase hyphen-separated alphanumeric strings (maximum 100 characters). Titles, bodies and withdrawal reasons have limits of 200, 20,000 and 2,000 characters respectively. HTML and non-whitespace control characters are rejected.

Creation appends immutable wording and dates, assigning the authenticated staff member as owner. `expectedVersion` is zero for a new slug, or the latest historical version number thereafter. The slug's content type cannot change. Approval requires another staff member and the latest draft. All writes serialize on the same transaction advisory lock for that slug, including first creation, and audit in the transaction. No content, history or audit is deleted. Withdrawal is allowed for any nonwithdrawn version with a reason; repeated decisions return conflict.

The public reader selects the latest approved version whose effective date has arrived in Lusaka, then checks expiry (inclusive through that Lusaka date). It never falls back from expired copy. Withdrawing an approved version immediately tombstones older publications, even if the withdrawn approval was scheduled for the future. Withdrawing a draft does not retire an existing publication. A higher approved version can publish new wording after retirement. New drafts and future approvals leave the current publication visible.

Stable errors: `CONTENT_VERSION_CHANGED`, `CONTENT_TYPE_CHANGED`, `CONTENT_EXPIRED` (409); `CONTENT_SELF_APPROVAL` (403); `CONTENT_DATES_INVALID`, `CONTENT_TEXT_INVALID` (400), plus standard authorization, DTO-validation and not-found errors.

The web adapter method is `api.customerContent.published()`. Support renders text, not HTML, clears old results on failed refreshes, reloads on focus and every minute, and ignores superseded responses. No server-query dependency exists in this baseline; the local hook follows existing Support fetching conventions without adding a dependency. Browser display can remain visible until the next refresh; publication eligibility is authoritative at each API read.
