/**
 * JavaScript's `\s` set, written out so database prefiltering uses exactly the
 * same characters. It includes non-breaking spaces and a byte-order mark that
 * can arrive in copied registration numbers.
 */
const plateWhitespacePattern = '[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]+';
const PLATE_WHITESPACE = new RegExp(plateWhitespacePattern, 'g');

/** The PostgreSQL-compatible equivalent of `PLATE_WHITESPACE`. */
export const PLATE_WHITESPACE_SQL_PATTERN = plateWhitespacePattern;

/** Plates are stored and compared without spacing or case, e.g. "baa1234". */
export const comparablePlate = (plate: string) => plate.replace(PLATE_WHITESPACE, '').toUpperCase();

/** Display form: three letters, a space, then the digits — "BAA 1234". */
export const displayPlate = (plate: string) => {
  const compact = comparablePlate(plate);
  const parts = compact.match(/^([A-Z]+)(\d+)$/);
  return parts ? `${parts[1]} ${parts[2]}` : compact;
};
