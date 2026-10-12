# InsurShield MVP Requirements Specification

**Document status:** Draft for stakeholder review and sign-off  
**Version:** 0.10  
**Date:** 26 August 2026  
**Classification:** Commercial-in-confidence  
**Related document:** InsurShield Product Brief

## 1. Purpose

This specification defines the functional, business, integration, data, security, operational, and acceptance requirements for the InsurShield motor-insurance MVP. It is intended to provide one agreed baseline for client approval, solution design, implementation, testing, release planning, and change control.

Requirements marked **Must** form the proposed MVP acceptance baseline. Requirements marked **Should** are included where delivery dependencies permit and may be reclassified only through the formal scope-approval process.

## 2. MVP definition

The MVP is a responsive, Zambia-focused web application supporting:

- Comprehensive and Third-Party motor insurance.
- Customer quote, comparison, purchase, policy, renewal, claim, NCD, inspection, tracking, and support journeys.
- Full customer accounts, profiles, portfolios, verified ratings/reviews, insurer performance badges, and clearly disclosed sponsored content.
- Insurer quotation, claim, NCD, and basic product-management workflows.
- InsurShield insurer/product administration, operational monitoring, content control, and audit.
- RTSA, insurer, payment, messaging, document-storage, and policy-issuance integrations required for the agreed launch journey.

## 3. Actors and access boundaries

| Actor | Responsibilities | Access boundary |
|---|---|---|
| Customer | Request quotes, compare, pay, receive policy, renew, claim, apply for NCD, request inspection, track requests | May access only records verified as belonging to the customer or an authorised representative. |
| Insurer operator | Respond to quotes, manage insurer-owned claims and NCD applications | Restricted to the operator's insurer and assigned permissions. |
| Insurer administrator | Maintain insurer users and submit products/rates for approval | Restricted to the operator's insurer; publication requires InsurShield approval. |
| InsurShield support/operations | Assist customers, recover tracking links, monitor operational queues | Restricted by role and purpose; sensitive actions are audited. |
| InsurShield administrator | Onboard insurers, approve products/rates, manage configuration and access | Privileged access with strong authentication and complete audit history. |
| Compliance/reporting stakeholder | Review approved audit and reporting information | Read-only access to approved datasets and reports. |

## 4. Customer features and requirements

### 4.1 Customer entry, identity, and consent

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-CUS-001 | Must | The platform shall allow a customer to start a new quote, recover an existing quote, renew a policy, submit/track a claim, apply/track NCD, request/track an inspection, or contact an insurer. | Each journey is available from clear navigation and opens without exposing another customer's data. |
| FR-CUS-002 | Must | The platform shall collect only the customer information required for the selected journey. | Required fields are defined by purpose; optional fields are clearly identified; validation errors are specific and accessible. |
| FR-CUS-003 | Must | The platform shall verify the customer's phone or another approved identity factor before exposing protected records or completing sensitive actions. | Issued OTP/token is time-limited, single-purpose, rate-limited, and validated by the server. |
| FR-CUS-004 | Must | The platform shall present approved privacy, terms, declarations, and data-sharing notices before the relevant action. | Acceptance records include notice type, version, actor/session, timestamp, and selected purpose. |
| FR-CUS-005 | Must | A customer acting for a registered owner shall confirm authority to arrange insurance. | Quote submission is blocked until the authority declaration is accepted; evidence requirements follow the approved business rule. |

### 4.2 Cover, vehicle, and usage capture

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-VEH-001 | Must | The platform shall offer Comprehensive and Third-Party Only motor cover with approved plain-language explanations. | Both options show their principal coverage and exclusions before selection. |
| FR-VEH-002 | Must | The platform shall support vehicle lookup through the approved RTSA service. | A successful lookup returns the approved registration/ownership fields and records the verification result and time. |
| FR-VEH-003 | Must | The platform shall provide a controlled manual-entry fallback when RTSA lookup is unavailable or permitted. | Required fields include registration where applicable, chassis/VIN, make, model, year, engine number where required, and colour; fallback use is recorded. |
| FR-VEH-004 | Must | The customer shall declare the vehicle's current market value in ZMW. | Value must be positive and within configurable validation thresholds; customer accepts the approved valuation warning. |
| FR-VEH-005 | Must | The customer shall select the vehicle's primary usage from approved private and commercial categories. | Eligibility and rating are recalculated when usage changes; unsupported uses cannot continue. |
| FR-VEH-006 | Should | The platform shall offer road-tax renewal when RTSA confirms expiry and the service is enabled. | Authoritative amount and status are shown; customer explicitly opts in; payment and RTSA confirmation are reconciled. |
| FR-VEH-007 | Must | The customer shall provide the approved driver and risk information required by participating insurers. | Dynamic questions capture regular driver, licence details/history, prior claims, vehicle parking/location, security devices, annual use, and other approved inputs without asking irrelevant questions. |

