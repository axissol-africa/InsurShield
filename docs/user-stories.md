# InsurShield MVP User Stories

**Document status:** Draft for backlog refinement and stakeholder review  
**Version:** 0.11  
**Date:** 28 October 2026  
**Classification:** Commercial-in-confidence  
**Related documents:** InsurShield Product Brief; InsurShield MVP Requirements Specification

## 1. Purpose

This document converts the approved MVP direction into a prioritised, testable user-story backlog for the three InsurShield user types:

1. Customers.
2. Insurance vendors.
3. InsurShield administrators.

The stories define product behaviour and acceptance, not sprint commitments. The delivery team must estimate, sequence, split, and assign stories during backlog refinement without changing their approved business outcome.

## 2. Story conventions

- **Must:** Required for MVP acceptance unless removed through approved change control.
- **Should:** Valuable for MVP completeness but may be scheduled subject to dependency and capacity approval.
- **Status: Deferred:** Outside the MVP; the priority applies when the scope returns.
- **Requirement references:** Trace each story to the MVP Requirements Specification.
- **Acceptance criteria:** Minimum observable behaviour required for product acceptance; security, audit, performance, and accessibility requirements also apply.

## 3. Backlog summary

| User type | Stories | Must | Should | Deferred |
|---|---:|---:|---:|---:|
| Customer | 26 | 25 | 1 | 0 |
| Insurance vendor | 14 | 11 | 2 | 1 |
| InsurShield administrator | 16 | 14 | 1 | 1 |
| **Total** | **56** | **50** | **4** | **2** |

## 4. Customer user stories

### Epic C1 - Access, identity, and consent

#### US-CUS-001 - Start the correct journey

**Priority:** Must  
**Requirement references:** FR-CUS-001

**User story:** As a customer, I want to choose the service I need from a clear starting point so that I can begin a new quote, recover a request, renew, claim, apply for NCD, request an inspection, or contact an insurer without confusion.

**Acceptance criteria:**

- Given I am on the customer home page, when I review the available actions, then each supported journey is clearly labelled in plain language.
- Given I select an action, when the journey opens, then I see the correct introduction, required information, and expected outcome.
- Given I open a protected journey, when I have not verified my identity, then no customer-specific information is exposed.
- Given I use a supported mobile browser, when I navigate the page, then all actions remain usable without horizontal page scrolling.

#### US-CUS-002 - Verify customer identity

**Priority:** Must  
**Requirement references:** FR-CUS-003, FR-TRK-002, NFR-SEC-003

**User story:** As a customer, I want to verify my email address so that I can securely access my quotes, policies, claims, NCD applications, and inspections.

**Acceptance criteria:**

- Given I register with my email, when I submit, then a single-purpose verification link is sent and protected records stay closed until I use it.
- Given I sign in with a verified email and correct password, then a time-limited session is created.
- Given a wrong password, an expired or reused link, or an unknown email, then access is denied without revealing whether an account exists.
- Given attempt or resend limits are exceeded, when I try again, then the platform applies the approved cooldown or recovery process.

#### US-CUS-003 - Accept privacy, terms, and declarations

**Priority:** Must  
**Requirement references:** FR-CUS-004, FR-CUS-005, FR-ELG-004

**User story:** As a customer, I want to review and accept the relevant notices and declarations so that I understand how my information and insurance request will be handled.

**Acceptance criteria:**

- Given a notice or declaration is required for my action, when I reach the relevant step, then the current approved wording is displayed before I may continue.
- Given multiple declarations are mandatory, when any declaration remains unaccepted, then submission is blocked and the outstanding item is identified.
- Given I accept the notices, when acceptance is recorded, then notice type, version, purpose, session/actor, and timestamp are retained.
- Given a notice version changes before I complete the transaction, when I return, then I am asked to review and accept the new version where required.

#### US-CUS-004 - Manage contact details and communication preferences

**Priority:** Must  
**Requirement references:** FR-SELF-003, NFR-PRI-001

**User story:** As a customer, I want to manage my contact details and communication preferences so that I receive important updates through the correct channels.

**Acceptance criteria:**

- Given I am verified, when I view my profile, then my permitted contact details and channel preferences are displayed.
- Given I change a sensitive contact detail, when I save it, then the new detail is re-verified before becoming active.
- Given I update optional communication preferences, when I save them, then future eligible notifications follow the latest approved preference.
- Given a message is legally or operationally mandatory, when optional marketing is disabled, then the mandatory notice still follows the approved legal rule.

### Epic C2 - Motor quote setup

#### US-CUS-005 - Choose motor cover

**Priority:** Must  
**Requirement references:** FR-VEH-001

**User story:** As a customer, I want to understand and choose Comprehensive or Third-Party Only cover so that I request the appropriate insurance product.

**Acceptance criteria:**

- Given I start a motor quote, when cover options are displayed, then each option includes an approved plain-language explanation of principal cover and exclusions.
- Given I select a cover type, when I continue, then the selection is saved with the quote draft.
- Given I change cover type later, when eligibility and pricing are recalculated, then incompatible prior selections are clearly removed or flagged.

#### US-CUS-006 - Identify my vehicle

**Priority:** Must  
**Requirement references:** FR-VEH-002, FR-VEH-003

**User story:** As a customer, I want the platform to retrieve or capture my vehicle details so that insurers receive accurate registration information.

**Acceptance criteria:**

- Given RTSA lookup is available, when I submit a valid registration number and required consent, then the approved vehicle and ownership fields are returned and timestamped.
- Given lookup fails or manual entry is permitted, when I choose manual entry, then all required fields are presented and validated.
- Given retrieved information conflicts with my documents, when I report the mismatch, then the quote is paused or routed for approved review rather than silently overwritten.
- Given a lookup error occurs, when I retry or use the fallback, then information already entered is preserved.

#### US-CUS-007 - Declare vehicle value and usage

**Priority:** Must  
**Requirement references:** FR-VEH-004, FR-VEH-005

**User story:** As a customer, I want to declare an accurate vehicle value and primary usage so that eligibility, pricing, and future claim expectations are based on the correct risk.

**Acceptance criteria:**

- Given I enter a vehicle value, when it is zero, negative, or outside approved thresholds, then I cannot continue without correction or authorised review.
- Given I review the valuation warning, when I accept it, then the accepted version and value are recorded with the quote.
- Given I select a usage category, when I continue, then eligibility and rating are recalculated.
- Given a usage is unsupported, when selected, then I receive a clear explanation and assistance path.

