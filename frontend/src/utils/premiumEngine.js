/**
 * InsurShield — Premium Calculation Engine
 * ----------------------------------------
 * Formula: Annual Premium = Vehicle Value × Insurer Rate × Vehicle Usage Factor.
 * NCD support remains available in the engine for a future release, but is not
 * part of the customer quote request flow yet.
 */

import { COVERAGE_DURATION_OPTIONS, PIA_CONFIG } from './insurerRates';

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
export function calculateBasePremium(vehicleValueZMW, ratePercentage, vehicleUsage = 'Individual', piaRatePercentage = PIA_CONFIG.piaRatePercentage) {
  if (!vehicleValueZMW || vehicleValueZMW <= 0) return { premium: 0, usageFactor: 1, effectiveRate: 0, piaApplied: false };

  const usageFactor = USAGE_FACTORS[vehicleUsage] || 1;
  // The PIA floor is a percentage of vehicle value; no insurer may quote below it.
  const effectiveRate = Math.max(Number(ratePercentage) || 0, Number(piaRatePercentage) || 0);
  const premium = vehicleValueZMW * (effectiveRate / 100) * usageFactor;

  return { premium, usageFactor, effectiveRate, piaApplied: effectiveRate > (Number(ratePercentage) || 0) };
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
export function proratePremium(annualPremium, durationId, coverageDays = null) {
  if (coverageDays) return (annualPremium * coverageDays) / 365;
  const duration = COVERAGE_DURATION_OPTIONS.find(d => d.id === durationId);
  if (!duration) return annualPremium;
  return (annualPremium * duration.months) / 12;
}

/**
 * Full premium calculation for one insurer.
 * @param {{ vehicleValueZMW, insurer, ncdCode, ncdPercentage, ncdIssuingInsurer, coverageDurationId, vehicleUsage, coverageDays }}
 *   coverageDays — pass the actual cover length when the period is anchored to an RTSA anniversary
 * @returns {object} Full breakdown
 */
export function calculatePremium({ vehicleValueZMW, insurer, ncdCode, ncdPercentage, ncdIssuingInsurer, coverageDurationId, vehicleUsage, coverageDays = null, piaRatePercentage }) {
  const { premium: annualBase, usageFactor, effectiveRate, piaApplied } = calculateBasePremium(
    vehicleValueZMW,
    insurer.ratePercentage,
    vehicleUsage,
    piaRatePercentage,
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
  const proratedBase = proratePremium(annualBase, coverageDurationId || '4q', coverageDays);
  const proratedNcd = proratePremium(annualNcd, coverageDurationId || '4q', coverageDays);
  const proratedFinal = proratePremium(annualFinal, coverageDurationId || '4q', coverageDays);

  return {
    insurerId: insurer.id,
    insurerName: insurer.name,
    vehicleValueZMW,
    ratePercentage: insurer.ratePercentage,
    effectiveRate,
    piaApplied,
    usageFactor,
    annualBasePremium: annualBase,
    annualNcdDiscount: annualNcd,
    annualFinalPremium: annualFinal,
    appliedNcdPercentage,
    ncdCodeApplied: isIssuingInsurer ? (ncdCode || null) : null,
    isNcdIssuer: isIssuingInsurer,
    coverageDuration: durationLabel,
    coverageDurationId: coverageDurationId || '4q',
    coverageDays,
    basePremium: proratedBase,
    ncdDiscount: proratedNcd,
    finalPremium: proratedFinal,
    ncdAccepted: insurer.ncdAccepted,
  };
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const addMonths = (date, months) => {
  const targetMonth = date.getMonth() + months;
  const targetYear = date.getFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(targetYear, normalizedMonth + 1, 0).getDate();
  return new Date(targetYear, normalizedMonth, Math.min(date.getDate(), lastDayOfTargetMonth));
};

const parseCalendarDate = (value) => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
};

/**
 * Cover periods can be anchored to the vehicle's RTSA registration anniversary,
 * so insurance and road tax fall due together. Quarters then run from the
 * anniversary (e.g. registered 15 March → 15 Mar, 15 Jun, 15 Sep, 15 Dec) and
 * cover ends on the boundary `months` after the most recent one, which shortens
 * the period and pro-rates the premium by days.
 * @returns {Date} the most recent quarter boundary on or before `startDate`
 */
export function lastAnniversaryBoundary(startDate, anniversaryDateStr) {
  const anniversary = parseCalendarDate(anniversaryDateStr);
  if (!anniversary) return null;
  let boundary = new Date(startDate.getFullYear() - 1, anniversary.getMonth(), anniversary.getDate());
  while (addMonths(boundary, 3) <= startDate) boundary = addMonths(boundary, 3);
  return boundary;
}

/**
 * Calculate policy date information.
 * @param {string} startDateStr  ISO date the cover starts
 * @param {string} durationId    one of COVERAGE_DURATION_OPTIONS ids
 * @param {{ anniversaryDate?: string }} options  RTSA registration date to align the end date to
 */
export function calculatePolicyDates(startDateStr, durationId, { anniversaryDate } = {}) {
  const duration = COVERAGE_DURATION_OPTIONS.find(d => d.id === durationId);
  if (!duration || !startDateStr) return null;

  const startDate = parseCalendarDate(startDateStr);
  if (!startDate) return null;
  // The matching option has already set policy start to this year's RTSA day
  // and month. Add the chosen term from that date—never from a previous
  // quarterly boundary—so a 31 Oct start plus one quarter ends on 31 Jan.
  const rtsaAnniversary = anniversaryDate ? parseCalendarDate(anniversaryDate) : null;
  const endDate = rtsaAnniversary ? addMonths(startDate, duration.months) : new Date(startDate.getTime() + duration.days * MS_PER_DAY);
  const daysTotal = Math.round((endDate - startDate) / MS_PER_DAY);

  const renewalReminderDate = new Date(endDate.getTime() - 30 * MS_PER_DAY);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysRemaining = Math.max(0, Math.ceil((endDate - today) / MS_PER_DAY));
  // An anniversary start earlier in the year backdates the cover; part (or all) of it may already have passed.
  const daysElapsed = Math.min(daysTotal, Math.max(0, Math.round((today - startDate) / MS_PER_DAY)));

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    daysTotal,
    daysRemaining,
    daysElapsed,
    hasEnded: endDate <= today,
    standardDays: duration.days,
    anchoredToAnniversary: Boolean(rtsaAnniversary),
    anniversaryLabel: rtsaAnniversary ? rtsaAnniversary.toLocaleDateString('en-ZM', { day: '2-digit', month: 'short' }) : null,
    renewalReminderDate: renewalReminderDate.toISOString(),
    formattedStart: formatDate(startDate),
    formattedEnd: formatDate(endDate),
    formattedReminder: formatDate(renewalReminderDate),
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

/** Format an ISO date or Date for display, e.g. "11 Sep 2026". */
export function formatDate(value, { long = false } = {}) {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-ZM', { day: '2-digit', month: long ? 'long' : 'short', year: 'numeric' });
}
