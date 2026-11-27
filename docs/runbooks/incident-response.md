# Alerts and incident response

Use the approved on-call directory and incident policy. This document defines handoff content and technical triage; it does not appoint responders, establish regulatory deadlines or authorise production changes.

## Alert triggers and routing

The environment owner must configure and exercise each applicable alert, including its threshold, evaluation window, routing destination, backup contact and acknowledgement/escalation interval. The table lists conditions to monitor, not claims that alarms already exist. Set operational thresholds through the approved monitoring policy. Requirements specify at least 99.5% monthly availability excluding approved maintenance unless contractually changed; that monthly target is not a paging window.

| Trigger | First action and owner | Runbook / escalation |
| --- | --- | --- |
| `/health` unavailable or repeated process restarts | Operations checks process, routing and recent change | [Environment operation](environment-operation.md); incident commander for user impact |
| `/health/ready` returns 503, times out, or either dependency is down | Operations separates DB and bucket failures; preserve safe response and timestamp | [Recovery](backup-and-recovery.md) if data loss/recovery is suspected; DB/storage owner |
| Error rate, latency or failed critical journey exceeds approved threshold | Application owner correlates route, release, dependency and correlation ID without private payloads | Incident commander; integration owner if provider-dependent |
| Backup fails, usable recovery coverage is missing, or its age threatens approved RPO | DB/storage operator checks last recoverable matched set and key access | Recovery runbook; service owner for recovery exposure |
| Restore exercise fails, checksum/version mismatch or required object missing | Stop recovery acceptance; preserve both copies and inventory | Recovery runbook; application/storage owners and Security if integrity is suspect |
| Job failure/exhaustion, overdue due-work, expiring lease without progress, or delivery backlog exceeds approved age | Application/integration owner checks persisted status, attempt and error safely | Reconcile before retry; Finance for financial effects; no blind bulk replay |
| Payment/issuance mismatch or unresolved financial exception exceeds approved age | Finance/integration owner checks provider records and accountable exception owner | Incident commander if customers or money are affected |
| Unexpected access pattern, authorisation failure surge, MFA/session anomaly, or suspected tenant-boundary breach | Security preserves evidence and assesses scope | Privacy/security procedure below; Legal/Compliance for suspected personal-data impact |
| Public bucket access, encryption/key failure, or unexpected backup/region policy change | Security and platform owner assess exposure and containment | Privacy/security procedure and environment evidence review |
| Audit-write failures, missing expected audit continuity, or repeated retention failures | Application owner checks safe error logs and affected workflow | Security/Compliance for evidence or hold impact; recovery owner if corruption suspected |
| Alert delivery failure or no owner acknowledgement within approved interval | Operations uses the approved alternate route | Backup on-call / incident commander; record the monitoring gap |

Health checks are narrow signals. Successful readiness does not prove job progress, provider delivery, correct document bytes or successful business workflows. The job runner logs startup failures, tick failures and exhausted attempts; monitoring their logs and persisted job state requires environment instrumentation. Do not assert a metrics endpoint or alarm integration that has not been demonstrated.

## Incident sequence

1. Record incident ID, detection source, UTC detection and estimated impact start, affected environment/release, affected journeys and safe correlation references. Assign a commander and severity using the approved policy; record uncertainty rather than guessing scope.
2. Acknowledge the alert and notify the designated owners through approved channels. If the primary contact does not acknowledge within the policy interval, escalate through the documented backup route. A missing directory or unstaffed route is an operational blocker, not a reason to invent a recipient.
3. Preserve relevant logs, configuration versions, audit records and provider references with access controls and an evidence timeline. Do not put tokens, credentials, customer details, full storage keys or signed links in broad incident channels.
4. Assess containment and recovery options. Record the decision, authoriser, operator and expected effect. Avoid restarting/replaying blindly when the outcome of external operations is uncertain. Use the recovery runbook for loss, corruption or restore; preserve the original evidence source.
5. Track each action with owner, status, timestamp and outcome. Give the receiving shift a written handoff and obtain acknowledgement. Communications use the approved cadence, audience and templates; operational investigation does not authorise public statements.
6. Validate recovery against the affected journeys and approved service scope, reconcile outstanding effects, and obtain service-owner acceptance. Record residual risks and observation period. Complete a post-incident review with causes, alert gaps, measurable follow-up actions, owners and agreed dates.

## Suspected privacy or security breach

NFR-PRI-001 and DEC-011 require the approved legal/regulatory position. Before go-live, Legal/Compliance and Security must provide a current procedure reference, named decision-makers and deputies, jurisdiction/contract applicability, notification criteria and clocks, approved recipients/channels, content approval, evidence/hold requirements and record-retention rules. These facts are currently not established by DEC-011. Do not insert a guessed statutory deadline.

On suspicion:

1. Open a restricted incident record and alert Security plus Legal/Compliance through the approved escalation route. Record discovery/awareness times and the source accurately; preserve the original timeline as facts change. Do not wait for complete attribution before escalating suspicion.
2. Security assesses access paths, affected data categories, systems, tenants, records and possible exfiltration. Mark estimates as estimates. Collect only necessary evidence under the approved chain-of-custody procedure; record collector, source, UTC time, integrity hash where applicable, access and transfers.
3. Execute proportionate containment under the approved incident authority: for example, isolate the affected interface or revoke compromised access through supported controls. Preserve evidence before destructive action when safe. Avoid broad deletion, manual audit edits or sweeping account changes that would erase evidence or exceed incident authority.
4. Legal/Compliance determines whether the facts meet notification duties and which procedure, jurisdiction, contractual rules and timing apply. Record its decision, legal/procedure reference, applicable clock start and deadline if one applies, approver and uncertainty. Operations must not mark “no notification required” merely because scope is unknown.
5. Authorised communicators send only approved notices to the approved recipients and keep dispatch/receipt evidence. No runbook-defined recipient list or deadline replaces the approved legal procedure. If that procedure/contact is missing during an incident, escalate the gap to the accountable Legal/Compliance/Security owners while preserving evidence and taking authorised containment steps.
6. Coordinate retention/holds and data-subject actions with Compliance. Use controlled workflows and existing retention fences; do not use a privacy case as an automatic deletion command. Do not clear holds or purge backups to simplify incident cleanup.
7. Security verifies containment and restoration; Compliance reviews notification follow-through and preservation duties. Service-owner acceptance, residual-risk decisions and closure records are required before closure. Follow-up reviews include recurrence prevention and any changes to approved procedures.