### 4.3 Eligibility, insurer selection, and declarations

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-ELG-001 | Must | The platform shall determine eligible insurers/products using cover type, usage, vehicle details/value, regulatory rules, insurer status, and product rules. | Only active, approved, eligible products appear. |
| FR-ELG-002 | Must | The customer shall be able to select one to five eligible insurers for a quote request. | Zero selections block submission; a sixth selection is not permitted. |
| FR-ELG-003 | Must | The platform shall display insurer, product, indicative pricing where allowed, core benefits, inspection requirement, timing, and NCD eligibility before selection. | The same approved comparison fields are used for all insurers. |
| FR-ELG-004 | Must | The customer shall individually acknowledge the approved quote declarations. | Submission is blocked until every mandatory declaration is accepted and recorded. |

### 4.4 Quote request

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-QTE-001 | Must | The quote request shall capture customer contact details, vehicle, cover, usage, declared value, selected insurers, policy start date, duration, declarations, and supporting documents. | A complete request is stored as one versioned record with a unique reference. |
| FR-QTE-002 | Must | Supported policy durations shall be configurable by product and insurer. | The initial options may include 1, 2, 3, 6, 9, and 12 months; unsupported combinations cannot be selected. |
| FR-QTE-003 | Must | Policy start date shall be today or a permitted future date. | Invalid/past dates are rejected; calculated end date follows the approved day-count rule. |
| FR-QTE-004 | Must | White Book and driver's licence shall be collected when required by the approved product/KYC rules. | Missing mandatory documents block submission; uploaded files pass security and format checks. |
| FR-QTE-005 | Must | Conditional documents and inspection photos shall be enforced using insurer/product rules. | The platform blocks only the affected insurer/product or the whole request according to the approved orchestration rule. |
| FR-QTE-006 | Must | The platform shall distribute one idempotent quote request to each selected insurer. | Each insurer request has its own status, correlation ID, response deadline, retry record, and error state. |
| FR-QTE-007 | Must | The customer shall receive a secure request reference and tracking link through an approved channel. | Delivery status is recorded; failed delivery can be retried or recovered by authorised staff. |
| FR-QTE-008 | Must | The customer shall be able to save and resume an incomplete quote through secure recovery. | The latest complete draft is restored after identity verification; expired drafts follow the approved retention rule. |

### 4.5 Premium and NCD calculation

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-PRM-001 | Must | Premium calculation shall use the approved insurer/product rate, declared vehicle value, cover type, usage, duration, regulatory floor, taxes/fees, and applicable loadings/discounts. | A controlled test matrix proves every component, order of operations, rounding rule, and total. |
| FR-PRM-002 | Must | The regulatory premium-floor rule shall be centrally configured, effective-dated, approved, and auditable. | All quote channels use the same active rule; unauthorised users cannot change it. |
| FR-PRM-003 | Must | Short-period premium calculation shall follow the approved insurer/product factor rather than an unapproved assumption. | Each duration produces the approved amount and shows the relevant period. |
| FR-NCD-001 | Must | A customer shall be able to enter an insurer-approved NCD code or apply for NCD. | Invalid, expired, revoked, wrong-insurer, wrong-vehicle/policy, or used codes do not apply. |
| FR-NCD-002 | Must | NCD rules shall define the approved tier, issuing insurer, eligible policy/vehicle, validity period, and use policy. | Calculation and redemption are server-authoritative and transactionally prevent duplicate use. |
| FR-NCD-003 | Must | NCD application shall capture customer, phone, insurer, existing policy, claim-free history, and declaration. | Successful submission creates a unique reference and initial status. |
| FR-NCD-004 | Must | Insurer operators shall review, request verification, approve, or reject an NCD application. | Every decision records actor, time, note, and customer notification; approval issues a protected code. |

### 4.6 Quote tracking and comparison

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-TRK-001 | Must | The platform shall show per-insurer quote status and allow partial quote availability. | Ready, pending, declined, timed out, inspection-required, and failed responses are distinguishable. |
| FR-TRK-002 | Must | A customer shall recover a quote request using approved identifiers and OTP verification. | Invalid identifiers or OTPs reveal no request data; expiry and attempt limits are enforced. |
| FR-CMP-001 | Must | Ready quotations shall be shown in a consistent comparison format. | Comparison includes insurer/product, final premium, premium components, benefits, exclusions/conditions, inspection status, validity period, and policy documents/terms. |
| FR-CMP-002 | Must | Any recommendation, ranking, or badge shall use an approved and disclosed rule. | Sponsored placement is not mixed with objective ranking in MVP; ties and missing responses are handled consistently. |
| FR-CMP-003 | Must | The customer shall select one valid quotation for payment. | Expired, withdrawn, declined, or superseded quotations cannot be purchased. |
| FR-CMP-004 | Must | The customer shall filter and sort quotations by approved comparison dimensions. | At minimum, the customer can compare final price, cover level, excess/deductible, inspection requirement, selected benefits/add-ons, and quote status. |
| FR-CMP-005 | Must | The platform shall disclose material exclusions, excesses, optional add-ons, and conditions before purchase. | Customer can open the approved product/policy documents and must accept any purchase-critical condition. |

