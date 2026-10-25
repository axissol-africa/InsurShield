const REFERENCE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** `TXN-…`, `CLM-…` and the like: the time in base 36 and three random characters, `pick(n)` choosing one of n. */
export function newReference(prefix: string, now: Date, pick: (n: number) => number): string {
  const suffix = Array.from({ length: 3 }, () => REFERENCE_ALPHABET[pick(REFERENCE_ALPHABET.length)]).join('');
  return `${prefix}-${now.getTime().toString(36).toUpperCase()}${suffix}`;
}
