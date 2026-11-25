import type { PaymentMethod, PaymentProviderName } from '../../common/domain/enums.js';

/** Nest injection token for the configured payment provider. */
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** What InsurShield asks the provider to collect. Card details never pass through here. */
export interface PaymentInstruction {
  /** Our own payment id, which the provider keeps as its merchant reference. */
  paymentId: string;
  amountMinor: number;
  currency: string;
  method: PaymentMethod;
  /** Mobile money only: the wallet that receives the approval prompt. */
  msisdn?: string;
  /** Card only: where the provider's checkout sends the customer back. */
  returnUrl?: string;
  idempotencyKey: string;
  description: string;
}

export type InitiateResult =
  | { outcome: 'ACCEPTED'; providerPaymentId: string; checkoutUrl: string | null }
  | { outcome: 'REFUSED'; code: string; reason: string };

/** NOT_FOUND: the provider never received the instruction. */
export type ProviderPaymentStatus = 'PENDING' | 'CONFIRMED' | 'FAILED' | 'CANCELLED' | 'NOT_FOUND';

export interface StatusResult {
  status: ProviderPaymentStatus;
  amountMinor: number | null;
  currency: string | null;
  reference: string | null;
  reason: string | null;
}

export interface RefundInstruction {
  providerPaymentId: string;
  refundId: string;
  amountMinor: number;
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  status: 'SUBMITTED' | 'COMPLETED' | 'FAILED';
}

export const PAYMENT_EVENT_TYPES = [
  'payment.confirmed',
  'payment.failed',
  'payment.cancelled',
  'payment.reversed',
  'refund.completed',
  'refund.failed',
] as const;
export type PaymentEventType = (typeof PAYMENT_EVENT_TYPES)[number];

/** A verified provider event, in InsurShield's own terms. */
export interface PaymentEvent {
  eventId: string;
  type: PaymentEventType;
  providerPaymentId: string;
  /** Our payment id as the provider echoes it, so an event that arrives before we stored its id still finds its payment. */
  paymentId: string | null;
  amountMinor: number | null;
  currency: string | null;
  /** The provider's receipt or reversal reference. */
  reference: string | null;
  /** Refund events only: the provider's id for the refund. */
  providerRefundId?: string | null;
  reason: string | null;
  occurredAt: Date;
}

/** The provider could not be reached or did not answer in time; the outcome is unknown. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

/**
 * One payment provider, provider-neutral. A live adapter calls its provider
 * through the endpoint safety helper with a base URL from configuration; the
 * stand-in calls nothing.
 */
export interface PaymentProvider {
  readonly name: PaymentProviderName;
  /** The path segment its callbacks arrive on: /payments/callbacks/:route. */
  readonly route: string;
  initiate(instruction: PaymentInstruction): Promise<InitiateResult>;
  /** By the provider's id when it gave one, otherwise by our payment id. */
  status(ref: { providerPaymentId: string | null; paymentId: string }): Promise<StatusResult>;
  /** Asks the provider to stop an attempt; the answer is the attempt's status afterwards. */
  cancel(ref: { providerPaymentId: string | null; paymentId: string }): Promise<StatusResult>;
  refund(instruction: RefundInstruction): Promise<RefundResult>;
  /** Where a refund stands, for one whose callback has not come. */
  refundStatus(ref: { providerRefundId: string }): Promise<{ status: 'SUBMITTED' | 'COMPLETED' | 'FAILED' | 'NOT_FOUND'; reason: string | null }>;
  /** Checks the signature on the raw body before reading anything in it; throws when it does not verify. */
  verifyCallback(rawBody: Buffer, headers: Readonly<Record<string, string | undefined>>, now?: Date): PaymentEvent;
}
