# Batch 4 — audit trail and state history

## Outcome

Every business write produces an immutable, transaction-bound audit entry. State changes for quote requests, policies, claims, NCD applications and inspections also produce a consistent state-history entry. Administrators can search the trail without being able to alter it.

## Scope

- Reuse `audit_logs`, adding an event note, correlation identifier, search indexes and database-level append-only protection.
- Add `state_history` for the five workflow entities and `pia_config_history` so the current PIA floor is no longer the only record of its changes.
- Add one shared audit writer and one shared state-transition writer. Both receive the caller's trusted server-side principal and the existing database transaction.
- Write the trail for customer quote/renewal/requote, payment and policy creation, insurer quote/certificate/claim/NCD actions, inspection request and update, insurer administration, PIA changes, document upload, consent acceptance and account closure.
- Move quote extension and claim acknowledgement into transactions before adding their audit writes.
- Add a staff-only, cursor-paginated `/admin/audit-logs` view with filters and an admin-console section.

## Privacy and security rules

- Audit records store allowlisted operational facts only. They never store passwords, session tokens, insurer integration credentials, raw mobile-money details, signed document URLs or full claim narratives.
- Actor identity comes from the resolved authenticated principal, never a request field.
- The database rejects `UPDATE` and `DELETE` against `audit_logs`; the migration also revokes those operations from `PUBLIC`.
- The API exposes summaries and changed field names, not raw `before` and `after` JSON.

## Acceptance checks

1. A successful workflow write and its audit/state entries commit together; a failed transaction produces neither.
2. Direct updates or deletes of `audit_logs` fail at the database.
3. PIA updates append a historical record and retain the previous value.
4. Admins and super admins can filter and cursor through audit summaries; other roles receive no access.
5. Existing customer, insurer, payment, inspection and admin journeys retain their established outcomes.

## Deliberate boundary

Object storage is outside the PostgreSQL transaction. Document metadata and its audit entry are still one database transaction; storage scanning, retention and orphan cleanup are Batch 5 work.
