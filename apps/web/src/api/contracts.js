/**
 * API contract shared with the backend.
 *
 * Every resource module in `api/http` implements these functions against the
 * REST endpoints listed below; `api/mock` implements the same functions over
 * browser storage. Pages never care which one is active.
 *
 * Conventions
 *  - Base URL: `VITE_API_BASE_URL` (default `/api/v1`). JSON bodies, ISO-8601 timestamps, ZMW amounts as numbers.
 *  - Auth: Better Auth's HTTP-only cookie session. HTTP mode adds the tab's
 *    `X-InsurShield-User` binding to prevent a stale tab acting as another user.
 *  - Errors: `{ code, message, details? }` with an HTTP status; the client raises `ApiError`.
 *  - Idempotency: `POST` calls that create money or policy records send an `Idempotency-Key` header.
 *  - Documents (quotations, certificates, photos): uploaded as multipart and referenced by `DocumentRecord`.
 *
 * Endpoints
 *  auth        POST /identity/register · POST /identity/sign-in/email · POST /identity/sign-out
 *              POST /identity/revoke-sessions · POST /identity/change-password
 *              POST /identity/request-password-reset · POST /identity/reset-password
 *              GET /auth/me · POST /auth/consent
 *  account     DELETE /account
 *  vehicles    GET  /vehicles/lookup?plate=
 *  quotes      POST /quote-requests · GET /quote-requests · GET /quote-requests/:id · POST /quote-requests/:id/requote
 *              GET  /insurer/quote-requests · POST /insurer/quote-requests/:id/quote · POST /insurer/quote-requests/:id/extend
 *  insurers    GET  /insurer/profile (signed-in insurer) · GET /insurers · GET /insurers?status=deleted (super admin) · GET /insurers/:id · POST /insurers · PATCH /insurers/:id · PATCH /insurers/:id/status · POST /insurers/:id/suspend · DELETE /insurers/:id · POST /insurers/:id/restore (super admin) · GET /insurers/directory
 *              GET /insurers/:id/evidence · POST /insurers/:id/evidence · POST /insurers/:id/evidence/:evidenceId/review · GET/PUT /insurers/:id/integration · POST /insurers/:id/activate
 *  products    GET  /insurer/products · GET /insurer/products/:id · POST /insurer/products
 *              GET /insurer/products/comparison-taxonomy · PATCH /insurer/products/:id/versions/:versionId · POST /insurer/products/:id/versions/:versionId/revise · POST /insurer/products/:id/versions/:versionId/submit
 *              GET /admin/products · POST /admin/products/:id/versions/:versionId/(approve|reject|withdraw) · GET /products/directory · GET /products/:id/versions/:versionId/estimate
 *  settings    GET /admin/settings/rules · GET /admin/settings/rules/:key · POST /admin/settings/rules/:key/versions · POST /admin/settings/rules/:key/versions/:id/confirm
 *              GET/POST /admin/settings/comparison-taxonomy · PATCH /admin/settings/comparison-taxonomy/:id
 *  staff       GET /staff/users · POST /staff/users · PATCH /staff/users/:id · POST /staff/users/:id/invitation
 *              GET /staff/teams · POST /staff/teams · PATCH /staff/teams/:id · DELETE /staff/teams/:id
 *  payments    POST /payments (Idempotency-Key required; answers the attempt status, never a receipt) · GET /payments/:id · POST /payments/:id/cancel
 *  policies    GET  /policies · GET /policies/:number · POST /policies/:number/renew
 *              GET  /insurer/policies · POST /insurer/policies/:number/certificate
 *  claims      GET /claims/intake-rules · GET /claims/:number/timeline · GET /insurer/claims/:number/timeline
 *              POST /claims/:number/evidence {documentIds,expectedRevision} · POST /insurer/claims/:number/updates {action,message,evidenceRequest?,expectedRevision}
 *              POST /claims · GET /claims · GET /insurer/claims · POST /insurer/claims/:number/received
 *  ncd         GET /ncd/applications/rules · POST /ncd/applications/:id/evidence · POST /ncd/applications · GET /ncd/applications · POST /ncd/codes/validate · GET /insurer/ncd/applications · POST /insurer/ncd/applications/:id/decision
 *  inspections POST /inspections · GET /inspections · PATCH /inspections/:id
 *  config      GET  /config/pia · PUT /config/pia
 *  integrations GET /integrations/deliveries · POST /integrations/deliveries/:id/manual-fallback
 *              GET /insurer/integrations/deliveries
 *  admin       GET  /admin/overview · GET /admin/premium-by-month?months= · GET /admin/policies?limit= · GET /admin/customers/find?query= · POST /admin/customers/password-reset · GET /admin/audit-logs
 *              GET /admin/approvals · POST /admin/approvals/:id/approve · POST /admin/approvals/:id/reject
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
 * @property {string} [registrationCountry] where the plate was issued
 * @property {string} [chassisNumber]
 * @property {string} [engineNumber]
 * @property {string} [registrationDate]      ISO date
 * @property {string} [rtsaAnniversaryDate]   ISO date, from RTSA
 */

