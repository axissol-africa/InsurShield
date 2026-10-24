import type { NcdStatus } from '../../common/domain/enums.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Ten percent per claim-free year, matching the customer-facing NCD tiers. */
const NCD_PERCENTAGE_PER_YEAR = 10;
const MAX_NCD_PERCENTAGE = 50;

const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export function ncdPercentage(yearsClaimFree: number, chosen?: number): number {
  return chosen ?? Math.min(yearsClaimFree * NCD_PERCENTAGE_PER_YEAR, MAX_NCD_PERCENTAGE);
}

/** An approved application has its code issued, so it is never decided again. */
export function canDecideNcd(current: NcdStatus): boolean {
  return current !== 'APPROVED';
}

export function ncdDecidedAt(decision: NcdStatus, now: Date): Date | null {
  return decision === 'UNDER_REVIEW' ? null : now;
}

/** `NCD-` and five random characters, `pick(n)` choosing one of n. */
export function newNcdCode(pick: (n: number) => number): string {
  const suffix = Array.from({ length: 5 }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join('');
  return `NCD-${suffix}`;
}