#### US-CUS-008 - Provide driver and risk information

**Priority:** Must  
**Requirement references:** FR-VEH-007, FR-PRM-001

**User story:** As a customer, I want to answer only the driver and risk questions relevant to the products I choose so that quotations are accurate without unnecessary data collection.

**Acceptance criteria:**

- Given I have answered the common questions and chosen my products, when the extra questions load, then only the questions those products require are displayed, each asked once.
- Given required information includes regular driver, licence history, prior claims, parking/location, security, or annual usage, when I leave it incomplete, then the request cannot be submitted until the products that need it are answered or removed.
- Given different insurers require different questions, when I provide a shared answer, then it is reused without asking me repeatedly.
- Given I change an answer that affects eligibility or premium, when I continue, then affected quotations are recalculated or re-requested.

#### US-CUS-009 - View and select eligible insurer products

**Priority:** Must  
**Requirement references:** FR-ELG-001, FR-ELG-002, FR-ELG-003

**User story:** As a customer, I want to see and select eligible approved insurer products so that I can request competitive quotations from providers able to cover my risk.

**Acceptance criteria:**

- Given my quote details are complete, when eligibility is evaluated, then only active approved products that support my cover, vehicle, usage, and risk are displayed.
- Given product cards are shown, when I review them, then product, indicative information where permitted, key benefits, inspection requirement, and NCD eligibility use consistent fields.
- Given I select products, when the count is between one and five, then I may continue.
- Given I attempt to select a sixth product, when the limit is reached, then the platform prevents it and explains the limit.

#### US-CUS-010 - Save and resume a quote

**Priority:** Must  
**Requirement references:** FR-QTE-008, FR-SELF-001

**User story:** As a customer, I want to save and securely resume an incomplete quote so that I do not lose progress when I leave the application.

**Acceptance criteria:**

- Given I have entered valid quote information, when I leave or explicitly save, then the latest valid draft is stored server-side.
- Given I return before draft expiry, when I verify my identity, then the latest draft and current completion point are restored.
- Given product rules or notices changed since saving, when I resume, then affected answers are revalidated and re-acceptance is requested where required.
- Given a draft expired, when I attempt recovery, then I am informed and offered an approved restart path.

### Epic C3 - Quote request, comparison, and purchase

#### US-CUS-011 - Complete quote details and policy period

**Priority:** Must  
**Requirement references:** FR-QTE-001, FR-QTE-002, FR-QTE-003

**User story:** As a customer, I want to provide my contact and policy-period details so that insurers can return quotations for the required start date and duration.

**Acceptance criteria:**

- Given I reach quote details, when I submit the form, then required contact, start date, duration, vehicle, cover, usage, and selected-product information is present.
- Given I select a start date, when it is outside the permitted range, then it is rejected with a clear message.
- Given I select a duration, when an insurer/product does not support it, then that option is not offered for that request.
- Given I change date or duration, when premiums are refreshed, then period and expiry information remain consistent.

#### US-CUS-012 - Upload required documents and inspection evidence

**Priority:** Must  
**Requirement references:** FR-QTE-004, FR-QTE-005, FR-INS-003, NFR-SEC-006

**User story:** As a customer, I want to upload the documents and images required for the products I chose so that my quote can be assessed without avoidable follow-up.

**Acceptance criteria:**

- Given document rules are known, when the upload step opens, then mandatory and optional documents are clearly distinguished by insurer/product.
- Given I upload a permitted file, when processing completes, then type, size, malware, integrity, and readability checks return an understandable result.
- Given mandatory evidence is missing or rejected, when I submit, then the product that needs it is named, and I upload it or remove that product before submitting.
- Given I replace a document, when the new version is accepted, then the prior version remains controlled according to retention/audit rules.

#### US-CUS-013 - Submit and track a quote request

**Priority:** Must  
**Requirement references:** FR-QTE-006, FR-QTE-007, FR-TRK-001

**User story:** As a customer, I want to submit one request for the products I chose and track each response so that I know what is ready and what still requires action.

**Acceptance criteria:**

- Given the quote is complete, when I submit, then one customer reference and one idempotent request per insurer of the chosen products are created.
- Given submission succeeds, when acknowledgement is returned, then I see the reference, current status and expected next step, and the request appears in my account.
- Given insurers respond at different times, when I track the request, then ready, pending, declined, timed-out, inspection-required, more-information, and failed states are distinguishable.
- Given message delivery fails, when the request exists, then the request stays in my account with its reference and the email is retried.

#### US-CUS-014 - Compare quotations

**Priority:** Must  
**Requirement references:** FR-CMP-001, FR-CMP-004

**User story:** As a customer, I want to compare ready quotations using consistent criteria so that I can judge value rather than price alone.

**Acceptance criteria:**

- Given at least one quote is ready, when I open comparison, then insurer/product, final premium, premium components, cover, excess, benefits, exclusions/conditions, inspection status, validity, and terms are shown.
- Given multiple quotes are ready, when I sort or filter, then I can use final price, cover, excess, inspection, selected benefits/add-ons, and status.
- Given some chosen products are pending, when I compare ready quotes, then pending responses remain visible without blocking selection unless the approved rule requires waiting.
- Given a value is unavailable, when the comparison is rendered, then it is shown as unavailable rather than replaced by a misleading default.

#### US-CUS-015 - Review add-ons, conditions, and recommendation basis

**Priority:** Must  
**Requirement references:** FR-CMP-002, FR-CMP-005

**User story:** As a customer, I want to understand optional add-ons, material conditions, and any recommendation label so that I can make an informed purchase.

**Acceptance criteria:**

- Given an insurer offers add-ons, when I select or remove one, then its benefit, exclusions, excess, and price impact are displayed before confirmation.
- Given a quote has a purchase-critical condition, when I attempt selection, then I must review and accept the condition before payment.
- Given a quote is labelled recommended or best value, when I inspect the label, then the approved ranking basis is disclosed.
- Given sponsored placement is not in MVP, when quotes are ordered, then no paid placement influences objective comparison.

#### US-CUS-016 - Pay securely for the selected quote

**Priority:** Must  
**Requirement references:** FR-PAY-001, FR-PAY-002, FR-PAY-003

