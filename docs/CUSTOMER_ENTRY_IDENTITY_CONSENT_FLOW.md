# Customer Entry, Identity, and Consent Flow

## Goal

Visitors can explore InsurShield as guests. Creating an account is required before a customer submits a quotation request, starts a claim, or applies for NCD. This protects customer data, creates a traceable identity for insurers, and replaces the earlier tracking-link model.

## End-to-end flow

```text
Home page
  └─ Choose journey: Get insurance | Renew | Claims | Explore as guest
       └─ Guest explores public pages and may enter vehicle details
            └─ Requests quotes, starts a claim, or applies for NCD
                 └─ Protected-route check
                      ├─ Signed-in customer with consent → Quote request → Quote comparison
                      └─ Guest or customer missing consent → Create account
                           └─ Enter name, email, mobile number
                               └─ OTP request sent
                                     ├─ Valid OTP → Privacy and Terms review
                                     │    └─ Accept both → Account success → Resume saved quote request
                                     └─ Invalid/expired OTP → Show error → Retry or resend code

Returning customers use **Sign in** with their email/mobile number and password. **Forgot password** sends them through the same OTP identity check before permitting a new password.
```

## States, errors, and recovery

| Stage | Success state | Recoverable error / customer action | Safe resume point |
| --- | --- | --- | --- |
| Home / journey selection | Guest enters a public journey | Customer changes journey | Home page or current public page |
| Protected quote request | Signed-in customer continues | Guest is redirected without losing stored vehicle details | `/create-account?next=/quote-request` |
| Account details | OTP request screen | Missing or invalid fields remain inline; correct and resubmit | Account details form |
| Sign in | Customer returns to protected route | Incorrect details: retry, create account, or reset password | Sign-in form |
| Password recovery | Password reset screen after OTP verification | Unknown identity: create account; invalid OTP: retry or resend | Recovery form / OTP screen |
| OTP verification | Consent review | Wrong code: retry; not received: resend; incorrect phone: change phone | OTP screen |
| Privacy / terms | Account created | Customer may decline and safely return home | Consent screen or home |
| Consent accepted | Account-ready success | Customer can continue manually if navigation is interrupted | Success screen → saved `next` route |
| Quote request | Quotes appear for comparison | Missing documents / declaration remain inline; add the missing item | Quote request form |

## Implementation notes

- `CustomerRoute` (see `frontend/src/components/ProtectedRoute.jsx`) gates the quote request, comparison, payment, account, claims and renewal pages; `StaffRoute` gates the staff and insurer portals.
- Every quote request is sent to all active insurers at once (`submitQuoteRequest` in the store). Insurers reply through the insurer portal (`addInsurerQuote`), and the comparison page shows each insurer's final quote or, until it arrives, an indicative estimate.
- The `next` query parameter preserves the intended destination after account creation.
- Zustand persistence retains non-sensitive quote-progress data locally so customers do not need to re-enter vehicle details after verification.
- OTP `1234` is prototype-only. Production must use a server-issued, expiry-bound OTP and rate limiting; passwords, OTPs, and consent audit records must never be stored in browser state.
