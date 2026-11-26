export type NcdCodeRefusal = 'NOT_FOUND' | 'ALREADY_USED' | 'EXPIRED' | 'REVOKED';

/** Codes are stored upper-case; the customer may type them any way. */
export const normaliseNcdCode = (code: string): string => code.trim().toUpperCase();

/** Why a code cannot be used now, or null when it can. */
export function ncdCodeRefusal(
  code: { redeemedAt: Date | null; expiresAt: Date | null; revokedAt?: Date | null } | undefined,
  now: Date,
): NcdCodeRefusal | null {
  if (!code) return 'NOT_FOUND';
  if (code.revokedAt) return 'REVOKED';
  if (code.redeemedAt) return 'ALREADY_USED';
  if (code.expiresAt && code.expiresAt <= now) return 'EXPIRED';
  return null;
}

interface NcdVehicle {
  plateNumber: string;
  chassisNumber?: string | null;
  registrationCountry?: string | null;
}

const identifier = (value?: string | null) => value?.replace(/\s/g, '').toUpperCase() ?? '';

/** A new quote has a different snapshot id even when it describes the same vehicle. */
export function ncdVehicleMatches(source: NcdVehicle, quote: NcdVehicle): boolean {
  const chassis = identifier(source.chassisNumber);
  return chassis !== '' && chassis === identifier(quote.chassisNumber)
    && identifier(source.plateNumber) === identifier(quote.plateNumber)
    && identifier(source.registrationCountry ?? 'Zambia') === identifier(quote.registrationCountry ?? 'Zambia');
}
