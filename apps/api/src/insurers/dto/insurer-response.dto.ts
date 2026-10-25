import { bpsToPercent } from '../../common/money.js';
import type { InsurerStatus } from '../../common/domain/enums.js';
import type { ContactRow, InsurerRow, PublicInsurerRow } from '../insurers.repository.js';

const STATUS_LABEL: Record<InsurerStatus, string> = { ACTIVE: 'Active', INACTIVE: 'Inactive', DELETED: 'Deleted' };

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
    status: STATUS_LABEL[insurer.status],
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
  };
}

export type InsurerResponse = ReturnType<typeof toInsurerResponse>;