### 4.7 Payment and policy issuance

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-PAY-001 | Must | The platform shall support approved Zambian mobile-money providers and payment cards. | Payment details are tokenised by an approved provider; InsurShield does not store raw card data. |
| FR-PAY-002 | Must | The payable amount shall equal the selected quote plus approved taxes, fees, and optional road-tax amount. | Customer sees an itemised total before authorisation; server and provider amounts match. |
| FR-PAY-003 | Must | Payment processing shall be idempotent and reconciled. | Duplicate/replayed callbacks do not create duplicate charges or policies; failure and pending states are recoverable. |
| FR-PAY-004 | Must | Policy issuance shall begin only after authoritative payment success and insurer acceptance. | Each successful purchase creates one policy or a controlled issuance exception requiring resolution/refund. |
| FR-POL-001 | Must | The issued policy shall include policy number, insurer/product, customer, vehicle, cover, dates, premium, status, and approved policy document. | Customer can view and download the authoritative policy certificate. |
| FR-POL-002 | Must | The customer shall receive policy/payment confirmation by approved channels. | Delivery status and retries are recorded; sensitive documents use protected links. |
| FR-POL-003 | Should | A policyholder shall submit a service request for permitted policy changes, document replacement, cancellation, or insurer assistance. | Request is routed to the responsible insurer/operations queue with status, messages, and audit history; direct policy mutation is not permitted without insurer approval. |

### 4.8 Renewal

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-REN-001 | Must | An existing customer shall securely retrieve renewal-eligible policies. | Policy information is returned only after approved identity verification. |
| FR-REN-002 | Must | A renewal request shall prefill verified customer, vehicle, prior-policy, and insurer information. | Customer reviews and confirms all mutable data before submission. |
| FR-REN-003 | Must | The platform shall send renewal reminders according to the approved schedule and consent rules. | Reminder event, channel, delivery result, and opt-out are recorded. |

### 4.9 Claims

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-CLM-001 | Must | A customer shall initiate a claim against a verified active/eligible policy. | Plate/policy lookup returns the responsible insurer and cover without exposing unrelated data. |
| FR-CLM-002 | Must | Claim intake shall capture claimant/contact, policy/vehicle, claim type, incident date/location/description, estimated loss, police-report information, and required supporting evidence. | Requirements vary by claim type; incomplete mandatory evidence is clearly identified. |
| FR-CLM-003 | Must | Coverage mismatch or policy ineligibility shall block or route the claim according to the approved rule. | Customer receives a clear reason and assistance path without silently losing entered data. |
| FR-CLM-004 | Must | Claims outside the approved reporting window shall require the configured late-submission process. | Late reason is captured and insurer discretion/manual-review status is explicit. |
| FR-CLM-005 | Must | Successful submission shall create a unique reference, responsible insurer, initial status, target date, and timeline event. | Customer receives the reference on-screen and through an approved channel. |
| FR-CLM-006 | Must | Customer and authorised insurer operators shall exchange claim messages and documents. | Messages record sender role, time, delivery status, and attachment controls. |
| FR-CLM-007 | Must | Claim status shall follow the approved transition model. | Invalid transitions are rejected; every transition records actor, note, time, and notification. |

### 4.10 Vehicle inspections

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-INS-001 | Must | Inspection rules shall be defined by insurer/product, method, and blocking stage. | The platform clearly indicates whether inspection is before quote, before payment, after payment, or not required. |
| FR-INS-002 | Must | A customer shall request an inspection using vehicle, preferred date/time/location, notes, and permitted photos. | Required schedule/location data is validated and one inspection reference is created. |
| FR-INS-003 | Must | The platform shall support front, rear, left, right, dashboard/mileage, and engine-bay evidence when required. | Each file is associated with the inspection and passes upload/security controls. |
| FR-INS-004 | Must | Inspection status shall support Requested, Scheduled, Inspector Assigned, In Progress, Completed, Report Ready, Approved, and Failed, subject to the approved workflow. | Customer sees current status, schedule, assigned inspector where permitted, notes, and required next action. |

### 4.11 Support and insurer directory

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-SUP-001 | Must | The platform shall provide an approved insurer directory with call, WhatsApp, email, address, contact person, and operating hours where available. | Entries have an owner, verification date, active status, and controlled publication. |
| FR-SUP-002 | Must | The platform shall provide approved FAQs and regulator/escalation information. | Content is versioned, reviewed, and may be unpublished when expired or unverified. |
| FR-SUP-003 | Should | The platform shall support a customer-support ticket or managed-chat workflow if included in the signed MVP. | Scope must define intake, assignment, SLA, insurer escalation, messages, notes, closure, and reporting. |