**User story:** As a customer, I want to pay using an approved mobile-money or card method so that I can complete my insurance purchase securely.

**Acceptance criteria:**

- Given a valid quote is selected, when payment opens, then the itemised premium, taxes/fees, and add-ons equal the authoritative total.
- Given I choose an approved payment method, when I authorise payment, then raw card credentials are handled by the approved provider and are not stored by InsurShield.
- Given payment is pending, failed, cancelled, duplicated, or delayed, when provider status changes, then the platform shows the correct state without duplicate charge or policy.
- Given the quote expires before payment authorisation, when I attempt to pay, then payment is blocked and the refresh/requote path is shown.

#### US-CUS-017 - Receive policy confirmation and documents

**Priority:** Must  
**Requirement references:** FR-PAY-004, FR-POL-001, FR-POL-002

**User story:** As a customer, I want authoritative confirmation and policy documents after successful payment so that I can prove and understand my cover.

**Acceptance criteria:**

- Given payment is authoritatively successful and the insurer accepts issuance, when the policy response arrives, then one policy is created and linked to the payment/quote.
- Given policy issuance is complete, when I view confirmation, then policy number, insurer/product, vehicle, cover, dates, premium, status, and certificate are shown.
- Given issuance is delayed or fails after payment, when I track the purchase, then an explicit issuance exception and support/refund process are visible.
- Given confirmation is sent externally, when delivery succeeds or fails, then the result and retry status are recorded.

### Epic C4 - Self-service and policy servicing

#### US-CUS-018 - Create and manage my account and insurance portfolio

**Priority:** Must  
**Requirement references:** FR-SELF-001, FR-SELF-002, FR-SELF-005, FR-SELF-006, FR-SELF-007, NFR-SEC-008

**User story:** As a customer, I want a secure account, profile, and insurance portfolio so that I can manage my identity, vehicles, drivers, policies, tracking, documents, and servicing from one place.

**Acceptance criteria:**

- Given I register, when I complete approved identity/contact verification and authentication setup, then one customer account is created without duplicating an existing verified identity.
- Given I sign in or recover access, when authentication succeeds, then approved session/device controls are applied and only my records are available.
- Given I manage my profile, when I add/update permitted identity/contact, drivers, vehicles, preferences, security settings, or consent, then sensitive changes are re-verified and audited.
- Given the portfolio loads, when I review it, then current and permitted historical quote, payment, policy, renewal, claim, NCD, inspection, review, document, and service-request records are searchable/filterable.
- Given an item requires action, when displayed, then responsible insurer, current status, latest update, next action, and due date/SLA are clear.
- Given an authoritative document is available, when I select download, then a protected expiring link is used.
- Given no records exist for a category, when I open it, then an informative empty state and permitted start action are shown.

#### US-CUS-019 - Receive and review notifications

**Priority:** Must  
**Requirement references:** FR-SELF-004, FR-REN-003, FR-POL-002

**User story:** As a customer, I want timely in-product and external notifications so that I do not miss quote, payment, policy, claim, NCD, inspection, or renewal actions.

**Acceptance criteria:**

- Given an approved notification event occurs, when the message is generated, then the active template version and permitted channel are used.
- Given I open the notification centre, when messages are listed, then read/unread state, linked record, event time, and next action are visible.
- Given an external delivery fails, when retry policy applies, then the platform retries or raises an exception without duplicating successful deliveries.
- Given content is protected, when a notification appears on an unverified device, then sensitive details are not exposed.

#### US-CUS-020 - Renew an eligible policy

**Priority:** Must  
**Requirement references:** FR-REN-001, FR-REN-002, FR-REN-003

**User story:** As a policyholder, I want to review and renew an eligible policy so that I can maintain cover with accurate current risk information.

**Acceptance criteria:**

- Given a policy enters the approved renewal window, when I access it after verification, then renewal status and reminder information are shown.
- Given I start renewal, when the form opens, then verified policy, customer, vehicle, and prior-insurer information are prefilled.
- Given mutable risk information may have changed, when I continue, then I must review and confirm or update it before a renewal quote is requested.
- Given a renewed policy is paid and issued, when the old policy expires, then the new policy dates and NCD treatment follow the approved rule.

#### US-CUS-021 - Request policy service or support

**Priority:** Should  
**Requirement references:** FR-POL-003, FR-SUP-001, FR-SUP-002

**User story:** As a policyholder, I want to request document replacement, policy changes, cancellation, or assistance so that I have a traceable servicing path.

**Acceptance criteria:**

- Given I select a supported request type, when I submit the required reason/evidence, then a service reference is created and routed to the responsible owner.
- Given a request requires insurer approval, when I submit it, then no policy data is changed until the authorised decision is recorded.
- Given I need direct contact, when I view the insurer directory, then verified phone, WhatsApp, email, address, contact person, and hours are available where approved.
- Given a complaint cannot be resolved by the insurer, when escalation criteria are met, then approved InsurShield/regulatory guidance is shown.

### Epic C5 - Claims, NCD, and inspections

#### US-CUS-022 - Submit and track a claim

**Priority:** Must  
**Requirement references:** FR-CLM-001 to FR-CLM-007

**User story:** As a policyholder or authorised claimant, I want to submit and track a claim so that the responsible insurer receives complete incident information and I can follow its progress.

**Acceptance criteria:**

- Given I identify a vehicle/policy after verification, when I start a claim, then the responsible insurer and eligible cover are retrieved without exposing unrelated data.
- Given claim type is selected, when the form loads, then the required incident, claimant, police, loss, and evidence fields follow the approved claim rules.
- Given coverage mismatch, policy ineligibility, or late reporting applies, when I submit, then the approved block/manual-review/late-reason process is enforced without losing my data.
- Given submission succeeds, when the claim is created, then a reference, initial status, responsible insurer, target date, and timeline event are shown and notified.
- Given the insurer requests information or changes status, when I track the claim, then I can view the timeline and the insurer's updates.

#### US-CUS-023 - Apply for and use NCD

**Priority:** Must  
**Requirement references:** FR-NCD-001 to FR-NCD-004

**User story:** As a claim-free policyholder, I want to apply for, track, and use an approved NCD so that an eligible discount is correctly applied to my next policy.

**Acceptance criteria:**

