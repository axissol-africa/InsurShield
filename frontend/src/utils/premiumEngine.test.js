import { describe, expect, it } from 'vitest';
import { calculateBasePremium, calculatePolicyDates, calculatePremium, formatDate, formatZMW, proratePremium, validateNcdCode } from './premiumEngine';

const insurer = { id: '1', name: 'Prestige Assurance', ratePercentage: 4.5, ncdAccepted: true };

describe('calculateBasePremium', () => {
  it('applies rate and usage factor', () => {
    expect(calculateBasePremium(250000, 4.5).premium).toBe(11250);
    expect(calculateBasePremium(250000, 4.5, 'Commercial (Taxis & Yangos)').premium).toBeCloseTo(14400);
  });
  it('is zero for a missing or non-positive value', () => {
    expect(calculateBasePremium(0, 4.5).premium).toBe(0);
    expect(calculateBasePremium(-5, 4.5).premium).toBe(0);
    expect(calculateBasePremium(undefined, 4.5).premium).toBe(0);
  });
  it('falls back to a neutral factor for unknown usage', () => {
    expect(calculateBasePremium(100000, 4, 'Spaceship').usageFactor).toBe(1);
  });
});

describe('proratePremium', () => {
  it('pro-rates by months for standard durations', () => {
    expect(proratePremium(12000, '1q')).toBe(3000);
    expect(proratePremium(12000, '2q')).toBe(6000);
    expect(proratePremium(12000, '4q')).toBe(12000);
  });
  it('pro-rates by days when a cover length is given', () => {
    expect(proratePremium(3650, '2q', 179)).toBeCloseTo(1790);
  });
  it('returns the annual premium for an unknown duration', () => {
    expect(proratePremium(12000, 'nope')).toBe(12000);
  });
});

describe('calculatePremium', () => {
  it('produces the pro-rated final premium', () => {
    const breakdown = calculatePremium({ vehicleValueZMW: 250000, insurer, coverageDurationId: '2q' });
    expect(breakdown.finalPremium).toBe(5625);
    expect(breakdown.coverageDuration).toBe('2 Quarters (6 Months)');
  });
  it('only applies NCD from the issuing insurer', () => {
    const args = { vehicleValueZMW: 100000, insurer, coverageDurationId: '4q', ncdCode: 'NCD-A1B2C', ncdPercentage: 10 };
    expect(calculatePremium({ ...args, ncdIssuingInsurer: 'Prestige Assurance' }).finalPremium).toBe(4050);
    expect(calculatePremium({ ...args, ncdIssuingInsurer: 'Madison General' }).finalPremium).toBe(4500);
  });
  it('ignores NCD for insurers that do not accept it', () => {
    const noNcd = { ...insurer, ncdAccepted: false };
    expect(calculatePremium({ vehicleValueZMW: 100000, insurer: noNcd, coverageDurationId: '4q', ncdCode: 'X', ncdPercentage: 50, ncdIssuingInsurer: noNcd.name }).finalPremium).toBe(4500);
  });
});

describe('calculatePolicyDates', () => {
  it('uses the fixed day count for standard cover', () => {
    const dates = calculatePolicyDates('2026-09-17', '1q');
    expect(dates.daysTotal).toBe(91);
    expect(dates.formattedStart).toBe('17 Sept 2026');
    expect(dates.anchoredToAnniversary).toBe(false);
  });
  it('adds calendar months from an RTSA anniversary start', () => {
    const dates = calculatePolicyDates('2026-10-31', '1q', { anniversaryDate: '2023-10-31' });
    expect(dates.formattedEnd).toBe('31 Jan 2027');
    expect(dates.anchoredToAnniversary).toBe(true);
  });
  it('clamps month-end dates instead of overflowing', () => {
    expect(calculatePolicyDates('2026-01-31', '1q', { anniversaryDate: '2020-01-31' }).formattedEnd).toBe('30 Apr 2026');
    expect(calculatePolicyDates('2024-02-29', '4q', { anniversaryDate: '2020-02-29' }).formattedEnd).toBe('28 Feb 2025');
  });
  it('flags cover that has already ended and counts elapsed days', () => {
    const ended = calculatePolicyDates('2020-03-15', '1q', { anniversaryDate: '2020-03-15' });
    expect(ended.hasEnded).toBe(true);
    expect(ended.daysElapsed).toBe(ended.daysTotal);
    expect(ended.daysRemaining).toBe(0);

    const future = calculatePolicyDates('2999-01-01', '1q');
    expect(future.hasEnded).toBe(false);
    expect(future.daysElapsed).toBe(0);
  });
  it('returns null for bad input', () => {
    expect(calculatePolicyDates('nonsense', '1q')).toBeNull();
    expect(calculatePolicyDates('2026-09-17', '9q')).toBeNull();
    expect(calculatePolicyDates('', '1q')).toBeNull();
  });
});

describe('validateNcdCode', () => {
  it('is case-insensitive and tolerant of whitespace', () => {
    expect(validateNcdCode(' ncd-a1b2c ')?.percentage).toBe(10);
    expect(validateNcdCode('NCD-XXXXX')).toBeNull();
    expect(validateNcdCode('')).toBeNull();
  });
});

describe('formatters', () => {
  it('formats kwacha with two decimals', () => {
    expect(formatZMW(10000)).toBe('ZMW 10,000.00');
    expect(formatZMW(0)).toBe('ZMW 0.00');
    expect(formatZMW(undefined)).toBe('ZMW —');
    expect(formatZMW(NaN)).toBe('ZMW —');
  });
  it('formats dates consistently and survives bad values', () => {
    expect(formatDate('2027-03-15')).toBe('15 Mar 2027');
    expect(formatDate('not a date')).toBe('—');
    expect(formatDate(null)).toBe('—');
  });
});

describe('PIA floor', () => {
  it('raises a rate below the PIA minimum to the floor', () => {
    const cheap = { ...insurer, ratePercentage: 3 };
    const breakdown = calculatePremium({ vehicleValueZMW: 100000, insurer: cheap, coverageDurationId: '4q' });
    expect(breakdown.effectiveRate).toBe(4);
    expect(breakdown.piaApplied).toBe(true);
    expect(breakdown.finalPremium).toBe(4000);
  });
  it('honours a configured floor', () => {
    const breakdown = calculatePremium({ vehicleValueZMW: 100000, insurer, coverageDurationId: '4q', piaRatePercentage: 6 });
    expect(breakdown.finalPremium).toBe(6000);
    expect(calculatePremium({ vehicleValueZMW: 100000, insurer, coverageDurationId: '4q', piaRatePercentage: 0 }).finalPremium).toBe(4500);
  });
});
