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
  },
];

// NCD Application Status workflow
export const NCD_APPLICATION_STATUSES = [
  { id: 'Submitted', label: 'Submitted', color: 'bg-blue-100 text-blue-800' },
  { id: 'Under Review', label: 'Under Review', color: 'bg-amber-100 text-amber-800' },
  { id: 'Verification Required', label: 'Verification Required', color: 'bg-orange-100 text-orange-800' },
  { id: 'Approved', label: 'Approved', color: 'bg-green-100 text-green-800' },
  { id: 'Rejected', label: 'Rejected', color: 'bg-red-100 text-red-800' },
];