### 4.12 Customer self-service and notifications

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-SELF-001 | Must | A customer shall create and access a secure InsurShield account using the approved identity model. | Registration, sign-in, verification, recovery, session, lockout, and device/security controls prevent access to another customer's data. |
| FR-SELF-002 | Must | The self-service area shall show quote drafts/requests, quotations, policies, documents, renewals, claims, NCD applications, inspections, and service requests. | Each item shows status, responsible insurer, latest update, next action, and available documents. |
| FR-SELF-003 | Must | The customer shall manage approved contact details and communication preferences. | Sensitive contact changes require re-verification; consent and preference history is retained. |
| FR-SELF-004 | Must | The platform shall provide an in-product notification centre in addition to approved external channels. | Notifications are linked to the correct record, have read/unread state, and do not expose protected content on unverified devices. |
| FR-SELF-005 | Must | The customer shall download authoritative policy, payment, claim, NCD, and inspection documents when available. | Downloads use protected, expiring links and are recorded where required. |
| FR-SELF-006 | Must | The customer shall manage an approved profile containing identity/contact, drivers, vehicles, communication preferences, security settings, and consent history. | Profile fields use purpose-based permissions; sensitive changes are re-verified and all changes are auditable. |
| FR-SELF-007 | Must | The customer portfolio shall retain permitted historical quotes, policies, payments, renewals, claims, NCD applications, inspections, reviews, service requests, and documents. | Portfolio records are searchable/filterable, use approved retention rules, and link to the authoritative record/status. |

### 4.13 Ratings, reviews, badges, and sponsored disclosure

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-REV-001 | Must | An eligible verified customer shall rate and publicly review an insurer after an approved policy or servicing interaction. | Eligibility is verified server-side, one review per eligible interaction is enforced, and the public review does not expose personal/policy information. |
| FR-REV-002 | Must | The customer shall edit or withdraw a review within the approved policy and see moderation/appeal status. | Edit history is retained, published calculations refresh correctly, and removed content follows retention/legal rules. |
| FR-REV-003 | Must | Public insurer ratings shall disclose the calculation method, review count, period, and verified-review basis. | Ratings are reproducible, meet minimum sample rules, and are not shown as statistically meaningful when thresholds are unmet. |
| FR-BDG-001 | Must | Insurer performance badges shall use approved measurable criteria and defined periods. | Badge name, criteria, threshold, period, data source, minimum evidence, award/expiry, and disclaimer are available and auditable. |
| FR-ADS-001 | Must | Sponsored listings, homepage advertising, and paid insurer placement shall be clearly labelled to customers. | Sponsored content is visually distinct, accessible, approved, time-bound, and never changes quote values, eligibility, or undisclosed objective ranking. |
| FR-ADS-002 | Must | Customers shall be able to understand why sponsored content is shown and access the advertiser's approved profile/product page. | Disclosure, advertiser identity, destination, and applicable targeting explanation are available without exposing sensitive targeting data. |

## 5. Insurance vendor features and requirements

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-IP-001 | Must | Insurer users shall authenticate using secure organisation-bound accounts. | MFA, session expiry, lockout, role permissions, and insurer tenancy are enforced. |
| FR-IP-002 | Must | Insurer users shall view only their organisation's quote, claim, NCD, inspection, and product records. | Cross-insurer access tests fail for all read/write operations. |
| FR-IP-003 | Must | Insurer users shall respond to quote requests with premium, conditions, validity, required actions, and policy terms. | Valid response becomes available to the correct customer and is immutable after acceptance except through controlled revision. |
| FR-IP-004 | Must | Insurer users shall manage their claim and NCD queues using approved transitions. | All actions are permission-checked and audited. |
| FR-IP-005 | Must | Insurer administrators shall submit products, benefits, exclusions, excesses, add-ons, rates, underwriting questions, eligibility, documents, inspection, and NCD rules for InsurShield approval. | Unapproved changes are not visible to customers; effective dates and versions are preserved. |
| FR-IP-006 | Should | Insurer users shall see basic operational metrics. | Metrics use agreed definitions and are limited to the insurer's data. |
| FR-IP-007 | Must | Vendor quote queues shall support assignment, priority, SLA, request-more-information, decline reason, internal notes, and exception status. | Every request has an owner/status; customer-visible and internal information remain separated. |
| FR-IP-008 | Must | Vendor users shall issue or confirm policies and provide authoritative policy documents through the agreed integration or portal workflow. | Paid accepted quotes create one policy response or a visible issuance exception; duplicate issuance is prevented. |
| FR-IP-009 | Must | Vendor users shall process renewals, claims, NCD, and inspection evidence belonging to their organisation. | Each workflow enforces the approved states, permissions, evidence requirements, and customer notifications. |
| FR-IP-010 | Must | Vendor administrators shall manage insurer users, teams, roles, and active status. | Access changes take effect promptly and are fully audited. |
| FR-IP-011 | Should | Vendor administrators shall view API/webhook configuration and integration health where direct integration is enabled. | Credentials are protected; delivery failures, retries, and last successful event are visible without exposing secrets. |
| FR-IP-012 | Should | Vendor reports shall include quote volume/response SLA, conversion, premium, policies, renewals, claims, NCD, and inspection workload. | Metrics use approved definitions, date filters, export controls, and insurer-only data. |
| FR-IP-013 | Should | Vendor finance users shall view approved commission, fee, settlement, and reconciliation records. | Records match the agreed commercial model and can be exported with access controls. |
| FR-IP-014 | Must | Vendor administrators shall maintain an approved public insurer profile. | Brand, description, contacts, service information, products, licence/verification status, ratings, badges, and profile version follow admin approval and publication controls. |
| FR-IP-015 | Must | Authorised vendor users shall respond publicly to eligible customer reviews and privately appeal moderation decisions. | Public responses are moderated, cannot reveal customer/policy data, preserve history, and are visibly identified as insurer responses. |
| FR-IP-016 | Must | Vendor marketing users shall submit sponsored-listing and advertising campaigns for approval and view campaign performance. | Creative, destination, placement, dates, targeting, budget/commercial reference, disclosure, status, impressions, clicks, quote starts, and conversions follow approved access and reporting rules. |