- Given I apply for NCD, when I submit customer, insurer, policy, claim-free history, and declaration, then a unique application reference and initial status are created.
- Given the insurer requests verification, approves, or rejects the application, when status changes, then the decision reason/next action and notification are available.
- Given a protected NCD code is approved, when I use it on a quote, then insurer, policy/vehicle, validity, tier, and use rules are validated server-side.
- Given a code is invalid, expired, revoked, wrong-insurer, wrong-record, or already used, when validation occurs, then no discount is applied and a safe explanation is shown.

#### US-CUS-024 - Request and track a vehicle inspection

**Priority:** Must  
**Requirement references:** FR-INS-001 to FR-INS-004

**User story:** As a customer, I want to schedule and track a required vehicle inspection so that underwriting or claim assessment can continue.

**Acceptance criteria:**

- Given an inspection rule applies, when I view the requirement, then method, blocking stage, required evidence, and next action are clear.
- Given scheduling is required, when I submit vehicle, preferred date/time/location, and notes, then one inspection reference is created.
- Given photo capture is required, when I upload front, rear, left, right, dashboard/mileage, or engine-bay evidence, then file controls and slot completeness are enforced.
- Given inspection status changes, when I track it, then schedule, current state, assigned inspector where permitted, report status, failure/reinspection action, and notifications are visible.

### Epic C6 - Ratings, reviews, and badges

#### US-CUS-025 - Rate and review an insurer

**Priority:** Must  
**Requirement references:** FR-REV-001, FR-REV-002, FR-REV-003, NFR-TRU-001

**User story:** As a verified customer, I want to rate and publicly review an insurer after an eligible interaction so that other customers can learn from genuine experiences and insurers can improve service.

**Acceptance criteria:**

- Given I completed an approved policy or servicing interaction, when review eligibility is checked, then I may submit one review for that interaction.
- Given I submit a rating and review, when validation/moderation runs, then personal, policy, claim, payment, and prohibited information is not published.
- Given the review is published, when displayed, then it is marked verified and shows the permitted rating, review text, interaction category, date/period, and insurer response where available.
- Given I edit or withdraw my review within policy, when approved, then version/history, public display, and aggregate rating update correctly.
- Given my review is rejected/removed or disputed, when I view status, then the approved reason and appeal process are available.

#### US-CUS-026 - Understand performance badges

**Priority:** Must  
**Requirement references:** FR-BDG-001, BR-012, BR-014

**User story:** As a customer, I want to understand insurer performance badges so that I can distinguish measured performance from objective quote comparison.

**Acceptance criteria:**

- Given an insurer displays a performance badge, when I open its explanation, then metric, period, data source, threshold, sample/evidence basis, award/expiry, and disclaimer are available.
- Given a badge lacks the approved evidence threshold or has expired/suspended, when the profile/comparison loads, then the badge is not displayed as active.
- Given I compare quotations, when objective sorting/ranking is applied, then sponsorship does not change quote values, eligibility, or undisclosed organic order.

## 5. Insurance vendor user stories

### Epic V1 - Vendor access and product participation

#### US-VEN-001 - Access the insurer portal securely

**Priority:** Must  
**Requirement references:** FR-IP-001, FR-IP-002

**User story:** As an insurance-vendor user, I want secure organisation-bound access so that I can work only with my insurer's records and assigned functions.

**Acceptance criteria:**

- Given I have an active vendor account, when I authenticate with the required factors, then a role- and organisation-bound session is created.
- Given I attempt to access another insurer's record or an unassigned function, when authorisation is evaluated, then access is denied and audited.
- Given my account is suspended, expired, locked, or removed, when I attempt access, then no portal data is returned.
- Given the session expires, when I continue working, then re-authentication is required without exposing unsaved protected data.

#### US-VEN-002 - Manage vendor users and teams

**Priority:** Must  
**Requirement references:** FR-IP-010

**User story:** As an insurer administrator, I want to manage users, teams, roles, and status so that work is assigned to authorised staff.

**Acceptance criteria:**

- Given I have vendor-administrator permission, when I create or update a user, then only approved insurer roles may be assigned.
- Given a user changes team or status, when saved, then access and queue eligibility update promptly.
- Given a user is deactivated, when existing sessions are reviewed, then they are revoked according to policy.
- Given a role change occurs, when audited, then actor, target user, before/after permissions, reason, and time are available.

#### US-VEN-003 - Submit insurance products and commercial terms

**Priority:** Must  
**Requirement references:** FR-IP-005, FR-ADM-002

**User story:** As an insurer product administrator, I want to submit product definitions for approval so that customers can compare accurate, authorised offerings.

**Acceptance criteria:**

- Given I create a product version, when I save it, then cover, benefits, exclusions, excesses, add-ons, documents, policy terms, dates, and status are captured.
- Given required product information is incomplete or inconsistent, when I submit for approval, then submission is blocked with validation details.
- Given a product is pending approval, when I edit it, then a new controlled draft/version is created without changing the published version.
- Given InsurShield approves or rejects the submission, when the decision is recorded, then I can see decision, comments, approver, and effective dates.

#### US-VEN-004 - Submit rating, eligibility, NCD, and inspection rules

**Priority:** Must  
**Requirement references:** FR-IP-005, FR-PRM-001 to FR-PRM-003, FR-INS-001

**User story:** As an insurer product administrator, I want to configure and submit underwriting/rating rules so that the platform requests the right information and returns valid products.

**Acceptance criteria:**

- Given a product draft exists, when I configure rules, then cover, usage, vehicle, driver/risk questions, rate factors, duration, loadings, discounts, NCD, documents, and inspections can be defined.
- Given a rule references an unsupported field or creates a conflict, when validated, then it cannot be submitted until corrected.
- Given a financial/risk rule changes, when submitted, then effective date, version, test examples, and approval status are required.
- Given an approved rule becomes active, when quotes are requested, then the published version is used consistently and is traceable.

### Epic V2 - Vendor operations

#### US-VEN-005 - Manage quote queues and SLAs

**Priority:** Must  
**Requirement references:** FR-IP-007

**User story:** As a quotation officer, I want assigned and prioritised quote queues so that I can respond within agreed service levels.

**Acceptance criteria:**

