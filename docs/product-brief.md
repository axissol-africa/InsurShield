# InsurShield Product Brief

**Document status:** Draft for stakeholder review and sign-off  
**Version:** 0.10  
**Date:** 26 August 2026  
**Classification:** Commercial-in-confidence  
**Prepared for:** DPM, Axis Solutions, the delivery team, and participating client stakeholders

## 1. Executive summary

InsurShield is a Zambia-focused digital motor-insurance marketplace and servicing platform. It will enable customers to understand available motor-cover options, verify vehicle information, compare quotations from approved insurers, purchase a policy, and manage key post-purchase activities through one consistent experience.

The Minimum Viable Product (MVP) will focus on Comprehensive and Third-Party motor insurance delivered through a responsive web application. It will include full customer accounts and insurance portfolios, verified customer ratings and reviews, transparent insurer performance badges, and clearly labelled sponsored insurer placements. It will also provide the operational tools required for insurers and InsurShield administrators to process quotations, policies, claims, No Claim Discount applications, inspections, reviews, campaigns, and customer servicing requests.

The purpose of this brief is to establish a shared product direction, lock the MVP boundary, and provide a basis for detailed requirements, delivery planning, acceptance, and client sign-off.

## 2. Customer and market problem

Motor-insurance customers in Zambia commonly experience a fragmented buying and servicing process:

- Insurance products are difficult to compare because pricing, benefits, exclusions, and requirements are presented differently by each insurer.
- Customers repeatedly submit the same personal, vehicle, and supporting information to multiple insurers.
- Insurance terminology and policy conditions can be difficult for non-specialists to understand.
- Vehicle details and ownership information may require manual validation, increasing errors, fraud risk, and turnaround time.
- Quote requests, inspections, policy issuance, claims, and renewals are handled across disconnected channels with limited progress visibility.
- Mobile-money users and customers on basic smartphones or low-bandwidth connections may not receive a consistent digital experience.

Insurers also face operational challenges:

- Digital distribution is expensive to build independently.
- Quote leads often arrive with incomplete or inconsistent information.
- Customer acquisition, document collection, inspection coordination, and post-sale communication are fragmented.
- Product visibility and performance data are limited across the broader digital insurance journey.

## 3. Product vision

To become a trusted digital access point for motor insurance in Zambia by making comparison, purchase, policy servicing, and insurer participation simpler, more transparent, and more accessible.

## 4. Product objectives

The MVP will:

1. Make Comprehensive and Third-Party motor insurance easy to understand in plain language.
2. Allow customers to compare suitable products from multiple approved insurers using consistent information.
3. Reduce duplicate data capture through vehicle verification and reusable quote-session information.
4. Support secure digital payment and policy issuance.
5. Give customers clear tracking for quotations, claims, NCD applications, inspections, and renewals.
6. Give insurer teams structured queues and tools to respond to customer requests.
7. Give InsurShield administrators control over insurer onboarding, product/rate publication, operational configuration, and audit activity.
8. Establish a scalable foundation for additional insurance categories and distribution channels in later phases.

## 5. The three MVP user types

### 5.1 Customers

- Individual vehicle owners.
- Authorised representatives arranging cover on behalf of a registered owner.
- Motorcycle, taxi, ride-hailing, rental, bus, truck, trailer, and other commercial-vehicle operators, subject to insurer eligibility.
- Existing policyholders renewing cover, filing a claim, applying for NCD, or requesting assistance.

### 5.2 Insurer users

- Underwriting and quotation officers.
- Claims officers.
- NCD verification officers.
- Product and operations administrators.

### 5.3 InsurShield users

- Platform administrators.
- Customer-support and operations staff.
- Compliance and reporting stakeholders.

These three user types define the functional structure of the MVP. A regulator dashboard is not a fourth MVP user type; approved regulatory reports and exports will be produced by authorised InsurShield users until a later phase is approved.

## 6. Core value proposition

### For customers