## 6. Administrator features and requirements

| ID | Priority | Requirement | Acceptance criteria |
|---|---|---|---|
| FR-ADM-001 | Must | Administrators shall onboard, verify, activate, suspend, and manage insurer organisations and users. | Only approved active insurers/products are customer-visible; actions are audited. |
| FR-ADM-002 | Must | Administrators shall approve and publish products, benefits, rates, NCD rules, inspection rules, documents, and validity periods. | Each published version has approver, effective dates, and rollback/history. |
| FR-ADM-003 | Must | Administrators shall manage approved regulatory/platform rules through controlled configuration. | Two-person approval is required for high-risk financial or regulatory changes where agreed. |
| FR-ADM-004 | Must | Administrators shall monitor operational status across quote, payment, policy, claim, NCD, inspection, and notification workflows. | Dashboard metrics link to traceable records and exception queues. |
| FR-ADM-005 | Must | Authorised staff shall recover and resend customer tracking links after identity checks. | Resend is rate-limited, records actor/reason/channel, and never exposes the token in logs. |
| FR-ADM-006 | Must | Administrators shall manage approved directory, FAQ, legal, and notification content. | Draft, review, publish, expire, and history states are available. |
| FR-ADM-007 | Must | Administrators shall capture insurer licence/compliance evidence, approval status, effective date, and renewal/expiry date. | Expired, suspended, or unapproved insurers/products are automatically prevented from new customer presentation. |
| FR-ADM-008 | Must | Administrators shall manage the canonical comparison taxonomy and insurer field mappings. | Price, cover, excess, exclusions, add-ons, documents, and conditions are normalised consistently across vendors. |
| FR-ADM-009 | Must | Administrators shall manage platform roles, permissions, user status, and high-risk access reviews. | Privilege changes are approved and audited; dormant/terminated access is removed according to policy. |
| FR-ADM-010 | Must | Administrators shall manage integration configuration and monitor RTSA, insurer, payment, messaging, document, and identity service health. | Current status, latency, failures, retries, callbacks, and exception ownership are visible; secrets are protected. |
| FR-ADM-011 | Must | Administrators shall manage payment, policy, road-tax, insurer-response, notification, commission/fee, and settlement reconciliation queues. | Unmatched or failed transactions have owner, reason, ageing, evidence, and controlled resolution. |
| FR-ADM-012 | Must | Administrators shall review customer complaints and escalations and route them to the responsible vendor or internal owner. | SLA, messages, internal notes, evidence, resolution, and closure reason are tracked. |
| FR-ADM-013 | Must | Administrators shall manage notification templates, events, channels, consent rules, and delivery exceptions. | Only approved active templates are sent; every send is traceable to event and template version. |
| FR-ADM-014 | Must | Administrators shall access immutable audit history and approved operational/regulatory reports. | Filters and exports respect permissions and privacy controls; high-risk events cannot be edited or deleted. |
| FR-ADM-015 | Should | Administrators shall manage privacy requests, retention holds, and approved deletion/anonymisation workflows. | Every request records identity verification, legal decision, affected records, action, and completion evidence. |
| FR-ADM-016 | Should | Administrators shall manage fraud/risk flags and manual-review queues generated by approved rules. | Flags never make an unreviewed adverse decision; outcome, reviewer, reason, and evidence are recorded. |
| FR-ADM-017 | Must | Administrators/moderators shall manage review eligibility, moderation, abuse/fraud flags, evidence, edits/removals, insurer responses, customer/vendor appeals, and publication status. | Every moderation action uses approved reasons, separation of duties where required, SLA, notification, and immutable history. |
| FR-ADM-018 | Must | Administrators shall configure rating calculation and performance-badge methodology. | Metric definitions, sources, weights where permitted, minimum samples, windows, thresholds, recalculation, award/expiry, version, and disclosure are approved and reproducible. |
| FR-ADM-019 | Must | Administrators shall approve, schedule, publish, pause, expire, and reconcile sponsored campaigns and placements. | Inventory limits, advertiser eligibility, creative/destination approval, disclosure, targeting, frequency, dates, measurement, commercial reference, and separation from objective ranking are enforced. |

