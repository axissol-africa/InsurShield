export interface BadgeRules {
  badgeWindowDays: number;
  badgeMinimumPolicies: number;
  badgeThresholdBps: number;
  badgeValidityHours: number;
}

export interface PublicCertificateBadge {
  insurerId: string;
  code: 'ON_TIME_CERTIFICATES';
  label: 'On-time policy certificates';
  sampleCount: number;
  onTimeCount: number;
  minimumPolicies: number;
  thresholdBps: number;
  percentage: number;
  periodStart: string;
  periodEnd: string;
  awardedAt: string;
  expiresAt: string;
  ruleVersion: number;
  dataSource: string;
  method: string;
  disclaimer: string;
}

export const BADGE_SOURCE = 'Recorded policy certificate deadlines, certificate issue times and confirmed payments through InsurShield.';
export const BADGE_METHOD = 'One record per policy with a confirmed payment and a recorded deadline in the inclusive measurement window. Issuance from payment confirmation through the deadline counts as on time; late or absent issuance counts as a miss. Eligibility uses the exact ratio before rounding.';
export const BADGE_DISCLAIMER = 'Based on recent certificate issuance through InsurShield. Check your quote and policy for cover details.';

export function qualifies(sampleCount: number, onTimeCount: number, minimumPolicies: number, thresholdBps: number): boolean {
  return sampleCount >= minimumPolicies && BigInt(onTimeCount) * 10_000n >= BigInt(sampleCount) * BigInt(thresholdBps);
}

export function badgeWindow(rules: BadgeRules, now: Date) {
  return {
    periodStart: new Date(now.getTime() - rules.badgeWindowDays * 86_400_000),
    periodEnd: now,
    expiresAt: new Date(now.getTime() + rules.badgeValidityHours * 3_600_000),
  };
}
