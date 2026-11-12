import { toContract } from '../../common/contract.js';
import { bpsToPercent } from '../../common/money.js';
import type { ContactRow, EvidenceRow, InsurerRow, IntegrationRow, PublicInsurerRow } from '../insurers.repository.js';

function toContactResponse(contact: ContactRow) {
  return {
    tagline: contact.tagline,
    contactPerson: contact.contactPerson,
    role: contact.role,
    phone: contact.phone,
    mobile: contact.mobile,
    whatsapp: contact.whatsapp,
    email: contact.email,
    address: contact.address,
    hours: contact.hours,
  };
}

/** What the public directory shows: no licence, registration or tax numbers. */
export function toPublicInsurerResponse(insurer: PublicInsurerRow) {
  return {
    id: insurer.id,
    name: insurer.name,
    tradingName: insurer.tradingName,
    status: toContract.insurerStatus(insurer.status),
    ratePercentage: bpsToPercent(insurer.rateBps),
    quoteValidityDays: insurer.quoteValidityDays,
    coverage: insurer.coverage,
    plan: insurer.plan,
    website: insurer.website,
    logoUrl: insurer.logoUrl,
    ncdAccepted: insurer.ncdAccepted,
    inspectionRule: insurer.inspectionRule,
    inspectionTiming: insurer.inspectionTiming,
    inspectionMethod: insurer.inspectionMethod,
    icon: insurer.icon,
    isBestValue: insurer.isBestValue,
    benefits: insurer.benefits ?? [],
    contact: insurer.contact ? toContactResponse(insurer.contact) : null,
  };
}

/** The full record for staff, with the details captured at onboarding. */
export function toInsurerResponse(insurer: InsurerRow) {
  return {
    ...toPublicInsurerResponse(insurer),
    licenceNumber: insurer.licenceNumber,
    licenceExpiry: insurer.licenceExpiry?.toISOString() ?? null,
    registrationNumber: insurer.registrationNumber,
    tpin: insurer.tpin,
    activation: toActivationResponse(insurer),
  };
}

export type InsurerResponse = ReturnType<typeof toInsurerResponse>;

/** What activation decided, for whoever reviews the record afterwards. */
export function toActivationResponse(insurer: InsurerRow) {
  return {
    effectiveFrom: asDay(insurer.effectiveFrom),
    renewalDate: asDay(insurer.renewalDate),
    approvedAt: insurer.approvedAt?.toISOString() ?? null,
    conditions: insurer.activationConditions,
  };
}

/** A calendar day on the wire, from a `date` column read as a Date at UTC midnight. */
const asDay = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10));

export function toEvidenceResponse(evidence: NonNullable<EvidenceRow>) {
  return {
    id: evidence.id,
    kind: evidence.kind,
    documentId: evidence.documentId,
    reference: evidence.reference,
    expiresAt: asDay(evidence.expiresAt),
    state: evidence.state,
    reviewedBy: evidence.reviewedByName,
    reviewedAt: evidence.reviewedAt?.toISOString() ?? null,
    note: evidence.note,
    capturedAt: evidence.createdAt.toISOString(),
  };
}

/** The technical model as a reviewer sees it. The client secret is never selected, so it cannot be returned. */
export function toIntegrationResponse(model: IntegrationRow) {
  return {
    apiBaseUrl: model.apiBaseUrl,
    publicSigningKey: model.publicSigningKey,
    clientId: model.clientId,
    quoteCallbackUrl: model.quoteCallbackUrl,
    claimsCallbackUrl: model.claimsCallbackUrl,
    policyCallbackUrl: model.policyCallbackUrl,
    sandboxMode: model.sandboxMode,
    activatedAt: model.activatedAt?.toISOString() ?? null,
  };
}
