/**
 * InsurShield — Insurer Rate Configuration
 * ----------------------------------------
 * Configurable rate table for premium calculations.
 * PIA MINIMUM: 4% of vehicle value (regulatory — not a fixed amount)
 * Formula: Premium = max(Vehicle Value × Insurer Rate%, Vehicle Value × PIA Rate%)
 */

export const PIA_CONFIG = {
  // PIA minimum = 4% of vehicle value (regulatory requirement)
  piaRatePercentage: 4,
  lastUpdated: '2025-01-01',
  updatedBy: 'Administrator',
};

export const NCD_TIERS = [
  { years: 1, percentage: 10, label: '1 Year Claim-Free (10%)' },
  { years: 2, percentage: 20, label: '2 Years Claim-Free (20%)' },
  { years: 3, percentage: 30, label: '3 Years Claim-Free (30%)' },
  { years: 4, percentage: 40, label: '4 Years Claim-Free (40%)' },
  { years: 5, percentage: 50, label: '5+ Years Claim-Free (50%)' },
];

export const COVERAGE_DURATION_OPTIONS = [
  { id: '1q',  label: '1 Quarter (3 Months)',   months: 3,   days: 91  },
  { id: '2q',  label: '2 Quarters (6 Months)',  months: 6,   days: 182 },
  { id: '3q',  label: '3 Quarters (9 Months)',  months: 9,   days: 273 },
  { id: '4q',  label: '1 Year (12 Months)',     months: 12,  days: 365 },
];

/** Insurers on the platform. `contact` is the claims desk customers call after a first notification. */
export const INSURER_RATES = [
  {
    id: '1',
    name: 'Prestige Assurance',
    coverage: 'Comprehensive Gold Plan',
    ratePercentage: 4.5,
    ncdAccepted: true,
    inspectionRules: 'NOT REQUIRED',
    timing: 'AFTER PAYMENT',
    method: 'SELF-CAPTURE',
    icon: 'verified',
    isBestValue: true,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 50,000',
      'Theft & Fire Coverage',
      'Own Damage',
      'Natural Disasters',
      'Windscreen Replacement',
    ],
    contact: {
      tagline: 'Premium motor cover since 1995',
      contactPerson: 'Mrs. Chanda Mwale', role: 'Motor Claims Manager',
      phone: '+260 211 255 100', mobile: '+260 977 255 100', whatsapp: '260977255100',
      email: 'claims@prestigeassurance.zm', address: 'Prestige House, Cairo Road, Lusaka', hours: 'Mon–Fri 08:00–17:00 · Sat 09:00–12:00',
    },
  },
  {
    id: '2',
    name: 'Global Guard Insurance',
    coverage: 'Elite Security Policy',
    ratePercentage: 4.0,
    ncdAccepted: true,
    inspectionRules: 'REQUIRED',
    timing: 'BEFORE QUOTATION',
    method: 'PHYSICAL',
    icon: 'shield',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 30,000',
      'Theft & Fire Coverage',
      'Own Damage',
      '24/7 Roadside Assistance',
    ],
    contact: {
      tagline: 'Nationwide cover, fast claims',
      contactPerson: 'Mr. Bwalya Kapasa', role: 'Claims Officer',
      phone: '+260 211 374 700', mobile: '+260 966 374 700', whatsapp: '260966374700',
      email: 'claims@globalguard.zm', address: 'Global House, Plot 64489, Lusaka Central', hours: 'Mon–Fri 08:00–17:00 · Sat 08:30–12:30',
    },
  },
  {
    id: '3',
    name: 'ValueDirect Insurance',
    coverage: 'Essential Shield',
    ratePercentage: 4.2,
    ncdAccepted: true,
    inspectionRules: 'OPTIONAL',
    timing: 'BEFORE PAYMENT',
    method: 'SELF-CAPTURE',
    icon: 'account_balance_wallet',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 20,000',
      'Theft & Fire Coverage',
      'Emergency Towing',
    ],
    contact: {
      tagline: 'Straightforward cover at a fair price',
      contactPerson: 'Ms. Natasha Phiri', role: 'Customer Claims Advisor',
      phone: '+260 211 228 000', mobile: '+260 955 228 000', whatsapp: '260955228000',
      email: 'claims@valuedirect.zm', address: 'Independence Avenue, Lusaka', hours: 'Mon–Fri 07:30–17:00',
    },
  },
  {
    id: '4',
    name: 'Metro Safe Assurance',
    coverage: 'Standard Protection',
    ratePercentage: 5.0,
    ncdAccepted: false,
    inspectionRules: 'REQUIRED',
    timing: 'BEFORE QUOTATION',
    method: 'SELF-CAPTURE',
    icon: 'security',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 75,000',
      'Theft & Fire Coverage',
      'Own Damage',
      'Natural Disasters',
      'Legal Assistance',
      'Windscreen & Accessories',
    ],
    contact: {
      tagline: 'Protection for every journey',
      contactPerson: 'Mr. Musonda Tembo', role: 'Claims & Underwriting Lead',
      phone: '+260 211 239 500', mobile: '+260 971 239 500', whatsapp: '260971239500',
      email: 'claims@metrosafe.zm', address: 'Farmers House, Central Business District, Lusaka', hours: 'Mon–Fri 08:00–17:00 · Sat 09:00–13:00',
    },
  },
  {
    id: '5',
    name: 'Madison General',
    coverage: 'Comprehensive Zambia Plan',
    ratePercentage: 4.3,
    ncdAccepted: true,
    inspectionRules: 'OPTIONAL',
    timing: 'AFTER PAYMENT',
    method: 'SELF-CAPTURE',
    icon: 'business',
    isBestValue: false,
    benefits: [
      'Third Party Property Damage',
      'Medical Expenses up to ZMW 40,000',
      'Theft & Fire Coverage',
      'Own Damage',
      'Roadside Assistance',
    ],
    contact: {
      tagline: "Zambia's most trusted insurer",
      contactPerson: 'Ms. Grace Lungu', role: 'Motor Claims Coordinator',
      phone: '+260 211 374 950', mobile: '+260 968 374 950', whatsapp: '260968374950',
      email: 'motorclaims@madisongeneral.zm', address: 'Madison House, Addis Ababa Drive, Longacres, Lusaka', hours: 'Mon–Fri 08:00–17:00',
    },
  },
];