/**
 * @typedef {Object} InsurerQuote  One insurer's final reply to a quote request.
 * @property {string} id                immutable quote identity; required to pay
 * @property {string|null} productVersionId null only for a legacy broad request
 * @property {number} premium            ZMW, must equal the premium on `document`
 * @property {number} [ncdPercentage]     Approved discount already included in this premium
 * @property {string} [notes]
 * @property {string|null} insurerReference
 * @property {DocumentRecord} document   the quotation prepared in the insurer's own system
 * @property {number} validityDays
 * @property {string} sentAt
 * @property {string} validUntil
 * @property {string} [extendedAt]
 * @property {string|null} [unavailableAt]  Insurer can no longer complete this unpaid quote
 */

/**
 * @typedef {Object} SelectedProduct  Immutable snapshot of one product the
 * customer selected before sending a current quote request.
 * @property {string} productVersionId
 * @property {string} insurerId
 * @property {string} insurerName
 * @property {string} productCode
 * @property {number} productVersionNumber
 * @property {string} productName
 * @property {'Comprehensive'|'ThirdParty'} coverType
 * @property {Object} coverGuide
 * @property {{rule:string,timing:string|null,method:string|null}} inspection
 * @property {string|null} unavailableAt
 * @property {string} status where the product stands with its insurer (see domain/quoteWorkflow.js)
 * @property {string} statusLabel the customer's wording for `status`
 * @property {string|null} replyDueAt when the insurer must answer by
 * @property {{reason:string|null, note:string|null}|null} decline the approved customer wording only
 * @property {InformationRequest[]} informationRequests the insurer's questions and the customer's answers
 */

/**
 * @typedef {Object} InformationRequest  An insurer's question to the customer about one chosen product.
 * @property {string} id
 * @property {string} message
 * @property {string} dueAt
 * @property {string} askedAt
 * @property {string|null} answeredAt
 * @property {string|null} answer
 * @property {boolean} open true while the customer can still answer
 */

/**
 * @typedef {InsurerQuote & { insurer: { id:string, name:string } }} ProductQuote
 * A final quote for one selected product. Several of these may belong to the
 * same insurer, so it is never keyed by insurer name.
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
 * @property {SelectedProduct[]} selectedProducts selected-product request snapshot; empty for legacy requests
 * @property {ProductQuote[]} productQuotes final replies for selected products; empty for legacy requests
 * @property {Record<string, InsurerQuote>} insurerQuotes legacy replies keyed by insurer name
 * @property {{name:string, unavailableAt:string}[]} [unavailableInsurers] insurers that could not complete the request
 * @property {string} vehicle                  display label
 * @property {VehicleDetails} vehicleDetails
 * @property {number} vehicleValue             declared value, ZMW
 * @property {string} vehicleUsage
 * @property {'Comprehensive'|'ThirdParty'} insuranceType
 * @property {string} coverageDurationId       '1q' | '2q' | '3q' | '4q'
 * @property {boolean} [matchRtsaAnniversary]
 * @property {number} rtsaAnniversaryFee       ZMW server-configured fee for a matched RTSA anniversary; charged fee after payment
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
 * @property {number} rtsaAnniversaryFee
 * @property {'ZMW'} currency
 * @property {string} confirmedAt
 * @property {string|null} policyNumber        Minted by the payment service; null until the policy exists
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
 * @property {number} rtsaAnniversaryFee
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
 * @property {'Submitted'|'Under Review'|'Verification Required'|'Approved'|'Rejected'} status
 * @property {string|null} approvedCode
 * @property {'Available'|'Expired'|'Used'|'Unavailable'|null} codeStatus
 * @property {number|null} discountPercentage
 * @property {string|null} expiresAt
 * @property {string|null} decisionNote
 * @property {number} verificationRevision
 * @property {DocumentRecord[]} evidence
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
 * @property {string|null} [deletedAt]       set only while a super admin has removed the insurer
 */