- One guided journey instead of separate insurer processes.
- Plain-language explanations of cover types and requirements.
- Transparent comparison of price, benefits, conditions, and inspection requirements.
- Mobile-money and card payment options.
- Secure customer accounts, profiles, portfolios, and tracking using verified identity.
- One place to manage renewals, claims, NCD, inspections, and insurer contacts.

### For insurers

- Structured, validated quote leads.
- Lower-cost access to a shared digital distribution channel.
- Consistent customer and vehicle information.
- Operational queues for quotations, claims, NCD, and inspection-related work.
- Controlled product presentation and performance reporting.

### For InsurShield and regulatory stakeholders

- Consistent insurer and product governance.
- Better auditability of customer declarations, quotes, payments, policies, claims, and configuration changes.
- A foundation for market-level reporting and financial-inclusion initiatives, subject to legal and regulatory approval.

## 7. MVP scope

### 7.1 Customer-facing experience

The MVP includes:

- Responsive web experience optimised for mobile devices and low-bandwidth conditions.
- Motor cover selection: Comprehensive and Third-Party Only.
- Vehicle usage classification for private and supported commercial categories.
- RTSA vehicle lookup and ownership/registration verification, with controlled manual-entry fallback.
- Driver and risk-profile questions required for accurate insurer eligibility and pricing, including regular driver, licence history, prior claims, vehicle parking/location, and other approved underwriting inputs.
- Vehicle market-value declaration and acknowledgement of valuation responsibilities.
- Customer declarations and privacy/terms acceptance with versioned evidence.
- Selection of up to five eligible insurers.
- Quote-request form with customer contact details, policy start date, duration, NCD, and supporting documents.
- Configurable short-period cover options from one month to twelve months where supported by an insurer.
- Conditional inspection requirements and photo capture.
- Asynchronous quote processing and secure tracking-link delivery.
- Quote comparison showing premium, benefits, conditions, inspection status, and validity period.
- Comparison filters and sorting by final price, cover, excess/deductible, key benefits, and insurer response status.
- Product-specific excesses, exclusions, optional add-ons, and supporting terms.
- Mobile-money and card payment.
- Digital policy confirmation and downloadable certificate.
- Full customer account and profile management, including contact details, drivers, vehicles, communication preferences, security settings, and consent history.
- Customer portfolio management for active/past quotes, policies, documents, payments, renewals, claims, NCD applications, inspections, service requests, and notifications.
- Verified customer ratings and public reviews linked to completed policy or servicing interactions.
- Transparent insurer performance badges based on approved, published metrics and minimum evidence thresholds.
- Clearly labelled sponsored listings and advertising that remain visually and logically separate from objective quote rankings.
- Optional road-tax renewal integration where supported and approved.
- Quote-session recovery using plate, registered phone, and OTP.
- Policy renewal request.
- Claim submission and tracking.
- NCD application, tracking, approval, and controlled code use.
- Vehicle-inspection request and tracking.
- Searchable insurer contact directory and escalation information.

### 7.2 Insurer portal

The MVP includes:

- Secure insurer login and organisation-specific access.
- Quote-request queue and customer/vehicle review.
- Team assignment, priority, SLA, request-more-information, decline, and exception handling for quote requests.
- Quote response with premium, excess, add-ons, conditions, validity, and supporting policy information.
- Claims queue, status updates, notes, and customer messages.
- NCD application review, approval, verification request, rejection, and code issuance.
- Inspection review and pre-loss/post-loss evidence access where applicable.
- Policy issuance, document submission, and renewal processing or integration status.
- Product, pricing, excess, add-on, document, eligibility, inspection, and NCD-rule submission for administrator approval.
- Insurer user and role management.
- API/webhook credentials and integration-health visibility where integrations are used.
- Basic operational reporting for quote response, conversion, claims, and NCD workloads.
- Insurer public-profile management for approved brand information, service details, and contact information.
- Response workflow for verified customer reviews, subject to moderation and privacy rules.
- Sponsored-listing and advertising campaign submission with approved placement, dates, creative, audience, and performance reporting.

### 7.3 InsurShield administration

The MVP includes:

