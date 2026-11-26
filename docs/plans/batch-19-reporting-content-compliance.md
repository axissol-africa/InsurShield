# Batch 19 reporting, content and compliance

[Roadmap](roadmap.md#batch-19-reporting-content-and-compliance) |
[Requirements](../requirements-spec.md) |
[Acceptance criteria](../user-stories.md)

## 1. Manage customer content and notifications

- Add a versioned workflow for FAQs, notices and legal information. Staff can draft text, record who owns it and when it applies, submit it for independent review, and withdraw an approved version. Customers see only effective approved content. Existing insurer directory contacts continue to come from the controlled insurer record.
- Bring notification copy into the same approval discipline. Keep event keys, channel, category and preference rules tied to the existing delivery contract. Allow placeholders only where the event supplies them. Record the template version on generated messages and keep sent history intact.
- Give administrators a restricted view of delivery exceptions, including event, template version, retry state and a safe reason. Preserve protected links and the existing delivery runner.

## 2. Review privacy requests and retention

- Give compliance staff a private case register to record requests, verified identity, an accountable owner, the legal decision and completion evidence. Keep case data and reasons out of customer and insurer reports.
- Apply approved holds through the existing retention fences. Hold creation, scheduled deletion and release must preserve a consistent outcome if they run at the same time. Continue to use established retention jobs for irreversible operations.
- Record staff reads of the privacy register and audit trail before returning results. The immutable log records the reader and safe scope details. DEC-011 still governs formal privacy and retention policy.
- Audit denied attempts by signed-in users to open the audit trail or privacy register. Leave the requested record reference out of the log.

## 3. Review risk flags

- Give authorised staff a queue for referrals tied to verified platform records, with evidence, urgency, an owner and a next action.
- Record the reviewer's outcome, evidence and reason in the history. A flag alone has no effect on quote, payment, policy or claims eligibility. Automatic signals require approved risk rules.

## 4. Report operations and finance

- Give platform administrators an aggregate operational report and insurer staff a role-appropriate view of their own organisation. Define each cohort and its date basis. Use bounded periods and Lusaka calendar dates.
- Keep financial figures on the approved ledger and settlement records. Restrict the finance report to finance roles and existing authorised insurer administrators. New commercial terms require DEC-013 approval.
- Audit report and export access, filters, generation time and format. Keep customer identifiers and free text out of aggregate exports. Regulator filing formats and submissions require approved specifications.

## Verification

Check permissions, insurer isolation, private case data, report cohort boundaries and exports, unpublished and expired content, notification preferences and version selection, identity verification, concurrent state changes and deletion fences. Exercise the staff workflows on desktop and mobile with the existing design system.