## 7. Business rules requiring approval

| Rule ID | Rule to approve | Required decision |
|---|---|---|
| BR-001 | Regulatory premium floor | Formula, affected cover types, effective date, configuration owner, and discount ordering. |
| BR-002 | Comprehensive vs Third-Party rating | Separate products, rates, benefits, eligibility, and minimums. |
| BR-003 | Vehicle usage | Categories, eligibility, loadings, evidence, and change rules. |
| BR-004 | Short-period cover | Permitted durations and insurer/product calculation factors. |
| BR-005 | Quote status and SLA | Indicative vs binding, response deadline, partial responses, expiry, revision, and withdrawal. |
| BR-006 | NCD | Approved tiers, portability, issuing insurer, vehicle/policy binding, validity, use, and reversal. |
| BR-007 | Inspection | Required/optional status, method, timing, blocking stage, report, failure, and reinspection. |
| BR-008 | Claims | Reporting window, late submission, policy/coverage eligibility, evidence, states, and appeals. |
| BR-009 | Road tax | Eligibility, authoritative amount, payment, RTSA confirmation, refund, and receipt. |
| BR-010 | Renewal | Eligibility window, reminder schedule, repricing, inspections, and changed-risk data. |
| BR-011 | Currency | ZMW-only MVP or approved multi-currency pricing, exchange rate, rounding, and settlement. |
| BR-012 | Ranking | Objective comparison order, recommendation basis, sponsorship separation, and disclosure. |
| BR-013 | Ratings and reviews | Eligible interactions, one-review rule, rating scale, edits/withdrawals, moderation, evidence, prohibited content, insurer response, appeals, publication, retention, and calculation. |
| BR-014 | Performance badges | Metrics, data sources, thresholds, minimum sample, period, award/expiry, recalculation, disclosure, and suspension. |
| BR-015 | Sponsored placement | Inventory, advertiser eligibility, creative, placement, targeting, labelling, frequency, dates, pricing/billing, measurement, ranking separation, and complaints. |

## 8. Workflow states

### 8.1 Quote and policy

`Draft → Submitted → Insurer Processing → Partially Ready → Quotes Ready → Quote Selected → Payment Pending → Paid → Policy Issuing → Active`

Exception states shall include: `Verification Required`, `Inspection Required`, `Declined`, `Timed Out`, `Expired`, `Payment Failed`, `Issuance Failed`, `Cancelled`, and `Manual Review`.

### 8.2 Claim

The baseline claim model is:

`Submitted → Under Review → Additional Information Required → Approved → Settled`

`Rejected`, `Withdrawn`, `Closed`, and dispute/appeal handling must be approved before implementation. The final model shall define every permitted transition, role, side effect, SLA, and customer notification.

### 8.3 NCD application

`Submitted → Under Review → Verification Required → Approved | Rejected`

### 8.4 Inspection

`Requested → Scheduled → Inspector Assigned → In Progress → Completed → Report Ready → Approved`

`Failed`, `Cancelled`, `No Show`, and `Reinspection Required` shall be included where approved.

### 8.5 Review and moderation

`Draft → Submitted → Automated/Manual Review → Published | Rejected → Edited | Withdrawn | Removed`

`Appeal Submitted`, `Under Appeal`, and `Reinstated` shall be included where approved.

### 8.6 Sponsored campaign

`Draft → Submitted → Under Review → Approved → Scheduled → Active → Paused | Completed | Rejected | Cancelled`

## 9. Integration requirements

| Integration | MVP responsibility | Minimum acceptance |
|---|---|---|
| RTSA | Vehicle/ownership/registration verification and optional road-tax services | Authenticated contract, consent/legal basis, field mapping, availability/error states, audit, and reconciliation for paid services. |
| Insurer systems | Quote distribution/response, policy issuance, claims/NCD/inspection exchange where supported | Versioned contract, authentication, idempotency, timeout/retry, signed callbacks, correlation IDs, and manual fallback. |
| Payment provider | Mobile money and card authorisation | Tokenisation, signed callbacks, idempotency, reconciliation, pending/failure/refund support, and settlement reporting. |
| SMS/email | OTP, tracking, quote, payment, policy, claim, NCD, inspection, and renewal notices | Approved templates, consent, delivery receipts, retries, rate limits, and protected document links. |
| Document storage | Customer uploads, insurer documents, policy certificates, claim and inspection evidence | Encryption, malware scanning, type/size validation, checksums, access control, signed links, retention, and deletion. |
| Identity/authentication | Staff identity and customer verification | Secure sessions, MFA for staff, OTP/token controls for customers, role/tenant enforcement, and audit. |

