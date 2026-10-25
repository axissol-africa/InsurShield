export type NcdCodeRefusal = 'NOT_FOUND' | 'ALREADY_USED' | 'EXPIRED';

/** Codes are stored upper-case; the customer may type them any way. */
export const normaliseNcdCode = (code: string): string => code.trim().toUpperCase();

/** Why a code cannot be used now, or null when it can. */
export function ncdCodeRefusal(
  code: { redeemedAt: Date | null; expiresAt: Date | null } | undefined,
  now: Date,
): NcdCodeRefusal | null {
  if (!code) return 'NOT_FOUND';
  if (code.redeemedAt) return 'ALREADY_USED';
  if (code.expiresAt && code.expiresAt <= now) return 'EXPIRED';
  return null;
}