- Secure role-based staff access.
- Insurer onboarding, verification, activation, suspension, and access management.
- Insurer licence/compliance evidence, renewal date, and approval status management.
- Product, benefit, exclusion, excess, add-on, rate, underwriting-question, inspection-rule, document-rule, and NCD-rule approval and publication.
- Standardisation of comparison fields so insurers are presented consistently.
- Configuration of approved regulatory and platform business rules with effective dates.
- Monitoring of quote, payment, policy, claim, inspection, and NCD activity.
- Payment, policy, road-tax, insurer-response, and notification reconciliation and exception queues.
- Commission/fee and insurer-settlement records once the commercial model is approved.
- Integration configuration, credential governance, webhook/event monitoring, and service-health status.
- Customer tracking-link recovery and controlled resend.
- Content management for insurer contacts, FAQs, legal copy, and customer notices.
- Complaint/support escalation and customer-service oversight.
- Operational and approved regulatory report generation/export.
- Audit history for privileged, financial, policy, consent, and configuration actions.
- Review moderation, fraud/abuse handling, insurer-response controls, and appeals.
- Configuration and publication of rating methodology, review eligibility, minimum sample sizes, performance metrics, badge thresholds, and calculation periods.
- Sponsored campaign approval, scheduling, placement, disclosure, impression/click/conversion measurement, and commercial reconciliation.
- Governance ensuring paid placement never changes objective quotation values, customer eligibility, or undisclosed organic rankings.

### 7.4 Feature completeness principle

The MVP is complete only when all three user types can finish their part of the same transaction. A customer-facing action must have a corresponding vendor workflow, administrator control, or automated integration. For example, a customer cannot be asked to upload an inspection unless the responsible insurer can review it and the administrator can configure the rule that required it.

## 8. Primary customer journey

1. Customer creates or accesses a secure account and chooses Comprehensive or Third-Party motor cover.
2. Customer verifies the vehicle through RTSA or enters permitted details manually.
3. Customer declares the vehicle's current market value and primary usage.
4. Customer reviews and accepts declarations, privacy terms, and data-sharing conditions.
5. Platform determines eligible insurers and allows the customer to select up to five.
6. Customer enters contact and policy details, provides documents, and optionally enters an approved NCD code.
7. Platform creates a quote request and sends it to the selected insurers.
8. Customer receives a secure reference/tracking link and may leave the session.
9. Available insurer quotations are presented consistently while outstanding responses remain visible as pending.
10. Customer selects a quotation and completes payment.
11. Platform confirms payment, requests policy issuance, and provides the issued policy certificate.
12. Customer manages the policy through their portfolio, can renew, claim, apply for NCD, request an inspection, review the insurer after an eligible interaction, or request assistance.

## 9. MVP business principles

- InsurShield presents and facilitates insurance products; the relevant insurer remains responsible for underwriting, policy acceptance, and claims decisions.
- Only approved insurers and approved products may be presented to customers.
- Premium calculations and regulatory floors must use rules approved by authorised business and regulatory stakeholders.
- Customer-facing quotations must clearly state whether they are indicative or binding, their validity period, and any outstanding conditions.
- Customer information may be shared only with selected/eligible insurers for an approved purpose and under an approved privacy basis.
- No payment may create more than one policy, and no policy may be activated without authoritative payment and insurer confirmation.
- Product, rate, NCD, inspection, and regulatory-rule changes must be versioned and auditable.
- Public reviews must come from verified eligible interactions, be moderated under published rules, and provide an insurer response/appeal process.
- Performance badges must use approved, reproducible metrics, defined periods, and minimum evidence thresholds rather than unverified marketing claims.
- Sponsored listings and advertising must be clearly labelled and must not alter objective comparison values or undisclosed organic ranking.

## 10. MVP success measures

Final targets will be approved during planning. The product will measure at least:

- Quote-start to quote-submission conversion.
- Percentage of quote requests accepted by at least one insurer.
- Time to first quote and time to final selected-insurer response.
- Quote-to-payment conversion.
- Payment-to-policy issuance success rate and elapsed time.
- Percentage of sessions successfully recovered through secure tracking.
- Renewal completion rate.
- Claim and NCD submission completion rate.
- Insurer response-time compliance.
- Support contacts and complaints per issued policy.
- Platform availability, failed integration calls, and reconciliation exceptions.
- Customer account activation, profile completion, portfolio engagement, and successful account recovery.
- Verified review participation, moderation turnaround, disputed-review rate, and insurer response rate.
- Accuracy and coverage of performance-badge metrics.
- Sponsored campaign impressions, clicks, qualified quote starts, conversions, and disclosure compliance.

## 11. Explicitly outside the MVP

The following remain part of the longer-term product vision but are excluded from the initial MVP unless moved into scope through formal change control:

- Native Android and iOS applications; the MVP is a responsive web application designed to support later native or packaged delivery.
- Homeowners, householders, agriculture, liability, health, life, and other non-motor insurance categories.
- Advanced customer-demographic analytics and marketing automation.
- Direct push-notification campaigns and insurer-branded marketing pages.
- Regulator self-service dashboard and automated quarterly market reporting.
- Microinsurance and additional mobile-money insurance products.
- Automated recommendations based on customer profiling or artificial intelligence.

## 12. Dependencies and constraints

- Access to documented RTSA services, approved data fields, credentials, and a lawful operating basis.
- Participation and technical readiness of launch insurers.
- Approved product, rating, NCD, inspection, and policy-document rules.
- Selected mobile-money, card-payment, SMS, email, and document-storage providers.
- Agreed regulatory, privacy, data-retention, data-hosting, cybersecurity, and audit requirements.
- Availability of realistic sandbox environments and test data.
- A content owner responsible for insurer details, legal notices, FAQs, and customer communications.
- A support and operating model for launch and the agreed post-launch support period.

## 13. Decisions required for scope lock

The following decisions must be approved before development scope and commercial delivery dates are considered fixed:

1. Confirm responsive web as the MVP channel and native applications as a later phase.
2. Confirm the launch insurers and products.
3. Confirm the authoritative premium-floor calculation and whether discounts apply before or after the floor.
4. Confirm separate rating and eligibility rules for Comprehensive and Third-Party cover and each vehicle-usage class.
5. Confirm whether quotations are indicative or binding and the applicable response and expiry SLAs.
6. Confirm the approved NCD scale, portability, validity, and single-use rules.
7. Confirm RTSA scope, including ownership verification and optional road-tax purchase.
8. Confirm payment providers, supported currency, settlement, refund, and reconciliation arrangements.
9. Confirm customer identity requirements for purchase, tracking, renewal, claims, and NCD.
10. Confirm inspection rules, service providers, blocking stages, and report requirements.
11. Confirm the claims reporting window, evidence requirements, state model, and insurer/customer responsibilities.
12. Confirm privacy law, consent, hosting, retention, security, and audit obligations.
13. Confirm the commercial model, including commissions, fees, settlements, and insurer billing.
14. Confirm whether support ticketing and live chat are included in MVP or replaced by the insurer directory and direct contact model.
15. Confirm customer account registration, identity recovery, portfolio history, profile fields, and account/data lifecycle rules.
16. Confirm review eligibility, moderation, fraud/abuse controls, insurer responses/appeals, rating calculation, performance metrics, badge thresholds, minimum sample sizes, and display periods.
17. Confirm sponsored-listing inventory, approval, disclosure, targeting, campaign measurement, pricing/billing, placement limits, and separation from objective ranking.

## 14. Approval

Approval of this brief confirms agreement on the product direction and proposed MVP boundary. Detailed functional and non-functional obligations are defined in the InsurShield MVP Requirements Specification.

| Role | Name | Organisation | Signature | Date |
|---|---|---|---|---|
| Client sponsor |  |  |  |  |
| Product owner |  |  |  |  |
| Delivery lead |  |  |  |  |
| Technical lead |  |  |  |  |
| Compliance/legal reviewer |  |  |  |  |