// NCD Application Status workflow
export const NCD_APPLICATION_STATUSES = [
  { id: 'Submitted', label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  { id: 'Under Review', label: 'Under Review', color: 'bg-amber-100 text-amber-800' },
  { id: 'Verification Required', label: 'Verification Required', color: 'bg-orange-100 text-orange-800' },
  { id: 'Approved', label: 'Approved', color: 'bg-primary/10 text-primary' },
  { id: 'Rejected', label: 'Rejected', color: 'bg-red-100 text-red-800' },
];

const slug = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Loose name match that tolerates "Global Guard" vs "Global Guard Insurance". */
export const sameInsurerName = (a, b) => {
  const x = slug(a);
  const y = slug(b);
  return Boolean(x && y) && (x === y || x.startsWith(y) || y.startsWith(x));
};

const findCatalogueEntry = (insurer) =>
  INSURER_RATES.find((entry) => entry.id === insurer?.id) || INSURER_RATES.find((entry) => sameInsurerName(entry.name, insurer?.name));

const toRate = (insurer) => {
  const value = parseFloat(insurer?.ratePercentage ?? insurer?.rate ?? insurer?.ratePercent);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * Bring a stored insurer list back in line with the catalogue: catalogue
 * fields fill anything missing, admin edits (rate, logo, status) are kept, and
 * insurers added through the admin portal are preserved. Anything without a
 * usable rate is dropped so it can never produce a blank quote.
 */
export function reconcileInsurers(stored) {
  const list = Array.isArray(stored) ? stored.filter((insurer) => insurer && insurer.name) : [];
  const merged = list.map((insurer) => {
    const base = findCatalogueEntry(insurer);
    const combined = base ? { ...base, ...insurer, id: base.id, name: base.name, contact: base.contact, benefits: insurer.benefits?.length ? insurer.benefits : base.benefits } : { ...insurer };
    return { ...combined, ratePercentage: toRate(insurer) ?? toRate(base), benefits: Array.isArray(combined.benefits) ? combined.benefits : [] };
  });
  const missing = INSURER_RATES.filter((entry) => !merged.some((insurer) => insurer.id === entry.id));
  return [...merged, ...missing].filter((insurer) => Number.isFinite(insurer.ratePercentage));
}