/**
 * @typedef {Object} Notification
 * @property {string} id
 * @property {string} subject
 * @property {string} body
 * @property {'QUOTE'|'PAYMENT'|'POLICY'|'CLAIM'|'NCD'|'INSPECTION'|'ACCOUNT'|'MARKETING'} category
 * @property {string} entityType             the kind of record this is about
 * @property {string} entityId               the record itself, for the link
 * @property {'RENEW'|null} action           a step the notice asks for, beyond opening the record
 * @property {boolean} read
 * @property {string} createdAt
 */

/**
 * @typedef {Object} IntegrationDeliverySummary
 * @property {string} id
 * @property {string|null} insurerId
 * @property {'INSURER_API'|'RTSA'|'PAYMENT_GATEWAY'} targetKind
 * @property {string} kind
 * @property {string} referenceId
 * @property {'PENDING'|'ACKNOWLEDGED'|'FAILED'|'MANUAL_FALLBACK'} status
 * @property {number} attempt
 * @property {number} maxAttempts
 * @property {string|null} [correlationId]
 * @property {string|null} [error]
 * @property {string|null} [lastAttemptAt]
 * @property {string|null} [acknowledgedAt]
 * @property {string|null} [resolvedAt]
 * @property {string} createdAt
 *
 * Provider URLs, credentials, request bodies and callback bodies are never
 * part of this browser contract.
 */

/**
 * @typedef {Object} NotificationPage
 * @property {Notification[]} items          newest first
 * @property {string|null} nextCursor        pass as `before` to continue
 * @property {number} unread
 */

/**
 * @typedef {Object} ContactPreference
 * @property {'QUOTE'|'PAYMENT'|'POLICY'|'CLAIM'|'NCD'|'INSPECTION'|'ACCOUNT'|'MARKETING'} category
 * @property {'IN_APP'|'EMAIL'} channel
 * @property {boolean} enabled               absent means on; only false silences
 */

/**
 * @typedef {Object} ContactPreferences
 * @property {ContactPreference[]} preferences
 * @property {boolean} marketingConsent      never asked is not consent
 */

/**
 * High-risk writes (config.setPia, insurers.activate/setStatus/suspend/remove/restore)
 * return an ApprovalRequest, not an updated insurer/configuration. Proposing never
 * applies the change. An independent authorised administrator must approve it;
 * approval revalidates the target before applying the frozen proposal exactly once.
 * Delete/restore proposals and their approval require a super administrator.
 * admin.approvals.list() returns pending ApprovalRequest[]. approve(id, {reason?})
 * and reject(id, {reason?}) return the decided request. Reasons are at most 2000
 * characters. Pending proposals expire after seven days; duplicate pending actions
 * for the same target conflict. Mock records use versioned browser storage.
 *
 * @typedef {Object} ApprovalRequest
 * @property {string} id
 * @property {'PIA_FLOOR_CHANGE'|'INSURER_ACTIVATE'|'INSURER_DEACTIVATE'|'INSURER_SUSPEND'|'INSURER_DELETE'|'INSURER_RESTORE'} action
 * @property {'PENDING'|'EXECUTED'|'REJECTED'|'EXPIRED'} status
 * @property {'SETTING'|'INSURER'} targetType
 * @property {string} targetId
 * @property {string} requestedByStaffId
 * @property {string} [requestedByName]
 * @property {string} requestedReason
 * @property {{piaRatePercentage?:number, effectiveFrom?:string, renewalDate?:string|null, conditions?:string|null, reason?:string|null}} [proposal] Action-specific allowlist; never raw payloads, credentials or document data.
 * @property {string} createdAt
 * @property {string} expiresAt
 * @property {string|null} decidedByStaffId
 * @property {string|null} decidedAt
 * @property {string|null} decisionReason
 * @property {string|null} executedAt
 */
export {};

/**
 * Account privacy operations (authenticated customer only).
 * GET /account/export -> one JSON attachment, generated on demand, never persisted.
 * Requires sign-in within 10 minutes; 403 REAUTHENTICATION_REQUIRED asks for sign-in again.
 * Includes profile, consents, contactPreferences, vehicles, quoteRequests, masked payments,
 * policies, serviceRequests (customer-visible updates only), claims, ncdApplications,
 * inspections, notifications and documents. The client downloads the response unchanged.
 * GET /account/documents -> AccountDocument[] (only the current customer's documents).
 * @typedef {Object} AccountDocument
 * @property {string} id
 * @property {string} name
 * @property {string} type
 * @property {number} size
 * @property {string} kind
 * @property {string|null} uploadedAt
 * @property {boolean} available
 * @property {string|null} downloadPath Relative to the configured API prefix.
 * Opening requests a fresh protected URL via GET /documents/:id.
 */