- Given eligible requests reach my insurer, when the queue loads, then owner, priority, age, SLA, status, and required action are visible.
- Given I have assignment permission, when I assign/reassign a request, then ownership and audit history update.
- Given a request approaches or breaches SLA, when thresholds are reached, then approved warning/escalation behaviour occurs.
- Given I filter/search the queue, when results load, then only my insurer's authorised records are returned.

#### US-VEN-006 - Request information, decline, or return a quote

**Priority:** Must  
**Requirement references:** FR-IP-003, FR-IP-007

**User story:** As a quotation officer, I want to request more information, decline with a reason, or return a complete quote so that the customer receives a clear outcome.

**Acceptance criteria:**

- Given required information is missing, when I request it, then customer-visible questions/documents, due date, status, and notification are recorded.
- Given the risk is ineligible, when I decline, then an approved decline reason is mandatory and customer/internal wording remain separated.
- Given I return a quote, when I submit premium, components, excess, add-ons, conditions, validity, inspection actions, and terms, then validation completes before customer publication.
- Given a quote is accepted or expired, when I attempt material revision, then the platform follows the approved revision/requote rule.

#### US-VEN-007 - Issue policies and process renewals

**Priority:** Must  
**Requirement references:** FR-IP-008, FR-IP-009, FR-PAY-004, FR-REN-002

**User story:** As an insurer operations user, I want to issue accepted policies and process renewals so that paid customers receive authoritative continuous cover.

**Acceptance criteria:**

- Given a valid accepted quote and authoritative payment success, when issuance is processed, then one policy number, status, dates, and certificate are returned.
- Given issuance fails or remains pending, when status is updated, then a traceable exception and resolution responsibility are created.
- Given a renewal request is received, when risk changes are reviewed, then I can requote, request information/inspection, decline, or issue according to approved rules.
- Given duplicate issuance/replay is attempted, when idempotency is checked, then no second policy is created.

#### US-VEN-008 - Process claims and post updates

**Priority:** Must  
**Requirement references:** FR-IP-004, FR-IP-009, FR-CLM-001 to FR-CLM-007

**User story:** As a claims officer, I want to review evidence, update claim status, and post updates the claimant sees so that claims progress through an approved, auditable process.

**Acceptance criteria:**

- Given a claim belongs to my insurer, when I open it, then policy/cover, incident, evidence, timeline, updates, SLA, and current action are visible.
- Given additional information is required, when I request it, then required evidence, due date, status, and customer notification are recorded.
- Given I change status, when I submit, then only an approved transition is allowed and actor, reason, note, time, and notification are recorded.
- Given I add internal notes or customer-visible updates, when saved, then internal notes never reach the customer.

#### US-VEN-009 - Review NCD applications and issue codes

**Priority:** Must  
**Requirement references:** FR-IP-004, FR-IP-009, FR-NCD-003, FR-NCD-004

**User story:** As an NCD officer, I want to verify claim-free history and decide applications so that eligible customers receive controlled discount codes.

**Acceptance criteria:**

- Given an NCD application belongs to my insurer, when I review it, then policy, vehicle, claim-free history, evidence, declaration, and status are available.
- Given more verification is required, when I request it, then status, required evidence, due date, and customer notification update.
- Given I approve, when the decision is saved, then the code is securely issued with insurer, policy/vehicle, tier, validity, and use rules.
- Given I reject, when the decision is saved, then an approved reason and appeal/assistance path are recorded.

#### US-VEN-010 - Review inspections and reports

**Priority:** Must  
**Requirement references:** FR-IP-009, FR-INS-001 to FR-INS-004

**User story:** As an insurer inspection or claims user, I want to review inspection evidence and outcomes so that underwriting and claims decisions use verified vehicle condition information.

**Acceptance criteria:**

- Given an inspection belongs to my insurer/product, when I open it, then purpose, method, schedule, evidence, report, history, and blocking stage are visible.
- Given evidence is incomplete or unusable, when I request reinspection/information, then status, reason, next action, and customer notification update.
- Given a report is approved or failed, when the decision is recorded, then affected quote, policy, or claim workflow advances or blocks according to rule.
- Given pre-loss and post-loss evidence exists, when authorised comparison is performed, then both records remain immutable and traceable.

### Epic V3 - Vendor integration and insight

#### US-VEN-011 - Monitor insurer integration events

**Priority:** Should  
**Requirement references:** FR-IP-011, NFR-OPS-002

**User story:** As an insurer integration administrator, I want to view API/webhook health and failed events so that technical issues can be resolved quickly.

**Acceptance criteria:**

- Given direct integration is enabled, when I view health, then endpoint/service status, last success, latency, failed/retrying events, and correlation IDs are available.
- Given an event fails, when retry or manual replay is permitted, then the action is controlled, idempotent, and audited.
- Given credentials are configured, when displayed or exported, then secret values are never revealed.
- Given a platform-wide issue occurs, when vendor status is shown, then affected services and approved communication are visible.

#### US-VEN-012 - View vendor performance and finance reports

**Priority:** Should  
**Requirement references:** FR-IP-006, FR-IP-012, FR-IP-013

**User story:** As an insurer manager or finance user, I want role-appropriate operational and financial reporting so that I can manage response, conversion, workload, and settlement.

**Acceptance criteria:**

- Given I choose an approved period/filter, when the report loads, then metric definitions and insurer-only scope are clear.
- Given operational access, when I view reporting, then quote volume/SLA, conversion, policies, renewals, claims, NCD, and inspections are available.
- Given finance access and the commercial model is active, when I view finance, then premium, fees/commission, settlement, reconciliation, and exceptions are available.
- Given I export a report, when generated, then access, filters, generation time, and export event are recorded.

### Epic V4 - Public profile, reputation, and promotion (promotion after the MVP, DEC-015)

#### US-VEN-013 - Manage insurer profile and respond to reviews

**Priority:** Must  
**Requirement references:** FR-IP-014, FR-IP-015, FR-REV-001 to FR-REV-003

**User story:** As an authorised insurer user, I want to maintain our public profile and respond to verified reviews so that customers receive current information and see accountable service engagement.

**Acceptance criteria:**

- Given I edit the insurer profile, when I submit brand, description, contacts, service information, products, or approved links, then changes remain pending until InsurShield approval.
- Given ratings/badges appear, when I view the profile, then their calculation/evidence is read-only and cannot be edited by the insurer.
- Given an eligible review is published, when I respond, then the response is identified as insurer-authored, moderated, and cannot reveal customer/policy information.
- Given I dispute a review or moderation outcome, when I submit an appeal, then reason, evidence, status, SLA, and final decision are traceable without suppressing valid criticism automatically.

