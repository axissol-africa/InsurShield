import { describe, expect, it } from 'vitest';
import { MAX_KWACHA, MAX_NGWEE, MAX_RATE_BPS, MIN_NGWEE, MIN_RATE_BPS } from './domain/money-limits.js';
import {
  bpsToPercent,
  divideRoundHalfUp,
  kwachaToNgwee,
  ngweeToKwacha,
  parseKwacha,
  percentToBps,
  sumToKwacha,
} from './money.js';

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

describe('money limits', () => {
  it('derives the largest Kwacha amount from the largest ngwee amount', () => {
    expect(MIN_NGWEE).toBe(0n);
    expect(MAX_NGWEE).toBe(99999999999999n);
    expect(MAX_KWACHA).toBe(999999999999.99);
    expect(MIN_RATE_BPS).toBe(0);
    expect(MAX_RATE_BPS).toBe(10000);
  });
});

describe('kwachaToNgwee', () => {
  it.each([
    [0, 0],
    [0.01, 1],
    [0.1, 10],
    [0.29, 29],
    [1, 100],
    [5.25, 525],
    [999999999999.99, 99999999999999],
  ])('converts %s Kwacha to %s ngwee exactly', (kwacha, ngwee) => {
    expect(kwachaToNgwee(kwacha)).toBe(ngwee);
  });

  it.each([
    ['more than two decimals', 1.005],
    ['one ngwee above the limit', 1000000000000],
    ['a negative amount', -0.01],
    ['NaN', Number.NaN],
    ['infinity', Number.POSITIVE_INFINITY],
    ['an exponent form', 1e21],
  ])('refuses %s', (_case, kwacha) => {
    expect(() => kwachaToNgwee(kwacha)).toThrow(RangeError);
  });

  it('round-trips 10,000 random two-decimal amounts exactly', () => {
    const random = seededRandom(20261024);
    for (let i = 0; i < 10_000; i += 1) {
      const ngwee = Math.floor(random() * (Number(MAX_NGWEE) + 1));
      const text = `${Math.floor(ngwee / 100)}.${String(ngwee % 100).padStart(2, '0')}`;
      const kwacha = Number(text);
      expect(kwachaToNgwee(kwacha), text).toBe(ngwee);
      expect(ngweeToKwacha(ngwee), text).toBe(kwacha);
    }
  });
});

describe('ngweeToKwacha', () => {
  it.each([
    [0, 0],
    [1, 0.01],
    [10, 0.1],
    [29, 0.29],
    [525, 5.25],
    [99999999999999, 999999999999.99],
    [99999999999999n, 999999999999.99],
  ])('converts %s ngwee to %s Kwacha', (ngwee, kwacha) => {
    expect(ngweeToKwacha(ngwee)).toBe(kwacha);
  });

  it.each([
    ['a fraction of a ngwee', 1.5],
    ['an unsafe integer', 2 ** 53],
  ])('refuses %s', (_case, ngwee) => {
    expect(() => ngweeToKwacha(ngwee)).toThrow(RangeError);
  });
});

describe('parseKwacha', () => {
  it.each([
    ['0', 0n],
    ['0.1', 10n],
    ['0.29', 29n],
    ['12', 1200n],
    ['-3.5', -350n],
    ['123456789012345678.91', 12345678901234567891n],
  ])('parses %s exactly with no range limit', (text, ngwee) => {
    expect(parseKwacha(text)).toBe(ngwee);
  });

  it.each(['1.005', '', '.5', '1.', '1e3', ' 1', '0x10', 'abc', '+1'])('refuses %j', (text) => {
    expect(() => parseKwacha(text)).toThrow(RangeError);
  });
});

describe('sumToKwacha', () => {
  it.each([
    ['0', 0],
    ['1', 0.01],
    ['30', 0.3],
    ['99999999999999', 999999999999.99],
    ['-250', -2.5],
  ])('decodes the SQL sum %s', (sum, kwacha) => {
    expect(sumToKwacha(sum)).toBe(kwacha);
  });

  it('returns a Kwacha number only when it parses back to the same ngwee', () => {
    const exact = 2n ** 46n * 100n - 1n;
    expect(parseKwacha(String(sumToKwacha(exact.toString())))).toBe(exact);
  });

  it('refuses a sum the number cannot carry exactly', () => {
    expect(() => sumToKwacha('999999999999999999')).toThrow(RangeError);
  });

  it.each(['1.5', '', 'abc'])('refuses the sum text %j', (sum) => {
    expect(() => sumToKwacha(sum)).toThrow(RangeError);
  });
});

describe('percentToBps and bpsToPercent', () => {
  it.each([
    [0, 0],
    [0.01, 1],
    [5.25, 525],
    [17.5, 1750],
    [100, 10000],
  ])('converts %s%% to %s basis points and back exactly', (percent, bps) => {
    expect(percentToBps(percent)).toBe(bps);
    expect(bpsToPercent(bps)).toBe(percent);
  });

  it.each([
    ['more than two decimals', 5.255],
    ['a rate above 100%', 100.01],
    ['a negative rate', -1],
    ['NaN', Number.NaN],
  ])('refuses %s', (_case, percent) => {
    expect(() => percentToBps(percent)).toThrow(RangeError);
  });

  it('refuses a fractional basis point', () => {
    expect(() => bpsToPercent(1.5)).toThrow(RangeError);
  });

  it.each([MIN_RATE_BPS - 1, MAX_RATE_BPS + 1])('refuses %s basis points', (bps) => {
    expect(() => bpsToPercent(bps)).toThrow(RangeError);
  });
});

describe('divideRoundHalfUp', () => {
  it.each([
    [10n, 4n, 3n],
    [9n, 4n, 2n],
    [11n, 4n, 3n],
    [15n, 10n, 2n],
    [14n, 10n, 1n],
    [-15n, 10n, -2n],
    [-14n, 10n, -1n],
    [0n, 7n, 0n],
    [100n, 1n, 100n],
  ])('rounds %s / %s half away from zero to %s', (numerator, denominator, result) => {
    expect(divideRoundHalfUp(numerator, denominator)).toBe(result);
  });

  it('rounds a premium at a basis-point rate to the ngwee', () => {
    expect(divideRoundHalfUp(12345n * 525n, 10000n)).toBe(648n);
    expect(divideRoundHalfUp(10000n * 5n, 10000n)).toBe(5n);
  });

  it.each([0n, -1n])('refuses a divisor of %s', (denominator) => {
    expect(() => divideRoundHalfUp(1n, denominator)).toThrow(RangeError);
  });
});