/**
 * @typedef {Object} ClaimTimeline
 * @property {string} revision Latest persisted event id or synthetic :submitted / :acknowledged revision.
 * @property {string} claimNumber
 * @property {'Notified'|'Received by insurer'|'Under review'|'Additional information required'|'Approved'|'Declined'|'Closed'} status
 * @property {string|null} responseDueOn
 * @property {boolean} lateSubmission
 * @property {string|null} insurerClaimReference
 * @property {Array<{id: string, status: string, actorKind: string, message: string, evidenceRequest: string|null, createdAt: string, documents: DocumentRecord[]}>} updates
 * Claim update and evidence POSTs return this detail. Real intake requires an owned policyNumber;
 * insurer and vehicle fields are derived by the server. Acknowledgement accepts insurerClaimReference.
 * CLAIM_INSURER_UNAVAILABLE details: {reference, contact:{email,phone,hours}}.
 * CLAIM_LATE_REASON_REQUIRED retains the form and requests lateReason before resubmission.
 */

/** Claim lifecycle/evidence commands send expectedRevision from the rendered timeline and an
 * Idempotency-Key stable for unchanged input. CLAIM_REVISION_CHANGED requires a refresh;
 * evidence uploads must never be reused for a different revision or file selection.
 */

/**
 * @typedef {Object} NcdRules
 * @property {Array<{yearsClaimFree: number, percentage: number}>} tiers
 * @property {number} validityDays
 * @property {boolean} provisional
 * @property {string} declarationText
 *
 * NCD apply: {policyNumber, fullName, phone, yearsClaimFree, declaration: true}.
 * Optional insurerId is checked against the policy; HTTP customer screens omit it.
 * Apply and evidence accept an optional Idempotency-Key header, retained on retries.
 * Evidence: {verificationRevision, documentIds}; upload with kind NCD_EVIDENCE first.
 * Decision: {status: 'Under Review'|'Verification Required'|'Approved'|'Rejected', note: string}.
 */

/**
 * Later inspection contract (customer and insurer).
 * @typedef {Object} LaterInspection
 * @property {'AFTER_PAYMENT'|'CLAIM_ASSESSMENT'} purpose
 * @property {string|null} policyNumber
 * @property {string|null} claimNumber
 * @property {'PHYSICAL'|'SELF_CAPTURE'} method
 * @property {string|null} stage Existing product inspection stage, unchanged.
 * @property {Array<{slot:string,document:DocumentRecord}>} photos Customer list evidence.
 * @property {DocumentRecord|null} report Published, immutable report.
 *
 * claims.requestInspection(claimNumber, method) POSTs {method} to
 * /insurer/claims/:claimNumber/inspection; returns {id,status,statusLabel}.
 * inspections.submitEvidence(id, {photos:[{slot,documentId}]}) uses /inspections/:id/evidence;
 * submitInsurerEvidence uses /insurer/inspections/:id/evidence.
 * Slots: front, rear, left, right, dashboard, engine_bay.
 * AFTER_PAYMENT uploads use INSPECTION_PHOTO / INSPECTION_REPORT;
 * CLAIM_ASSESSMENT uploads use CLAIM_ATTACHMENT for photos and report.
 * inspections.evidence(id) GETs /insurer/inspections/:id/evidence:
 * {preLoss:[{slot,document,reference}],postLoss:[{slot,document,reference}],report:DocumentRecord|null}.
 * attachReport(id, documentId) POSTs {documentId} to /insurer/inspections/:id/report.
 * SELF_CAPTURE requires all six slots; PHYSICAL requires scheduling before publication.
 * reinspect(id) POSTs /insurer/inspections/:id/reinspect; returns {id,status,statusLabel}.
 * Claim timelines optionally include inspection:{id,status,method}, with a display status.
 * Existing payment/certificate flows remain unchanged by inspection outcomes.
 */

