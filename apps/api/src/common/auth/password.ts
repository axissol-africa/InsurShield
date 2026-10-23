import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/**
 * Password storage.
 *
 * scrypt is memory-hard and ships with Node, so there is no native module to
 * build into the image. Parameters are stored alongside the hash, which means
 * they can be raised later without invalidating existing passwords: an old
 * hash still verifies against the cost it was written with.
 *
 * A stored hash is `scrypt$N$r$p$salt$key`, all in hex.
 */
/** `promisify` cannot see the options overload, so the wrapper is written out. */
const scryptAsync = (password: string, salt: Buffer, keylen: number, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => (error ? reject(error) : resolve(key)));
  });

/** ~64MB per hash at N=16384, r=8 — deliberate, and the reason sign-in is not free. */
const COST = { N: 16_384, r: 8, p: 1 };
const KEY_BYTES = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 8;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_BYTES, COST);
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('hex'), key.toString('hex')].join('$');
}

/**
 * Checks a password against a stored hash. Returns false — never throws — for
 * an empty, malformed or unknown-format hash, so an account that has no usable
 * password simply cannot be signed into.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored || !password) return false;

  const [scheme, n, r, p, saltHex, keyHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;

  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Number.isFinite(cost.N) || !Number.isFinite(cost.r) || !Number.isFinite(cost.p)) return false;

  const expected = Buffer.from(keyHex, 'hex');
  let actual: Buffer;
  try {
    actual = await scryptAsync(
      password.normalize('NFKC'),
      Buffer.from(saltHex, 'hex'),
      expected.length,
      cost,
    );
  } catch {
    // Absurd stored parameters would otherwise exhaust memory on every attempt.
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * A temporary password an administrator can read out over the phone.
 * Digits and ambiguous letters are left out so it survives being spoken.
 */
const SPEAKABLE = 'abcdefghjkmnpqrstuvwxyz';

export function temporaryPassword(): string {
  const bytes = randomBytes(12);
  const word = (start: number, length: number) =>
    Array.from({ length }, (_, i) => SPEAKABLE[bytes[start + i] % SPEAKABLE.length]).join('');
  return `${word(0, 4)}-${word(4, 4)}-${(bytes[8] % 90) + 10}`;
}