#### US-VEN-014 - Submit and monitor sponsored campaigns

**Priority:** Must  
**Status:** Deferred past the MVP (DEC-015)  
**Requirement references:** FR-IP-016, DEC-015

**User story:** As an insurer marketing user, I want to submit sponsored listings and advertising campaigns so that approved products gain paid visibility with transparent disclosure and measurable performance.

**Acceptance criteria:**

- Given I create a campaign, when I submit it, then creative, advertiser/profile/product destination, placement, dates, audience/targeting, frequency, budget/commercial reference, and disclosure are required.
- Given campaign content or destination violates approval rules, when reviewed, then publication is blocked and correction/rejection reasons are returned.
- Given a campaign is approved and active, when it is displayed, then paid placement is clearly labelled and does not affect objective quote ranking or eligibility.
- Given I view campaign results, when authorised data loads, then impressions, clicks, qualified quote starts, conversions, dates, placement, spend/commercial reference, and reconciliation status use approved definitions.

## 6. InsurShield administrator user stories

### Epic A1 - Access and insurer governance

#### US-ADM-001 - Access administration securely

**Priority:** Must  
**Requirement references:** FR-ADM-001, FR-ADM-003, NFR-SEC-001, NFR-SEC-002

**User story:** As an InsurShield administrator, I want strongly authenticated role-based access so that I can perform only approved platform responsibilities.

**Acceptance criteria:**

- Given I have an active administrative account, when I authenticate with MFA, then my session reflects approved roles and permissions.
- Given an action exceeds my permission, when attempted, then it is denied and audited.
- Given a high-risk action requires dual approval, when I submit it, then it remains pending until an independent authorised approver acts.
- Given my session becomes idle or reaches maximum duration, when the limit is reached, then re-authentication is required.

#### US-ADM-002 - Onboard and verify insurer organisations

**Priority:** Must  
**Requirement references:** FR-ADM-001, FR-ADM-007

**User story:** As an InsurShield administrator, I want to onboard and verify insurer organisations so that only authorised participating insurers can offer products.

**Acceptance criteria:**

- Given an insurer application is received, when I capture organisation, licence/compliance evidence, contacts, agreements, and technical model, then a reviewable insurer record is created.
- Given evidence is incomplete, expired, or unapproved, when activation is attempted, then customer publication and vendor access follow the approved block.
- Given verification is approved, when activation occurs, then effective/renewal dates, approver, conditions, and status are recorded.
- Given an insurer is suspended or expires, when status changes, then new customer presentation is blocked while existing-policy servicing follows the approved rule.

#### US-ADM-003 - Govern vendor users and access

**Priority:** Must  
**Requirement references:** FR-ADM-001, FR-ADM-009

**User story:** As an InsurShield access administrator, I want to govern vendor organisations, users, roles, and reviews so that tenancy and least privilege are maintained.

**Acceptance criteria:**

- Given a vendor nominates an administrator, when access is approved, then organisation, role, effective date, and required authentication are bound to the account.
- Given a user is dormant, terminated, or non-compliant, when status changes, then access is promptly suspended/revoked.
- Given periodic access review is due, when performed, then owners confirm, modify, or remove privileges with evidence.
- Given any privileged access changes, when audited, then before/after roles, actor, reason, approval, and time are available.

### Epic A2 - Product and rule governance

#### US-ADM-004 - Approve and publish insurer products

**Priority:** Must  
**Requirement references:** FR-ADM-002

**User story:** As a product administrator, I want to review and publish insurer products so that customers see complete and authorised offerings.

**Acceptance criteria:**

- Given a vendor submits a product version, when I review it, then benefits, exclusions, excesses, add-ons, terms, documents, dates, and completeness are available.
- Given validation or approval fails, when I reject/return it, then reason, required correction, status, and notification are recorded.
- Given approval succeeds, when effective date arrives, then that version becomes customer-visible and the prior version remains historically traceable.
- Given an approved product is suspended or withdrawn, when status changes, then new sales stop while existing-policy obligations remain accessible.

#### US-ADM-005 - Maintain comparison taxonomy and mappings

**Priority:** Must  
**Requirement references:** FR-ADM-008, FR-CMP-001

**User story:** As a product administrator, I want canonical comparison fields and vendor mappings so that customers compare equivalent information across insurers.

**Acceptance criteria:**

- Given a comparison concept is required, when defined, then canonical name, description, data type, units, allowed values, display rule, and version are recorded.
- Given a vendor field is mapped, when data arrives, then it is validated and transformed without changing its meaning.
- Given mapping is missing or invalid, when quote/product data is processed, then it enters an exception rather than displaying misleading information.
- Given taxonomy changes, when activated, then affected products/mappings are revalidated and history is preserved.

#### US-ADM-006 - Approve rating and business rules

**Priority:** Must  
**Requirement references:** FR-ADM-002, FR-ADM-003, BR-001 to BR-012

**User story:** As an authorised business-rule administrator, I want to approve versioned rating, regulatory, NCD, duration, eligibility, document, inspection, claims, and ranking rules so that every channel applies the same decision logic.

**Acceptance criteria:**

- Given a rule change is proposed, when submitted, then owner, rationale, effective date, impacted products, examples/tests, and approvals are required.
- Given a high-risk financial/regulatory rule requires dual approval, when only one approval exists, then it cannot become active.
- Given an approved rule reaches its effective date, when transactions occur, then the correct version is applied and recorded.
- Given rollback is authorised, when performed, then the replacement version, reason, actor, approval, and affected transactions are traceable.

### Epic A3 - Platform operations and finance

#### US-ADM-007 - Monitor operational workflows and exceptions

**Priority:** Must  
**Requirement references:** FR-ADM-004, NFR-OPS-003

**User story:** As an operations administrator, I want cross-platform dashboards and exception queues so that stalled or failed customer transactions are resolved promptly.

**Acceptance criteria:**

