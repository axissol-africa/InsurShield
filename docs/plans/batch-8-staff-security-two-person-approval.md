# Batch 8 — Staff security and two-person approval

## Purpose

Batch 8 makes staff access safer and prevents one person from making a high-risk platform change alone. It implements roadmap Batch 8, `NFR-SEC-002`, `FR-ADM-003`, decision 10 (staff email-code MFA) and decision 12 (audited support password resets).

## Scope and decisions

1. **Staff MFA only.** Every staff identity must complete a short-lived, six-digit email code after a valid password. Customers keep the existing email/password flow. The MFA method is email OTP; no TOTP, backup-code, or trusted-device bypass is exposed.
2. **Security limits are server configuration.** The API owns the code lifetime, resend/throttle behaviour, failed-code lockout, idle timeout, absolute session lifetime, and maximum concurrent staff sessions. The browser never chooses these limits.
3. **Support reset boundary.** Only InsurShield `ADMIN` and `SUPER_ADMIN` accounts may trigger a customer reset. The insurer-bound `SUPPORT` role cannot reset a platform customer account. The actor must find an exact customer record, supply a reason and confirm the recorded contact identifier; the server rate-limits the action, sends the normal one-time reset link, and records actor, target, reason, channel, result and time. No token is returned to staff.
4. **Two-person means maker/checker.** A permitted administrator proposes a high-risk action. A different permitted InsurShield administrator reviews it. Approval revalidates the current record and applies the frozen request atomically; rejection, expiry and duplicate approval leave the target unchanged. The proposer can never approve their own request.
5. **Actions rerouted through maker/checker.** PIA floor changes and insurer activation, deactivation/suspension, deletion and restore become approval requests. Creating, editing evidence and ordinary insurer profile updates remain direct actions. Existing B7 lifecycle safeguards are rechecked when an approval is executed.

## Delivery slices

### B8.1 Approval domain and insurer/PIA reroute

- Add an append-only approval-request record with action, frozen safe payload, maker, checker, status, decision/reason, expiry and timestamps.
- Add scoped list, create, approve and reject endpoints with permissions and immutable audit entries.
- Replace direct PIA updates and insurer activation, suspension/deactivation, deletion and restore with proposals. The actual operation executes only after independent approval, inside the same transaction that locks and revalidates its target.
- Update the administrator console to show pending, approved, rejected and expired requests instead of claiming an action has already happened.

### B8.2 Staff MFA and session controls

- Enable Better Auth's email-OTP second factor only for identities linked to `staff_users`; migration backfills existing staff identities and provisioning marks new staff identities before their invitation is sent.
- Allow only the OTP challenge routes required to complete sign-in; refuse routes that would let a staff member disable MFA or use a different second factor.
- Enforce configured lockout/attempt limits, a short pending-challenge lifetime, idle expiry, absolute staff-session lifetime and a maximum number of concurrent staff sessions. Revoke excess/expired sessions server-side and audit security-relevant denials.
- Add the staff login code step, clear recovery/error messages and no customer-facing MFA regression.

### B8.3 Audited support password reset

- Add a support-reset command and storage for attempts/delivery result.
- Require an InsurShield administrator, exact account lookup, verification confirmation and a meaningful reason; rate-limit per customer and actor.
- Deliver through the existing password-reset mailer after the audit transaction commits. A delivery failure is visible to staff and auditable without revealing a reset token.
- Add a focused administrator-console control in the customer lookup workflow.

### B8.4 Regression, security and usability verification

- Unit and API integration tests for approval separation of duties, stale target revalidation, lifecycle rollback and retries.
- Auth tests for staff OTP required/complete/failed/locked, session limits and customer flow unchanged.
- Support reset tests for role boundary, exact matching, rate limits, mail failure and audit contents.
- Web interaction tests for the MFA step, proposal status and reset confirmation; run lint, typecheck, build and related end-to-end suites.

## Non-goals

- Product/version approval (Batch 9), generic settings approval (Batch 10), money adjustment approval (Batch 14), customer MFA, and a real payment gateway are out of scope.
- The platform does not expose reset tokens, staff MFA codes, account recovery secrets or cross-insurer customer data.

## Completion criteria

- A staff password alone cannot establish a usable session; a customer login is unchanged.
- A maker cannot approve their own request, and a stale/invalid insurer request cannot bypass Batch 7 controls at approval time.
- Every protected action is visible as a proposal or decision with an audit trail.
- Only authorised InsurShield staff can request a reset, and the reset is rate-limited, audited and does not leak a token.
- Relevant tests, typecheck, lint and builds pass; any database-harness issue is reported separately rather than hidden with longer timeouts.