## 10. Data requirements

The MVP shall maintain authoritative records for:

- Customer/party and authorised-representative relationship.
- Customer account, credentials/security metadata, profile, drivers, vehicles, preferences, devices/sessions, and portfolio links.
- Consent, notice version, declaration, and processing purpose.
- Vehicle and RTSA verification result.
- Insurer organisation, users, products, benefits, rates, and rules.
- Quote session, per-insurer requests/responses, conditions, versions, and expiry.
- Documents and evidence metadata.
- Payment, settlement, reconciliation, refund, and provider references.
- Policy and certificate.
- Claim, timeline, evidence, messages, and decisions.
- NCD application, decision, protected code, eligibility, and redemption.
- Inspection, schedule, evidence, report, and status timeline.
- Notification, template version, channel, destination, delivery, and retries.
- Staff role/permission and immutable audit events.
- Review eligibility, rating, review content, moderation, insurer response, appeals, calculation snapshots, and publication history.
- Performance metric definitions, badge rules, awards, expiry, and evidence snapshots.
- Sponsored campaign, creative, placement, disclosure, targeting rules, schedule, commercial reference, impressions, clicks, quote starts, conversions, and reconciliation.

Data ownership, retention, residency, deletion, and reporting rules shall be approved before production release.

## 11. Non-functional requirements

### 11.1 Security and privacy

- NFR-SEC-001: All protected actions shall be authenticated and authorised server-side.
- NFR-SEC-002: Staff access shall use MFA, least privilege, session expiry, lockout, and organisation tenancy.
- NFR-SEC-003: Customer OTPs/tokens shall be random, expiring, rate-limited, single-purpose, and resistant to enumeration.
- NFR-SEC-004: Data shall be encrypted in transit and at rest using approved standards.
- NFR-SEC-005: The platform shall not store raw payment-card credentials.
- NFR-SEC-006: Uploads shall be validated, malware scanned, access controlled, and served using protected links.
- NFR-SEC-007: Privileged, financial, consent, quote, policy, claim, NCD, inspection, and configuration actions shall be auditable.
- NFR-SEC-008: Customer accounts shall support secure registration, password/passkey or approved authentication, verification, recovery, session/device control, rate limiting, and compromised-account response.
- NFR-PRI-001: Privacy notices, legal basis/consent, sharing, retention, data-subject requests, and breach response shall comply with the approved Zambian legal and regulatory position.
- NFR-TRU-001: Reviews, ratings, badges, and advertising shall implement abuse prevention, moderation, appeals, transparency, accessibility, and privacy-by-design controls.

### 11.2 Reliability and consistency

- NFR-REL-001: Financial and external workflow operations shall be idempotent.
- NFR-REL-002: Each asynchronous workflow shall expose pending, success, partial success, failure, timeout, retry, and manual-review states.
- NFR-REL-003: Payment, policy, road-tax, and insurer responses shall be reconciled against provider records.
- NFR-REL-004: Invalid or stale state transitions shall be rejected.
- NFR-REL-005: Backup, recovery, RPO, and RTO targets shall be approved before release.

### 11.3 Performance and low-bandwidth experience

- NFR-PER-001: The responsive customer application shall remain usable on supported basic smartphones and common 3G conditions.
- NFR-PER-002: Critical pages shall target a p75 Largest Contentful Paint of 2.5 seconds or better on the agreed mobile test profile.
- NFR-PER-003: Synchronous API responses under InsurShield control shall target p95 of two seconds, excluding documented external-provider latency.
- NFR-PER-004: Quote submission shall acknowledge receipt within five seconds when dependencies are available; insurer responses shall remain asynchronous.
- NFR-PER-005: Images and uploads shall be compressed/optimised without compromising regulatory or claims evidence.

### 11.4 Availability and operability

- NFR-OPS-001: MVP production availability target shall be at least 99.5% monthly, excluding approved maintenance windows, unless contractually changed.
- NFR-OPS-002: External calls shall emit correlation IDs, safe logs, metrics, traces, and actionable alerts without exposing sensitive data.
- NFR-OPS-003: Critical failures shall enter an exception queue with owner, age, status, and resolution notes.
- NFR-OPS-004: Product/rate/configuration changes shall be versioned, effective-dated, approved, and reversible.

### 11.5 Accessibility, localisation, and compatibility

- NFR-UX-001: Customer and portal experiences shall meet WCAG 2.2 AA for agreed user journeys.
- NFR-UX-002: All controls shall support keyboard access, visible focus, programmatic labels, associated errors, and non-colour status cues.
- NFR-UX-003: Motion shall respect reduced-motion preferences.
- NFR-UX-004: MVP content and formatting shall support Zambian English, ZMW currency, local telephone formats, and local date presentation.
- NFR-UX-005: Browser support shall cover agreed current versions of Chrome, Edge, Firefox, and Safari, including supported Android and iOS browsers.

