/**
 * InsurShield — Premium Calculation Engine
 * ----------------------------------------
 * Formula: Annual Premium = Vehicle Value × Insurer Rate × Vehicle Usage Factor.
 * NCD support remains available in the engine for a future release, but is not
 * part of the customer quote request flow yet.
 */

import { COVERAGE_DURATION_OPTIONS } from './insurerRates';

const USAGE_FACTORS = {
  Individual: 1,
  'Individual (Motorcycles)': 1.05,
  'Commercial (Motorcycles)': 1.18,
  'Commercial (Cars for Hire)': 1.2,
  'Commercial (Small Public Buses)': 1.25,
  'Commercial (Trucks, Horses & Trailers)': 1.22,
  'Commercial (Taxis & Yangos)': 1.28,
};

/**
 * Calculate the annual base premium from the insurer rate and vehicle use.
 * @param {number} vehicleValueZMW
 * @param {number} ratePercentage  - Insurer rate %
 * @returns {{ premium, usageFactor }}
 */
export function calculateBasePremium(vehicleValueZMW, ratePercentage, vehicleUsage = 'Individual') {
  if (!vehicleValueZMW || vehicleValueZMW <= 0) return { premium: 0, usageFactor: 1 };

  const usageFactor = USAGE_FACTORS[vehicleUsage] || 1;
  const premium = vehicleValueZMW * (ratePercentage / 100) * usageFactor;

  return { premium, usageFactor };
}

/**
 * Apply NCD discount using a validated NCD code.
 * @param {number} basePremium
 * @param {number} ncdPercentage - 0 if no code, else 10–50
 * @param {boolean} ncdAccepted - Whether insurer accepts NCD codes
 * @returns {{ ncdAmount, finalPremium, appliedNcdPercentage }}
 */
export function applyNCD(basePremium, ncdPercentage, ncdAccepted = true) {
  if (!ncdAccepted || !ncdPercentage || ncdPercentage <= 0) {
    return { ncdAmount: 0, finalPremium: basePremium, appliedNcdPercentage: 0 };
  }
  const ncdAmount = (basePremium * ncdPercentage) / 100;
  const finalPremium = Math.max(basePremium - ncdAmount, 0);
  return { ncdAmount, finalPremium, appliedNcdPercentage: ncdPercentage };
}

/**
 * Pro-rate an annual premium for a coverage duration.
 */
export function proratePremium(annualPremium, durationId) {
  const duration = COVERAGE_DURATION_OPTIONS.find(d => d.id === durationId);
  if (!duration) return annualPremium;
  return (annualPremium * duration.months) / 12;
}

/**
 * Full premium calculation for one insurer.
 * @param {{ vehicleValueZMW, insurer, ncdCode, ncdPercentage, ncdIssuingInsurer, coverageDurationId }}
 * @returns {object} Full breakdown
 */
export function calculatePremium({ vehicleValueZMW, insurer, ncdCode, ncdPercentage, ncdIssuingInsurer, coverageDurationId, vehicleUsage }) {
  const { premium: annualBase, usageFactor } = calculateBasePremium(
    vehicleValueZMW,
    insurer.ratePercentage,
    vehicleUsage
  );

  // NCD only applied if:
  // 1. A valid code was provided
  // 2. The insurer accepts NCD codes
  // 3. THIS insurer is the one that ISSUED the code
  const isIssuingInsurer = ncdIssuingInsurer && insurer.name === ncdIssuingInsurer;
  const effectiveNcd = (ncdCode && insurer.ncdAccepted && isIssuingInsurer) ? (ncdPercentage || 0) : 0;

  const { ncdAmount: annualNcd, finalPremium: annualFinal, appliedNcdPercentage } = applyNCD(
    annualBase, effectiveNcd, insurer.ncdAccepted
  );

  const durationLabel = COVERAGE_DURATION_OPTIONS.find(d => d.id === coverageDurationId)?.label || '1 Year (12 Months)';
  const proratedBase = proratePremium(annualBase, coverageDurationId || '4q');
  const proratedNcd = proratePremium(annualNcd, coverageDurationId || '4q');
  const proratedFinal = proratePremium(annualFinal, coverageDurationId || '4q');

  return {
    insurerId: insurer.id,
    insurerName: insurer.name,
    vehicleValueZMW,
    ratePercentage: insurer.ratePercentage,
    usageFactor,
    annualBasePremium: annualBase,
    annualNcdDiscount: annualNcd,
    annualFinalPremium: annualFinal,
    appliedNcdPercentage,
    ncdCodeApplied: isIssuingInsurer ? (ncdCode || null) : null,
    isNcdIssuer: isIssuingInsurer,
    coverageDuration: durationLabel,
    coverageDurationId: coverageDurationId || '4q',
    basePremium: proratedBase,
    ncdDiscount: proratedNcd,
    finalPremium: proratedFinal,
    ncdAccepted: insurer.ncdAccepted,
  };
}

/**
 * Calculate policy date information.
 */
export function calculatePolicyDates(startDateStr, durationId) {
  const duration = COVERAGE_DURATION_OPTIONS.find(d => d.id === durationId);
  if (!duration || !startDateStr) return null;

  const startDate = new Date(startDateStr);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + duration.days);

  const renewalReminderDate = new Date(endDate);
  renewalReminderDate.setDate(renewalReminderDate.getDate() - 30);

  const today = new Date();
  const msPerDay = 1000 * 60 * 60 * 24;
  const daysRemaining = Math.max(0, Math.ceil((endDate - today) / msPerDay));

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    daysTotal: duration.days,
    daysRemaining,
    renewalReminderDate: renewalReminderDate.toISOString(),
    formattedStart: startDate.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric' }),
    formattedEnd: endDate.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric' }),
    formattedReminder: renewalReminderDate.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short', year: 'numeric' }),
  };
}

/**
 * Validate a mock NCD code and return the percentage it carries.
 * In production this would be an API call.
 * Format: NCD-XXXXX → returns percentage stored in a mock registry
 */
const MOCK_NCD_REGISTRY = {
  'NCD-A1B2C': { percentage: 10, insurer: 'Prestige Assurance', yearsClaimFree: 1 },
  'NCD-D3E4F': { percentage: 20, insurer: 'Global Guard Insurance', yearsClaimFree: 2 },
  'NCD-G5H6I': { percentage: 30, insurer: 'ValueDirect Insurance', yearsClaimFree: 3 },
  'NCD-J7K8L': { percentage: 40, insurer: 'Madison General', yearsClaimFree: 4 },
  'NCD-M9N0P': { percentage: 50, insurer: 'Metro Safe Assurance', yearsClaimFree: 5 },
};

export function validateNcdCode(code) {
  if (!code) return null;
  return MOCK_NCD_REGISTRY[code.trim().toUpperCase()] || null;
}

/** Format ZMW currency */
export function formatZMW(amount) {
  if (!amount && amount !== 0) return 'ZMW —';
  return `ZMW ${Number(amount).toLocaleString('en-ZM', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
