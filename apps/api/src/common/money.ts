import { MAX_NGWEE, MAX_RATE_BPS, MIN_NGWEE, MIN_RATE_BPS } from './domain/money-limits.js';

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;

/** Exact decimal Kwacha text to ngwee, with no range limit. */
export function parseKwacha(text: string): bigint {
  const match = DECIMAL.exec(text);
  if (!match) {
    throw new RangeError('An amount must be a decimal number with at most two decimals');
  }
  const [, sign, whole, fraction = ''] = match;
  const ngwee = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return sign ? -ngwee : ngwee;
}

/** Wire Kwacha to stored ngwee, through the number's decimal text so no float error reaches storage. */
export function kwachaToNgwee(kwacha: number): number {
  const ngwee = parseKwacha(String(kwacha));
  if (ngwee < MIN_NGWEE || ngwee > MAX_NGWEE) {
    throw new RangeError('An amount is outside the supported range');
  }
  return Number(ngwee);
}

export function ngweeToKwacha(ngwee: number | bigint): number {
  if (typeof ngwee === 'number' && !Number.isSafeInteger(ngwee)) {
    throw new RangeError('An amount in ngwee must be a safe integer');
  }
  const value = BigInt(ngwee);
  const magnitude = value < 0n ? -value : value;
  const fraction = String(magnitude % 100n).padStart(2, '0');
  return Number(`${value < 0n ? '-' : ''}${magnitude / 100n}.${fraction}`);
}

/**
 * Decodes a SQL sum of ngwee. Throws rather than round when the Kwacha number
 * would not parse back to the same ngwee.
 */
export function sumToKwacha(sum: string): number {
  if (!/^-?\d+$/.test(sum)) {
    throw new RangeError('A sum of ngwee must be an integer');
  }
  const ngwee = BigInt(sum);
  const kwacha = ngweeToKwacha(ngwee);
  if (parseKwacha(String(kwacha)) !== ngwee) {
    throw new RangeError('A sum is too large to send as an exact Kwacha number');
  }
  return kwacha;
}

export function percentToBps(percent: number): number {
  const bps = parseKwacha(String(percent));
  if (bps < BigInt(MIN_RATE_BPS) || bps > BigInt(MAX_RATE_BPS)) {
    throw new RangeError(`A rate must be from ${MIN_RATE_BPS / 100}% to ${MAX_RATE_BPS / 100}%`);
  }
  return Number(bps);
}

export function bpsToPercent(bps: number): number {
  if (!Number.isSafeInteger(bps)) {
    throw new RangeError('A rate in basis points must be an integer');
  }
  if (bps < MIN_RATE_BPS || bps > MAX_RATE_BPS) {
    throw new RangeError(`A rate in basis points must be from ${MIN_RATE_BPS} to ${MAX_RATE_BPS}`);
  }
  return ngweeToKwacha(bps);
}

/** The one rounding rule for money: half away from zero, to a whole unit. */
export function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) {
    throw new RangeError('The divisor must be positive');
  }
  const magnitude = numerator < 0n ? -numerator : numerator;
  const quotient = (magnitude * 2n + denominator) / (denominator * 2n);
  return numerator < 0n ? -quotient : quotient;
}