- Given I open operations monitoring, when data loads, then quote, payment, policy, renewal, claim, NCD, inspection, document, and notification states use approved definitions.
- Given a critical exception exists, when displayed, then owner, age, severity, customer/insurer impact, correlation ID, status, and next action are visible.
- Given I resolve or reassign an exception, when saved, then reason, evidence, actor, and timeline update.
- Given I drill into a metric, when records load, then my permissions and privacy restrictions remain enforced.

#### US-ADM-008 - Monitor and manage integrations

**Priority:** Must  
**Requirement references:** FR-ADM-010, NFR-OPS-002

**User story:** As a technical operations administrator, I want to monitor RTSA, insurer, payment, messaging, identity, document, and policy services so that integration failures are visible and controlled.

**Acceptance criteria:**

- Given integrations are configured, when I view service health, then status, latency, error rate, last success, callback/retry state, and affected workflows are shown.
- Given credentials or endpoints change, when I update them, then secrets remain protected and approval/audit requirements apply.
- Given an event fails, when I retry, replay, or route to manual handling, then idempotency and duplicate prevention are enforced.
- Given an incident affects customers/vendors, when communication is approved, then status messaging and owner are recorded.

#### US-ADM-009 - Reconcile financial and policy records

**Priority:** Must  
**Requirement references:** FR-ADM-011, FR-PAY-003, NFR-REL-003

**User story:** As a finance/operations administrator, I want to reconcile payments, policies, fees/commission, and vendor settlement so that financial and policy records remain consistent.

**Acceptance criteria:**

- Given provider/vendor records are received, when reconciliation runs, then matched, unmatched, duplicate, pending, reversed, and exception outcomes are produced.
- Given an exception exists, when assigned, then amount, references, ageing, reason, owner, evidence, and permitted resolution actions are available.
- Given a manual adjustment is permitted, when submitted, then required approval, reason, source evidence, before/after values, and audit are recorded.
- Given settlement is generated, when finalised, then included transactions, fees/commission, totals, period, approval, and export are reproducible.

#### US-ADM-010 - Help a customer regain access

**Priority:** Must  
**Requirement references:** FR-ADM-005

**User story:** As an authorised support user, I want to send a verified customer a password-reset email so that they can regain access without anyone seeing a reset token.

**Acceptance criteria:**

- Given a customer requests recovery, when I verify approved identity information, then I can send the customer a password-reset email without seeing any token.
- Given sending is allowed, then the reset email is sent, rate-limited, and actor, reason and delivery status are recorded.
- Given rate limit, fraud flag, or identity mismatch applies, when I attempt to send a reset, then the action is blocked or escalated.
- Given recovery is completed, when audited, then actor, customer/request, reason, channel, result, and time are available.

### Epic A4 - Content, support, compliance, and insight

#### US-ADM-011 - Manage customer content and notifications

**Priority:** Must  
**Requirement references:** FR-ADM-006, FR-ADM-013

**User story:** As a content/communications administrator, I want to manage insurer contacts, FAQs, legal copy, notices, and notification templates so that customers receive current approved information.

**Acceptance criteria:**

- Given content is created or changed, when submitted, then owner, audience, channel, version, review status, effective/expiry date, and approval are recorded.
- Given content is unapproved, expired, or withdrawn, when customers use the platform, then it is not presented or sent.
- Given a notification template is mapped to an event, when that event occurs, then correct version, consent rule, channel, and protected-link behaviour apply.
- Given delivery exceptions occur, when viewed, then retry state, reason, owner, and affected event are traceable.

#### US-ADM-012 - Link support to InsurShield records

**Priority:** Must  
**Requirement references:** FR-ADM-012

**User story:** As a support/operations administrator, I want to find the InsurShield records a help-desk ticket refers to so that support can act on the right record, and every support action in InsurShield is audited.

**Acceptance criteria:**

- Given a customer contacts support, when the help desk ticket is raised, then it quotes the InsurShield record reference, and any support action in InsurShield is audited.

#### US-ADM-013 - Review audit, privacy, and retention activity

**Priority:** Must  
**Requirement references:** FR-ADM-014, FR-ADM-015, NFR-SEC-007, NFR-PRI-001

**User story:** As an authorised compliance administrator, I want immutable audit and controlled privacy/retention workflows so that regulated actions and data handling can be evidenced.

**Acceptance criteria:**

- Given a privileged, financial, consent, quote, policy, claim, NCD, inspection, access, or configuration action occurs, when audited, then actor, action, resource, time, correlation, and decision context are retained.
- Given a privacy request is submitted, when processed, then identity verification, legal decision, affected records, holds, actions, owner, and completion evidence are recorded.
- Given retention/deletion becomes due, when the workflow runs, then approved holds and regulatory exceptions are applied before deletion/anonymisation.
- Given an unauthorised user attempts audit or privacy access, when authorisation is evaluated, then access is denied and the attempt is recorded.

#### US-ADM-014 - Produce reports and manage manual risk review

**Priority:** Should  
**Requirement references:** FR-ADM-014, FR-ADM-016

**User story:** As an authorised reporting/risk administrator, I want approved operational/regulatory reports and manual-review queues so that stakeholders receive reliable data and flagged transactions receive human review.

**Acceptance criteria:**

- Given I select an approved report and period, when generated, then metric definitions, filters, data timestamp, privacy controls, and responsible owner are included.
- Given a report is exported, when complete, then requester, permission, parameters, format, and generation event are audited.
- Given an approved rule creates a fraud/risk flag, when the queue displays it, then reason, evidence, severity, affected workflow, owner, and next action are visible.
- Given a reviewer decides the flag, when saved, then outcome, reason, evidence, actor, time, and workflow effect are recorded; the flag alone does not make an unreviewed adverse decision.

#### US-ADM-015 - Moderate reviews and govern ratings/badges

**Priority:** Must  
**Requirement references:** FR-ADM-017, FR-ADM-018, FR-REV-001 to FR-REV-003, FR-BDG-001

**User story:** As an authorised trust/compliance administrator, I want to moderate reviews and govern rating/badge methodology so that public reputation features are genuine, fair, transparent, and reproducible.

**Acceptance criteria:**

