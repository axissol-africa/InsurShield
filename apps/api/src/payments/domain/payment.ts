import type { PaymentMethod, PaymentStatus } from '../../common/domain/enums.js';
import type { PaymentLine, QuoteAddOn } from '../../db/schema.js';
import type { RuleValueFor } from '../../settings/domain/rules.js';
import type { PaymentEventType } from '../provider/payment-provider.js';

/** What a payment request asks for, in stored values. */
export interface PaymentAttempt {
  customerId: string;
  quoteRequestId: string;
  insurerQuoteId: string;
  amountMinor: number;
  method: PaymentMethod;
}

export type ReplayOutcome = 'replay' | 'another-customer' | 'different-payment';

/** A key replays only the payment it was first used for; the wallet number is not stored whole, so it is not compared. */
export function replayOutcome(stored: PaymentAttempt, attempt: PaymentAttempt): ReplayOutcome {
  if (stored.customerId !== attempt.customerId) return 'another-customer';
  const same =
    stored.quoteRequestId === attempt.quoteRequestId &&
    stored.insurerQuoteId === attempt.insurerQuoteId &&
    stored.amountMinor === attempt.amountMinor &&
    stored.method === attempt.method;
  return same ? 'replay' : 'different-payment';
}

export function isQuoteExpired(validUntil: Date, now: Date): boolean {
  return validUntil <= now;
}

export type PaymentCharge = RuleValueFor<'PAYMENT_CHARGES'>['charges'][number];

export interface BreakdownInput {
  premiumMinor: number;
  addOns: readonly QuoteAddOn[];
  selectedAddOnCodes: readonly string[];
  charges: readonly PaymentCharge[];
  coverType: string;
  alignedToRtsaAnniversary: boolean;
}

/**
 * Every line the customer pays, worked out on the server: the quoted premium,
 * each optional add-on they chose, and each approved charge that applies. No
 * road tax is ever added (decision 21).
 */
export function paymentBreakdown(input: BreakdownInput): PaymentLine[] {
  const lines: PaymentLine[] = [{ kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amountMinor: input.premiumMinor }];
  for (const addOn of input.addOns) {
    if (addOn.included || !input.selectedAddOnCodes.includes(addOn.code)) continue;
    lines.push({ kind: 'ADD_ON', code: addOn.code, label: addOn.label, amountMinor: addOn.priceMinor });
  }
  for (const charge of input.charges) {
    if (charge.when === 'RTSA_ANNIVERSARY' && !input.alignedToRtsaAnniversary) continue;
    if (charge.coverTypes && charge.coverTypes.length > 0 && !charge.coverTypes.includes(input.coverType)) continue;
    const amountMinor =
      charge.basis === 'FIXED'
        ? (charge.amountMinor ?? 0)
        : Math.round((input.premiumMinor * (charge.basisPoints ?? 0)) / 10_000);
    if (amountMinor > 0) lines.push({ kind: 'CHARGE', code: charge.code, label: charge.label, amountMinor });
  }
  return lines;
}

export function totalOf(lines: readonly PaymentLine[]): number {
  return lines.reduce((sum, line) => sum + line.amountMinor, 0);
}

/** The RTSA anniversary fee within a breakdown, kept in its own column for receipts and settlements. */
export function rtsaFeeOf(lines: readonly PaymentLine[]): number {
  return lines.find((line) => line.kind === 'CHARGE' && line.code === 'RTSA_ANNIVERSARY_FEE')?.amountMinor ?? 0;
}

/** Only the last three digits of a wallet number are kept or shown. */
export function maskMsisdn(mobileNumber: string | undefined): string | null {
  const digits = mobileNumber?.replace(/\D/g, '') ?? '';
  return digits.length >= 3 ? `***${digits.slice(-3)}` : null;
}

export function isOpenPayment(status: PaymentStatus): boolean {
  return status === 'INITIATED' || status === 'PENDING';
}

/** How a provider event moves a payment, and from which states it may. */
export const PAYMENT_EVENT_MOVES: Partial<Record<PaymentEventType, { from: readonly PaymentStatus[]; to: PaymentStatus }>> = {
  'payment.confirmed': { from: ['INITIATED', 'PENDING'], to: 'CONFIRMED' },
  'payment.failed': { from: ['INITIATED', 'PENDING'], to: 'FAILED' },
  'payment.cancelled': { from: ['INITIATED', 'PENDING'], to: 'CANCELLED' },
  'payment.reversed': { from: ['CONFIRMED'], to: 'REVERSED' },
};

export type EventFit = 'apply' | 'already-applied' | 'conflict' | 'unhandled';

/** Whether an event fits the payment as it now stands. A repeat of what already happened changes nothing. */
export function eventFit(type: PaymentEventType, current: PaymentStatus): EventFit {
  const move = PAYMENT_EVENT_MOVES[type];
  if (!move) return 'unhandled';
  if (move.from.includes(current)) return 'apply';
  return current === move.to ? 'already-applied' : 'conflict';
}

/** What the customer reads about an attempt that did not go through. */
export const FAILURE_WORDING: Record<string, string> = {
  DECLINED: 'The payment was declined. No money was taken.',
  CANCELLED: 'The payment was cancelled. No money was taken.',
  EXPIRED: 'We did not hear back about the payment in time, so it was stopped. No money was taken.',
  REFUSED: 'The payment provider could not start this payment. No money was taken.',
  NEVER_SENT: 'This payment was never completed. No money was taken.',
};