## 12. MVP release acceptance

The MVP may be accepted for production release only when:

1. All Must requirements have passed agreed functional acceptance tests.
2. Launch insurers, products, rates, rules, benefits, contacts, and policy documents are approved.
3. Premium, NCD, date, tax/fee, road-tax, claim, and inspection rule matrices are approved and automated.
4. Staff routes and APIs enforce authentication, MFA, permissions, and insurer tenancy.
5. Customer identity and recovery journeys resist enumeration, replay, brute force, and cross-customer access.
6. Payment and policy issuance pass duplicate, delayed, failed, reversed, and reconciliation scenarios.
7. Required integrations pass sandbox, contract, timeout, retry, callback, and manual-fallback tests.
8. Customer documents and personal data pass security, privacy, retention, and access-control review.
9. Legal copy, regulatory statements, insurer claims, certifications, and escalation details are approved by accountable owners.
10. Accessibility, performance, compatibility, monitoring, backup, recovery, and support-readiness criteria are met.
11. No unresolved critical or high-severity defects remain unless formally accepted with a documented workaround and owner.
12. Client/UAT sign-off and operational go-live approval are complete.
13. Customer registration, sign-in, recovery, profile, portfolio, and cross-device tracking pass functional, privacy, security, and access-control tests.
14. Verified-review eligibility, moderation, insurer response, appeals, rating calculations, badge calculations, and disclosure pass approved test scenarios.
15. Sponsored content passes advertiser approval, placement, labelling, targeting, frequency, measurement, ranking-separation, billing/reconciliation, and complaint tests.

## 13. Out of scope for MVP

- Native Android and iOS applications.
- Non-motor insurance categories.
- Advanced marketing/demographic analytics.
- Regulator self-service dashboard and automated quarterly reporting.
- Microinsurance products.
- AI-driven recommendation or underwriting features.

## 14. Assumptions and dependencies

- Required RTSA and insurer interfaces are legally and technically available.
- Launch insurers provide approved products, rates, rules, policy terms, contacts, and test support.
- Payment, messaging, authentication, document, and hosting providers are selected on time.
- Regulatory, legal, privacy, security, retention, and data-hosting requirements are approved before production design is frozen.
- The project receives representative test data and sandbox access.
- Content owners review and approve customer-facing language.
- Commercial arrangements, settlement, commission, fees, and post-launch support are documented outside or alongside this specification.

## 15. Scope and decision register

| Decision ID | Decision required | Owner | Due date | Approved outcome |
|---|---|---|---|---|
| DEC-001 | MVP channel: responsive web vs native applications | Client sponsor/Product owner |  |  |
| DEC-002 | Launch insurers and motor products | Product owner |  |  |
| DEC-003 | Regulatory premium-floor formula and discount ordering | Compliance/Product owner |  |  |
| DEC-004 | Comprehensive/TPO and usage rating rules | Product owner/Insurers |  |  |
| DEC-005 | Quote authority, SLA, expiry, and partial-response rules | Product owner/Insurers |  |  |
| DEC-006 | Approved NCD scale and lifecycle | Product owner/Insurers |  |  |
| DEC-007 | RTSA and road-tax integration scope | Product owner/Technical lead |  |  |
| DEC-008 | Payment providers, currency, settlement, and refunds | Finance/Product owner |  |  |
| DEC-009 | Customer account, identity, profile, portfolio, recovery, and data lifecycle model | Product owner/Security |  |  |
| DEC-010 | Claims and inspection operating rules | Product owner/Insurers |  |  |
| DEC-011 | Privacy, hosting, retention, security, and audit obligations | Legal/Compliance/Security |  |  |
| DEC-012 | Support ticketing/live chat in MVP | Product owner |  |  |
| DEC-013 | Commercial model and insurer settlement | Client sponsor/Finance |  |  |
| DEC-014 | Review eligibility, moderation, appeals, rating calculation, and performance-badge methodology | Product owner/Compliance |  |  |
| DEC-015 | Sponsored inventory, disclosure, targeting, measurement, pricing/billing, and ranking separation | Client sponsor/Product owner/Compliance |  |  |

## 16. Change control

After approval, any addition, removal, or material modification to the MVP requirements shall be recorded as a change request containing:

- Requested change and business rationale.
- Affected requirements and workflows.
- Delivery, cost, schedule, security, compliance, and operational impact.
- Decision owner and approval date.
- Updated specification version and traceability to implementation/testing.

## 17. Sign-off

Approval confirms that the parties accept this document as the baseline for MVP solution design, implementation, testing, and release planning, subject to the decisions recorded in Section 15.

| Role | Name | Organisation | Signature | Date |
|---|---|---|---|---|
| Client sponsor |  |  |  |  |
| Product owner |  |  |  |  |
| Delivery lead |  |  |  |  |
| Technical lead |  |  |  |  |
| Compliance/legal reviewer |  |  |  |  |
