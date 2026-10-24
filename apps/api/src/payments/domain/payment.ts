import type { PaymentMethod } from '../../common/domain/enums.js';

/** What a payment request asks for, in stored values. */
export interface PaymentAttempt {
  customerId: string;
  quoteRequestId: string;
  insurerName: string;
  amountMinor: number;
  method: PaymentMethod;
}

export type ReplayOutcome = 'replay' | 'another-customer' | 'different-payment';

/** A key replays only the payment it was first used for; the mobile number is not stored, so it is not compared. */
export function replayOutcome(stored: PaymentAttempt, attempt: PaymentAttempt): ReplayOutcome {
  if (stored.customerId !== attempt.customerId) return 'another-customer';
  const same =
    stored.quoteRequestId === attempt.quoteRequestId &&
    stored.insurerName === attempt.insurerName &&
    stored.amountMinor === attempt.amountMinor &&
    stored.method === attempt.method;
  return same ? 'replay' : 'different-payment';
}

export function expectedAmountMinor(premiumMinor: number, feeMinor: number): number {
  return premiumMinor + feeMinor;
}

export function isQuoteExpired(validUntil: Date, now: Date): boolean {
  return validUntil <= now;
}

/** Only the last four digits of a wallet number are kept. */
export function providerReference(mobileNumber: string | undefined): string | null {
  return mobileNumber ? `MM-${mobileNumber.slice(-4)}` : null;
}
