import type { QuoteAddOn } from '../../db/schema.js';
import {
  eventFit,
  isQuoteExpired,
  maskMsisdn,
  paymentBreakdown,
  replayOutcome,
  rtsaFeeOf,
  totalOf,
  type PaymentAttempt,
  type PaymentCharge,
} from './payment.js';

describe('a payment key used again', () => {
  const stored: PaymentAttempt = {
    customerId: 'customer-1',
    quoteRequestId: 'QR-1',
    insurerQuoteId: 'd9a14c5d-1f35-4276-9c31-ec6aeb71151a',
    amountMinor: 123_456,
    method: 'MOBILE_MONEY',
  };

  it('replays the payment when the request is the same', () => {
    expect(replayOutcome(stored, { ...stored })).toBe('replay');
  });

  it.each([
    ['request', { quoteRequestId: 'QR-2' }],
    ['quote', { insurerQuoteId: 'fc1868f7-6f89-4672-acf1-c531c922463d' }],
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

describe('a quote', () => {
  const validUntil = new Date('2026-10-24T12:00:00.000Z');

  it('can be paid until the moment it expires', () => {
    expect(isQuoteExpired(validUntil, new Date('2026-10-24T11:59:59.999Z'))).toBe(false);
  });

  it('is expired at and after that moment', () => {
    expect(isQuoteExpired(validUntil, validUntil)).toBe(true);
  });
});

describe('the payment breakdown', () => {
  const addOns: QuoteAddOn[] = [
    { code: 'WINDSCREEN', label: 'Windscreen cover', priceMinor: 15_000, included: false, terms: null },
    { code: 'TOWING', label: 'Towing', priceMinor: 9_000, included: true, terms: null },
    { code: 'CAR_HIRE', label: 'Car hire', priceMinor: 20_000, included: false, terms: null },
  ];
  const rtsa: PaymentCharge = { code: 'RTSA_ANNIVERSARY_FEE', label: 'RTSA anniversary fee', basis: 'FIXED', amountMinor: 50_000, when: 'RTSA_ANNIVERSARY' };
  const levy: PaymentCharge = { code: 'LEVY', label: 'Levy', basis: 'PERCENT_OF_PREMIUM', basisPoints: 300, coverTypes: ['COMPREHENSIVE'], when: 'ALWAYS' };

  it('is the premium alone when nothing else applies', () => {
    const lines = paymentBreakdown({ premiumMinor: 100_000, addOns, selectedAddOnCodes: [], charges: [rtsa], coverType: 'THIRD_PARTY', alignedToRtsaAnniversary: false });
    expect(lines).toEqual([{ kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amountMinor: 100_000 }]);
    expect(totalOf(lines)).toBe(100_000);
  });

  it('adds only chosen optional add-ons, never an included one, and the charges that apply', () => {
    const lines = paymentBreakdown({
      premiumMinor: 100_000,
      addOns,
      selectedAddOnCodes: ['WINDSCREEN', 'TOWING'],
      charges: [rtsa, levy],
      coverType: 'COMPREHENSIVE',
      alignedToRtsaAnniversary: true,
    });
    expect(lines.map((line) => [line.code, line.amountMinor])).toEqual([
      ['PREMIUM', 100_000],
      ['WINDSCREEN', 15_000],
      ['RTSA_ANNIVERSARY_FEE', 50_000],
      ['LEVY', 3_000],
    ]);
    expect(totalOf(lines)).toBe(168_000);
    expect(rtsaFeeOf(lines)).toBe(50_000);
  });

  it('leaves out a charge limited to other cover types', () => {
    const lines = paymentBreakdown({ premiumMinor: 100_000, addOns: [], selectedAddOnCodes: [], charges: [levy], coverType: 'THIRD_PARTY', alignedToRtsaAnniversary: false });
    expect(lines).toHaveLength(1);
  });
});

describe('a wallet number', () => {
  it('keeps only its last three digits', () => {
    expect(maskMsisdn('+260 97 123 4567')).toBe('***567');
    expect(maskMsisdn(undefined)).toBeNull();
  });
});

describe('a provider event', () => {
  it.each([
    ['payment.confirmed', 'PENDING', 'apply'],
    ['payment.confirmed', 'INITIATED', 'apply'],
    ['payment.confirmed', 'CONFIRMED', 'already-applied'],
    ['payment.confirmed', 'EXPIRED', 'conflict'],
    ['payment.failed', 'CONFIRMED', 'conflict'],
    ['payment.failed', 'FAILED', 'already-applied'],
    ['payment.cancelled', 'PENDING', 'apply'],
    ['payment.reversed', 'CONFIRMED', 'apply'],
    ['payment.reversed', 'PENDING', 'conflict'],
    ['refund.completed', 'CONFIRMED', 'unhandled'],
  ] as const)('%s on a %s payment: %s', (type, status, fit) => {
    expect(eventFit(type, status)).toBe(fit);
  });
});
