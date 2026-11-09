# Batch 5: Documents and the provider gate

## Purpose

Make every uploaded file safe before any later batch starts adding files. Each upload is scanned before it reaches
the bucket, each stored document carries the retention class its kind belongs to, each download is short-lived and
recorded, and the platform refuses to start in production while any outside provider is still a local stand-in.

This batch changes no customer journey, no insurer workflow and no pricing. It adds a refusal path for an infected
or unscannable upload, and the gate that stops a stand-in from reaching production.

## Starting point

Verified in the code on `main` at `f85491c`:

- `src/documents/` already validates the declared type against an allowlist, enforces `MAX_UPLOAD_BYTES` at Multer
  and at the service, checks the leading bytes against the declared PDF/JPEG/PNG format, stores a SHA-256 checksum,
  and writes a `document.uploaded` audit entry in the same transaction as the metadata row.
- `src/storage/` keeps bytes in private object storage (MinIO locally, S3 in production), hands out only time-limited
  signed URLs with an attachment disposition, and reports bucket reachability to `GET /health/ready`.
- `documents` has no scan state, no retention class and no scan provenance. Nothing in the API scans anything.
- No registry of outside providers exists, so nothing prevents a production start on a stand-in.
- Document access is already principal-related (`findVisibleTo`), and a document may be attached once (`lockForAttach`).

## Delivery order

Every numbered package starts by adding a failing behaviour test, then applies the smallest durable fix.

### B5.1 The provider gate (decision 4)

1. Add `src/common/providers/`: a registry each adapter registers with at module init, declaring its provider name
   and whether it is running `live` or as a `stand-in`. The registry holds names and modes only, never credentials.
2. Refuse to finish bootstrap when `NODE_ENV` is `production` and any registered provider is a stand-in. The failure
   names the providers and the setting that selects each one; it never prints a value.
3. Log the registered providers and their modes once at startup outside production, so a developer can see what is
   simulated.
4. Register object storage as `live`, and the two systems already simulated today — RTSA plate lookup and payment
   confirmation — as stand-ins, so the gate covers what exists rather than advertising protection it does not give.
   A registration names no setting while no live adapter exists to select. Later batches replace each with its live
   adapter (email in 6, RTSA and insurer APIs in 11, payments in 14), with no second gate. (Widened from registering
   storage alone, 2026-11-09.)

### B5.2 The malware-scan port and its stand-in

1. Define the port around the operation the use case needs: scan these bytes, answer `clean`, `infected` with the
   signature name, or `unavailable`. No scanner SDK is introduced in this batch.
2. Add the stand-in adapter, selected by `MALWARE_SCANNER=stand-in`. It answers `infected` for the EICAR test string
   and `clean` otherwise, so the refusal path is provable locally and in CI without a scanner service.
3. Leave the live adapter unimplemented and unselected. The gate of B5.1 is what keeps the stand-in out of
   production, and the port is what batch 20 implements against.
4. The scanner is called with the in-memory buffer, before the bytes reach the bucket and before any transaction is
   opened, so no transaction is held open across a network call and infected bytes are never stored.

### B5.3 Scan state and retention class on the document record

1. Migration: add `scanStatus`, `scannedAt`, `scannerName` and `retentionClass` to `documents`, with an index on
   `scanStatus`. Existing rows backfill to `UNSCANNED`; they are prototype uploads and stay unreadable by design.
2. Upload refuses an `infected` result with a stable code and a plain message, deletes nothing (nothing was stored),
   writes a `document.rejected` audit entry naming the kind and the signature, and never records the file name.
3. Upload refuses an `unavailable` result the same way with its own code. The upload fails closed; a scanner outage
   never produces a stored, unscanned document.
4. A clean upload stores the object, then commits the metadata row with `scanStatus = CLEAN`, the scan time and the
   scanner name, alongside the existing audit entry.
5. Derive `retentionClass` from the document kind through one domain function and store it on the row, so a later
   change to the mapping cannot rewrite the class of a document already kept. The durations remain batch 10's
   settings and the deletion job remains batch 15's work.

### B5.4 Protected downloads

1. `GET /documents/:id` answers `404` for a document the principal is unrelated to, as now, and refuses a document
   whose `scanStatus` is not `CLEAN` with a distinct code. A record embedded in a list or detail response instead
   keeps its description and carries no link, so one unscanned document cannot fail a whole page; `url` is already
   optional in `apps/web/src/api/contracts.js`, so this needs no contract change. (Clarified after the first
   implementation refused on both paths and broke policy and claim lists, 2026-11-09.)