- Given a review is submitted, when eligibility/abuse/content checks run, then verified interaction, duplicate rule, prohibited content, fraud signals, privacy, and moderation status are evaluated.
- Given a moderator publishes, rejects, removes, or reinstates content, when saved, then approved reason, evidence, actor, time, notifications, and immutable history are recorded.
- Given a customer or insurer appeals, when reviewed, then separation of duties, SLA, evidence, decision, and communication follow approved rules.
- Given rating methodology is configured, when calculated, then scale, eligible reviews, weights if permitted, minimum sample, window, rounding, recalculation, and disclosure are reproducible.
- Given a performance badge is configured/awarded, when displayed, then source metrics, threshold, sample/evidence, period, expiry, version, and suspension rules are met.

#### US-ADM-016 - Approve and govern sponsored placements

**Priority:** Must  
**Status:** Deferred past the MVP (DEC-015)  
**Requirement references:** FR-ADM-019, DEC-015

**User story:** As an authorised advertising/commercial administrator, I want to approve and govern sponsored campaigns so that paid visibility is compliant, transparent, limited, measurable, and commercially reconcilable.

**Acceptance criteria:**

- Given a campaign is submitted, when I review it, then advertiser eligibility, creative, destination, placement, targeting, frequency, dates, disclosure, commercial reference, and conflicts are visible.
- Given a campaign is approved, when scheduled/activated, then inventory limits, start/end, pause/expiry, accessible label, and approved destination are enforced.
- Given organic comparison/ranking is calculated, when sponsored content exists, then paid placement is kept separate and never changes quote value, eligibility, or undisclosed organic order.
- Given events are measured, when reports/reconciliation run, then valid impressions, clicks, quote starts, conversions, spend/billing reference, adjustments, disputes, and settlement are traceable.
- Given content is misleading, expired, non-compliant, or receives a valid complaint, when action is taken, then pause/remove/investigate/appeal behaviour and audit follow policy.

## 7. Platform enabler stories

The following enablers support all three user types and should be planned alongside the functional stories:

- EN-001: Server-side identity, session, role, permission, and insurer-tenancy enforcement.
- EN-002: Authoritative domain persistence with versioned state transitions and immutable audit.
- EN-003: Secure document upload, scanning, storage, protected access, retention, and deletion.
- EN-004: Idempotent integration/event processing with retries, callbacks, reconciliation, and manual fallback.
- EN-005: Notification orchestration with template version, consent, channel, delivery receipt, and retry.
- EN-006: Monitoring, logs, metrics, traces, correlation IDs, alerting, backup, and recovery.
- EN-007: Responsive low-bandwidth performance, accessibility, localisation, and browser compatibility.
- EN-008: Automated unit, calculation, contract, integration, end-to-end, security, accessibility, performance, and recovery testing.
- EN-009: Customer account, profile, portfolio, device/session security, recovery, and data-lifecycle services.
- EN-010: Review eligibility, moderation, abuse detection, rating calculation, badge calculation, appeals, and public-reputation publishing.
- EN-011: Sponsored campaign, inventory, placement, disclosure, targeting/frequency, event measurement, attribution, billing, and ranking-separation services. Deferred past the MVP (DEC-015).

## 8. Recommended delivery slices

The roadmap's batches replace the slices as the delivery order.

### Slice 0 - Foundations and controlled catalogue

- Identity, roles, tenancy, audit, persistence, documents, events, notifications, and observability.
- Administrator insurer onboarding, vendor access, product/rule submission, approval, and comparison taxonomy.
- Customer account/profile/portfolio foundations and administrator review/rating/badge governance; sponsorship governance after the MVP.
- RTSA, insurer, payment, messaging, and document-provider sandbox contracts.

### Slice 1 - Quote to policy

- Customer cover, vehicle, risk, eligibility, declarations, quote form, save/resume, and tracking.
- Vendor quote queues, more-information/decline, quote response, and policy issuance.
- Customer comparison, add-ons/conditions, payment, and policy confirmation.
- Administrator operations, integration health, and reconciliation.

### Slice 2 - Customer account, portfolio, reputation, and renewal

- Customer registration/sign-in/recovery, profile, portfolio, notification centre, document access, renewal, service requests, and verified reviews; sponsored-content disclosure after the MVP.
- Vendor renewal processing, public profile, review responses/appeals, and basic reports; sponsored campaigns after the MVP.
- Administrator content, support, review moderation, rating/badge methodology, and exception management; sponsored placement after the MVP.

### Slice 3 - Claims, NCD, and inspections

- Customer claim, NCD, and inspection journeys.
- Vendor claims, NCD, and inspection queues.
- Administrator audit/privacy, reporting, and manual-review workflows; the complaint workflow after the MVP.

## 9. Definition of Ready

A story is ready for sprint planning when:

- Business outcome, user type, priority, and acceptance criteria are agreed.
- Referenced scope decisions and business rules are approved or explicitly mocked for the sprint.
- UX/design, content, data, API/integration, security, privacy, and accessibility dependencies are identified.
- Test data and required sandbox/environment access are available or scheduled.
- The story is small enough to complete within the team's agreed sprint policy or has been split without losing traceability.

## 10. Definition of Done

A story is done when:

- Acceptance criteria and applicable non-functional requirements pass automated and exploratory testing.
- Security, permissions, tenancy, privacy, audit, failure, retry, empty, loading, and accessibility states are covered.
- Required API contracts, migrations/configuration, monitoring, alerts, runbooks, and support guidance are complete.
- User-facing content is approved and no placeholder or unverified regulatory claim remains.
- Requirement and test traceability are updated.
- Product owner acceptance is recorded and no unresolved critical/high-severity defect remains without formal approval.

## 11. Backlog decisions still required

The following decisions affect story refinement and estimation:

1. Responsive web-only MVP versus native application delivery.
2. Launch insurers, products, add-ons, and driver/risk questions.
3. Premium-floor and discount ordering.
4. Comprehensive/TPO, usage, duration, excess, and rating rules.
5. Quote authority, response SLA, expiry, and partial-response behaviour.
6. NCD scale, portability, validity, and use rules.
7. RTSA ownership (road tax after the MVP).
8. Payment providers, ZMW/multi-currency, settlement, refunds, and commission.
9. Customer account registration, authentication, recovery, profile, portfolio history, service-request, retention, and data-lifecycle scope.
10. Claims, inspections, help-desk record references, privacy/retention, and regulatory reporting rules.
11. Review eligibility, moderation, prohibited content, appeals, rating calculation, insurer responses, performance metrics, badge thresholds, minimum sample, and display period.
12. Sponsored placement scope (after the MVP, DEC-015).
