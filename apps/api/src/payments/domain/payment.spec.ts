import {
  expectedAmountMinor,
  isQuoteExpired,
  newReference,
  providerReference,
  replayOutcome,
  type PaymentAttempt,
} from './payment.js';

describe('a payment key used again', () => {
  const stored: PaymentAttempt = {
    customerId: 'customer-1',
    quoteRequestId: 'QR-1',
    insurerName: 'Prestige Assurance',
    amountMinor: 123_456,
    method: 'MOBILE_MONEY',
  };

  it('replays the payment when the request is the same', () => {
    expect(replayOutcome(stored, { ...stored })).toBe('replay');
  });

  it.each([
    ['request', { quoteRequestId: 'QR-2' }],
    ['insurer', { insurerName: 'Other Insurance' }],
    ['amount', { amountMinor: 123_457 }],
    ['method', { method: 'CARD' as const }],
  ])('is a different payment when the %s differs', (_field, change) => {
    expect(replayOutcome(stored, { ...stored, ...change })).toBe('different-payment');
  });

  it('belongs to another customer whatever the rest of the request', () => {
    expect(replayOutcome(stored, { ...stored, customerId: 'customer-2' })).toBe('another-customer');
    expect(replayOutcome(stored, { ...stored, customerId: 'customer-2', amountMinor: 1 })).toBe('another-customer');
  });
});

describe('the amount a quote is paid with', () => {
  it('is the premium plus the fee, in ngwee', () => {
    expect(expectedAmountMinor(123_456, 10)).toBe(123_466);
    expect(expectedAmountMinor(123_456, 0)).toBe(123_456);
  });
});

describe('a quote', () => {
  const validUntil = new Date('2026-10-24T12:00:00.000Z');

  it('can be paid until the moment it expires', () => {
    expect(isQuoteExpired(validUntil, new Date('2026-10-24T11:59:59.999Z'))).toBe(false);
  });

  it('is expired at and after that moment', () => {
    expect(isQuoteExpired(validUntil, validUntil)).toBe(true);
    expect(isQuoteExpired(validUntil, new Date('2026-10-24T12:00:00.001Z'))).toBe(true);
  });
});

describe('a reference', () => {
  it('is the prefix, the time in base 36 and three characters picked from digits and capitals', () => {
    const now = new Date('2026-10-24T12:00:00.000Z');
    const picks = [0, 10, 35];

    expect(newReference('TXN', now, () => picks.shift() ?? 0)).toBe(
      `TXN-${now.getTime().toString(36).toUpperCase()}0AZ`,
    );
  });
});

describe('the provider reference', () => {
  it('keeps only the last four digits of a wallet number', () => {
    expect(providerReference('+260971234567')).toBe('MM-4567');
  });

  it('is absent without a wallet number', () => {
    expect(providerReference(undefined)).toBeNull();
    expect(providerReference('')).toBeNull();
  });
});
