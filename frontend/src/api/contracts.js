/**
 * API contract shared with the backend.
 *
 * Every resource module in `api/http` implements these functions against the
 * REST endpoints listed below; `api/mock` implements the same functions over
 * browser storage. Pages never care which one is active.
 *
 * Conventions
 *  - Base URL: `VITE_API_BASE_URL` (default `/api/v1`). JSON bodies, ISO-8601 timestamps, ZMW amounts as numbers.
 *  - Auth: `Authorization: Bearer <token>` from `POST /auth/login`; staff and insurer users get role claims.
 *  - Errors: `{ code, message, details? }` with an HTTP status; the client raises `ApiError`.
 *  - Idempotency: `POST` calls that create money or policy records send an `Idempotency-Key` header.
 *  - Documents (quotations, certificates, photos): uploaded as multipart and referenced by `DocumentRecord`.
 *
 * Endpoints
 *  auth        POST /auth/register · POST /auth/login · POST /auth/otp · POST /auth/otp/verify · POST /auth/password-reset · POST /auth/staff/login · GET /auth/me
 *  vehicles    GET  /vehicles/lookup?plate=
 *  quotes      POST /quote-requests · GET /quote-requests · GET /quote-requests/:id · POST /quote-requests/:id/requote
 *              GET  /insurer/quote-requests · POST /insurer/quote-requests/:id/quote · POST /insurer/quote-requests/:id/extend
 *  insurers    GET  /insurers · GET /insurers/:id · POST /insurers · PATCH /insurers/:id · PATCH /insurers/:id/status · DELETE /insurers/:id · GET /insurers/directory
 *  payments    POST /payments · GET /payments/:id
 *  policies    GET  /policies · GET /policies/:number · GET /insurer/policies · POST /insurer/policies/:number/certificate
 *  claims      POST /claims · GET /claims · GET /insurer/claims · POST /insurer/claims/:number/received
 *  ncd         POST /ncd/applications · GET /ncd/applications · POST /ncd/codes/validate · GET /insurer/ncd/applications · POST /insurer/ncd/applications/:id/decision
 *  inspections POST /inspections · GET /inspections · PATCH /inspections/:id
 *  config      GET  /config/pia · PUT /config/pia
 *  capture     see `api/capture.js` (photo hand-off relay)
 */

/**
 * @typedef {Object} DocumentRecord  An uploaded file (PDF/JPG/PNG). The backend stores it privately and returns a signed URL instead of `dataUrl`.
 * @property {string} name
 * @property {string} type       MIME type
 * @property {number} size       bytes
 * @property {string} [dataUrl]  mock mode only
 * @property {string} [url]      signed download URL (http mode)
 */

/**
 * @typedef {Object} Customer
 * @property {string} fullName
 * @property {string} email
 * @property {string} phone
 */

/**
 * @typedef {Object} VehicleDetails
 * @property {string} plateNumber
 * @property {string} make
 * @property {string} model
 * @property {string} year
 * @property {string} [color]
 * @property {string} [chassisNumber]
 * @property {string} [engineNumber]
 * @property {string} [registrationDate]      ISO date
 * @property {string} [rtsaAnniversaryDate]   ISO date, from RTSA
 */

/**
 * @typedef {Object} InsurerQuote  One insurer's final reply to a quote request.
 * @property {number} premium            ZMW, must equal the premium on `document`
 * @property {string} [notes]
 * @property {string|null} insurerReference
 * @property {DocumentRecord} document   the quotation prepared in the insurer's own system
 * @property {number} validityDays
 * @property {string} sentAt
 * @property {string} validUntil
 * @property {string} [extendedAt]
 */

/**
 * @typedef {Object} QuoteRequest
 * @property {string} id                       e.g. QR-…
 * @property {'Submitted'|'Quoted'|'Expired'} status
 * @property {string} submittedAt
 * @property {string} expiresAt
 * @property {Customer} customer
 * @property {string[]} insurers               names of every insurer the request went to
 * @property {string[]} insurerIds
 * @property {Record<string, InsurerQuote>} insurerQuotes   keyed by insurer name
 * @property {string} vehicle                  display label
 * @property {VehicleDetails} vehicleDetails
 * @property {number} vehicleValue             declared value, ZMW
 * @property {string} vehicleUsage
 * @property {'Comprehensive'|'ThirdParty'} insuranceType
 * @property {string} coverageDurationId       '1q' | '2q' | '3q' | '4q'
 * @property {boolean} [matchRtsaAnniversary]
 * @property {string} [rtsaRegistrationDate]
 * @property {Object|null} policyDates
 * @property {string[]} inspectionShots        keys of the live photos captured
 * @property {string|null} photosCapturedAt
 * @property {string|null} [requotedFromId]
 * @property {string} [requotedAs]
 */

/**
 * @typedef {Object} PaymentReceipt
 * @property {string} transactionId
 * @property {'Confirmed'|'Pending'|'Failed'} status
 * @property {'Mobile money'|'Card'} method
 * @property {number} amount
 * @property {'ZMW'} currency
 * @property {string} confirmedAt
 */

/**
 * @typedef {Object} Policy
 * @property {string} policyNumber                 InsurShield reference (POL-…)
 * @property {string} [insurerPolicyNumber]        set by the insurer on issue
 * @property {'Awaiting insurer certificate'|'Active'} status
 * @property {string} insurer
 * @property {string} coverage
 * @property {string} [plan]
 * @property {number} premium
 * @property {string} vehicle
 * @property {VehicleDetails} vehicleDetails
 * @property {Object|null} policyDates
 * @property {string} customerName
 * @property {string} customerEmail
 * @property {string} customerPhone
 * @property {string|null} quoteRequestId
 * @property {string|null} insurerQuoteReference
 * @property {DocumentRecord|null} quoteDocument
 * @property {PaymentReceipt} paymentProof
 * @property {DocumentRecord} [certificateDocument] uploaded by the insurer; makes the policy Active
 * @property {string} receivedAt
 * @property {string} [issuedAt]
 */

/**
 * @typedef {Object} ClaimNotification  First notification only; the claim continues in the insurer's system.
 * @property {string} claimNumber
 * @property {'Notified'|'Received by insurer'} status
 * @property {string} insurer
 * @property {string} fullName
 * @property {string} phone
 * @property {string} [email]
 * @property {string} plate
 * @property {string} vehicle
 * @property {string} type
 * @property {string} incidentDate
 * @property {string} location
 * @property {string} description
 * @property {string} [estimatedLoss]
 * @property {boolean} policeReport
 * @property {string} [policeReportNumber]
 * @property {string} [lateReason]
 * @property {string} submittedAt
 * @property {string} [receivedAt]
 */

/**
 * @typedef {Object} NcdApplication
 * @property {string} id
 * @property {string} applicationNumber
 * @property {string} insurer
 * @property {string} policyNumber
 * @property {string} fullName
 * @property {string} phone
 * @property {number} yearsClaimFree
 * @property {'Submitted'|'Under Review'|'Approved'|'Rejected'} status
 * @property {string|null} approvedCode
 * @property {string} submittedAt
 */

/**
 * @typedef {Object} Insurer
 * @property {string} id
 * @property {string} name
 * @property {string} [tradingName]
 * @property {'Active'|'Inactive'|'Deleted'} status
 * @property {number} ratePercentage         annual rate, % of declared value
 * @property {number} quoteValidityDays
 * @property {string} coverage
 * @property {string} [licenceNumber]
 * @property {string} [licenceExpiry]
 * @property {string} [logoUrl]
 * @property {Object} contact                claims desk: contactPerson, role, phone, mobile, whatsapp, email, address, hours
 */

export {};