2. Lower the signed-URL lifetime for document downloads to the shortest that still works for a browser fetch, by
   lowering the default of the existing `S3_SIGNED_URL_TTL_SECONDS` (300 to 60) rather than adding a second setting,
   and keep the attachment disposition.
3. Write a `document.downloaded` audit entry each time a link is issued, carrying the document id, kind and the
   principal. The signed URL itself is never audited, logged or returned in an error.
4. Apply the shared rate limiter to the download route as it is already applied to upload.

### B5.5 The browser side

1. Show the rejection as its own message: an infected file tells the customer the file was refused and to upload a
   different one; a scanner outage tells them to try again shortly. Neither leaks a signature name.
2. Keep the existing size and type messages unchanged, and keep the upload control usable after a refusal with the
   previously entered form values preserved.

### B5.6 Coverage, configuration and documentation

1. API unit tests for the registry, the gate's production refusal, the stand-in adapter and the kind-to-class mapping.
2. API e2e tests for a clean upload, an EICAR refusal, a scanner-outage refusal, a download of a non-`CLEAN` document,
   the download audit entry and the unchanged visibility rules. `test/builders.ts` creates documents as `CLEAN`.
3. A web regression covering the refusal message on the upload screens.
4. `apps/api/.env.example` documents `MALWARE_SCANNER` and the download lifetime with `CHANGE_ME` placeholders where
   a value is environment-specific, and the README Configuration table gains both.

## Privacy and security rules

- Audit entries for scanning and download carry the document id, kind, principal and signature name only. No file
  name, storage key, checksum or signed URL.
- A refused upload leaves nothing in the bucket and nothing in `documents`; only the audit entry records that it
  happened.
- The scanner adapter receives bytes and returns a verdict. It never receives the principal, the document kind or
  any customer record.
- The gate's refusal message names providers and settings, never secrets.

## Acceptance checks

1. A clean upload stores the object and commits a `CLEAN` row with its scan provenance and retention class.
2. An EICAR upload is refused, nothing is stored in either the bucket or the database, and the rejection is audited.
3. A scanner outage refuses the upload rather than storing it unscanned.
4. A document that is not `CLEAN` cannot be downloaded by anyone, including staff.
5. Requesting a document through `GET /documents/:id` writes an audit entry; the link is absent from every log and
   response field but the URL. Links embedded in a list or detail response are not audited individually: a policy or
   claim list signs one per attachment, and recording each would bury the deliberate reads it exists to show.
   (Amended with the user's approval, 2026-11-09.)
6. A production start fails while any registered provider is a stand-in, and succeeds when all are live.
7. Existing customer, insurer, payment, inspection and admin journeys keep their established outcomes.

## Deliberate boundaries

- No live scanner is implemented, and no scanner dependency is added. Batch 20 selects and implements it against this
  port.
- Retention durations and the scheduled deletion job stay in batches 10 and 15. This batch stores the class and
  nothing more. It does compensate its own failures: an upload whose metadata insert fails deletes the object it had
  already stored, so this batch leaves no orphan of its own making. (Resolves the contradiction with
  `batch-4-audit-trail-state-history.md`, which placed orphan cleanup here, 2026-11-09.)
- Scanning stays synchronous with the upload. The job runner arrives in batch 6; moving scanning onto it is not part
  of this batch and is not needed while uploads are small.
- Encryption at rest beyond the existing `S3_SSE` configuration stays in batch 20.

## Needing the user's decision before B5.3

1. The retention class names and the kind each one covers. Proposed: `UNDERWRITING_EVIDENCE` for `QUOTATION`,
   `WHITE_BOOK` and `INSPECTION_PHOTO`; `POLICY_EVIDENCE` for `CERTIFICATE`; `CLAIM_EVIDENCE` for `CLAIM_ATTACHMENT`
   and `NCD_EVIDENCE`; `BRAND_ASSET` for `INSURER_LOGO`.
2. That existing prototype documents backfill to `UNSCANNED` and become undownloadable. The alternative is marking
   them `CLEAN`, which would record a scan that never happened.

## Completion evidence

- Lint, type check, build, API unit tests, API e2e tests and the real-API web journey pass, with counts reported.
- The migration applies on a fresh database and on one holding existing documents, and its catalog and snapshot
  checks pass.
- Both reviews and the security hunt are complete for every package, with confirmed findings fixed.
- Accessibility checks (WCAG 2.2 AA, NFR-ACC) pass on the upload screens this batch changes.
