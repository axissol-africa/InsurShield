import type { NcdStatus } from '../../common/domain/enums.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const CODE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

export function canDecideNcd(current: NcdStatus): boolean {
  return current !== 'APPROVED' && current !== 'REJECTED';
}

export function ncdDecidedAt(decision: NcdStatus, now: Date): Date | null {
  return decision === 'APPROVED' || decision === 'REJECTED' ? now : null;
}

/** `NCD-` and twenty random characters, `pick(n)` choosing one of n. */
export function newNcdCode(pick: (n: number) => number): string {
  const suffix = Array.from({ length: 20 }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join('');
  return `NCD-${suffix}`;
}