/**
 * Batch 17 — routes are relative to the configured API base URL (/api/v1).
 * GET /reviews/customer/policies/:policyNumber -> PolicyReviewState
 * POST/PATCH same route, { rating: integer 1..5, text?: string } -> PolicyReviewState
 * DELETE same route, empty body -> PolicyReviewState
 * Eligibility is authoritative server state; pending is the latest revision, including rejections.
 * @typedef {'PENDING'|'PUBLISHED'|'REJECTED'|'REMOVED'|'WITHDRAWN'} ReviewStatus
 * @typedef {{id:string,rating:number,text:string|null,status:ReviewStatus,decisionId:string|null,reason:string|null,decidedAt:string|null}} ReviewRevision
 * @typedef {{canSubmit:boolean,canEdit:boolean,canWithdraw:boolean,review:null|{id:string,status:ReviewStatus,pending:ReviewRevision|null,published:ReviewRevision|null,withdrawnAt:string|null}}} PolicyReviewState
 *
 * GET /reviews/public/:insurerId?page=1 -> {items: PublicReview[],hasMore:boolean,page:number}
 * Returns no items while the review policy is provisional. No aggregate ratings.
 * @typedef {{id:string,rating:number,text:string|null,publishedAt:string,response:null|{text:string,publishedAt:string}}} PublicReview
 *
 * GET /insurer-profiles/:insurerId -> PublicInsurerProfile; null/404 until approved.
 * @typedef {{brandName:string,description:string,serviceInformation:string,contactEmail:string|null,contactPhone:string|null,websiteUrl:string|null,logoUrl:string|null}} InsurerProfileContent
 * @typedef {{insurerId:string,name:string,tradingName:string|null,status:string,licence:{number:string|null,expiresAt:string|null,current:boolean},revisionId:string,profile:InsurerProfileContent,products:Array<{productId:string,versionId:string,name:string,coverType:string}>,productsTruncated:boolean}} PublicInsurerProfile
 * Mock mode returns no public profile/reviews and disables verified review writes;
 * the existing prototype purchase rating remains separate.
 */

/**
 * GET /review-appeals?page=&decisionId= -> ReviewAppeal[] (current principal only, 20 per page)
 * POST /review-appeals {decisionId:string,reason:string,evidence?:string} -> ReviewAppeal
 * Reason: 1–2000 characters; evidence: at most 10000 characters. Both are private.
 * @typedef {{id:string,decisionId:string,party:string,reason:string|null,evidence:string|null,createdAt:string,dueAt:string,decidedAt:string|null,outcome:string|null,outcomeReason:string|null,purgedAt:string|null}} ReviewAppeal
 * PublicReview.publishedAt and response.publishedAt are Lusaka calendar months (YYYY-MM).
 */

/**
 * Batch 18: GET /insurer-reputation?insurerIds=<comma-separated UUIDs> (1–100 unique IDs)
 * api.insurerReputation.list(insurerIds, {signal}) -> {items: InsurerReputation[]}
 * Provisional rules and unknown insurers return no items. Mock returns no items.
 * @typedef {{average:number|null,reviewCount:number,minimumReviews:number,periodStart:string,periodEnd:string,method:string,ruleVersion:number}} InsurerRating
 * @typedef {{insurerId:string,code:'ON_TIME_CERTIFICATES',label:string,sampleCount:number,onTimeCount:number,minimumPolicies:number,thresholdBps:number,percentage:number,periodStart:string,periodEnd:string,awardedAt:string,expiresAt:string,ruleVersion:number,dataSource:string,method:string,disclaimer:string}} InsurerPerformanceBadge
 * @typedef {{insurerId:string,rating:InsurerRating|null,badges:InsurerPerformanceBadge[]}} InsurerReputation
 */

/**
 * Admin badge governance uses GET and PUT /admin/insurer-reputation/:insurerId/badge.
 * api.badgeGovernance.get(insurerId) and update(insurerId, {suspended, reason, expectedGeneration})
 * return the insurer's suspension generation, details and latest calculation.
 * An out-of-date decision returns BADGE_STATE_CHANGED (409). Mock mode
 * reports that governance requires a connected API.
 */

/**
 * Batch 19 reports
 * reports.get(scope, {from,to}) reads platform operations, insurer operations
 * or insurer finance by authorised scope. Dates are inclusive Lusaka days.
 * Aggregate metric values are decimal strings with count or minorUnits units.
 * reports.exportCsv uses the same filters and returns CSV text from the API.
 *
 * customerContent.published() returns effective approved support content.
 * customerContent manages versions and history by slug. notificationGovernance
 * manages approved template versions and masked delivery exceptions.
 * privacyRequests supports private, version-checked cases and retention holds.
 * riskReview uses a version-checked queue whose outcomes do not change the
 * underlying policy, payment or quote. All governance writes require HTTP mode.
 */
