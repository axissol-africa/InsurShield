import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiException } from '../../common/errors/api.exception.js';
import type { Env } from '../../config/env.js';
import {
  PAYMENT_EVENT_TYPES,
  type InitiateResult,
  type PaymentEvent,
  type PaymentEventType,
  type PaymentInstruction,
  type PaymentProvider,
  type RefundInstruction,
  type RefundResult,
  type StatusResult,
} from './payment-provider.js';

const CALLBACK_MAX_AGE_MS = 5 * 60_000;
export const STAND_IN_TIMESTAMP_HEADER = 'x-stand-in-timestamp';
export const STAND_IN_SIGNATURE_HEADER = 'x-stand-in-signature';
const STAND_IN_REFUND_PREFIX = 'SIRF-';

/**
 * How the stand-in behaves, chosen by the last four digits of the wallet. Any
 * other wallet confirms, so a demonstration with a real-looking number works.
 * A card attempt waits on the stand-in checkout page.
 */
export const STAND_IN_WALLETS = {
  '0001': 'confirms',
  '0002': 'is declined',
  '0003': 'stays pending until it expires',
  '0004': 'confirms, and can then be reversed',
} as const;

type Outcome = 'C' | 'F' | 'P' | 'R' | 'K';

function outcomeFor(instruction: PaymentInstruction): Outcome {
  if (instruction.method === 'CARD') return 'K';
  switch (instruction.msisdn?.replace(/\D/g, '').slice(-4)) {
    case '0002':
      return 'F';
    case '0003':
      return 'P';
    case '0004':
      return 'R';
    default:
      return 'C';
  }
}

/** The stand-in keeps no state: what it decided, and the amount, travel in its own payment id. */
function parse(providerPaymentId: string): { outcome: Outcome; amountMinor: number; paymentId: string } | null {
  const match = /^SI-([CFPRK])-(\d{1,15})-([0-9a-f-]{36})$/.exec(providerPaymentId);
  return match ? { outcome: match[1] as Outcome, amountMinor: Number(match[2]), paymentId: match[3] } : null;
}

export interface SignedStandInEvent {
  rawBody: Buffer;
  headers: Record<string, string>;
}

/**
 * A payment provider for development and tests. It answers like a provider
 * would, and signs its callbacks with the configured secret so they go through
 * the same verification a live provider's will. Production refuses it.
 */
@Injectable()
export class StandInPaymentProvider implements PaymentProvider {
  readonly name = 'STAND_IN' as const;
  readonly route = 'stand-in';
  private readonly secrets: string[];

  constructor(private readonly config: ConfigService<Env, true>) {
    const current = config.get('PAYMENT_CALLBACK_SECRET', { infer: true }) ?? randomBytes(32).toString('hex');
    const previous = config.get('PAYMENT_CALLBACK_SECRET_PREVIOUS', { infer: true });
    this.secrets = previous ? [current, previous] : [current];
  }

  async initiate(instruction: PaymentInstruction): Promise<InitiateResult> {
    const outcome = outcomeFor(instruction);
    const providerPaymentId = `SI-${outcome}-${instruction.amountMinor}-${instruction.paymentId}`;
    return {
      outcome: 'ACCEPTED',
      providerPaymentId,
      checkoutUrl: outcome === 'K' ? this.checkoutUrl(providerPaymentId, instruction.returnUrl) : null,
    };
  }

  async status(ref: { providerPaymentId: string | null }): Promise<StatusResult> {
    const parsed = ref.providerPaymentId ? parse(ref.providerPaymentId) : null;
    if (!parsed) return { status: 'NOT_FOUND', amountMinor: null, currency: null, reference: null, reason: null };
    switch (parsed.outcome) {
      case 'C':
      case 'R':
        return { status: 'CONFIRMED', amountMinor: parsed.amountMinor, currency: 'ZMW', reference: `SIR-${ref.providerPaymentId}`, reason: null };
      case 'F':
        return { status: 'FAILED', amountMinor: null, currency: null, reference: null, reason: 'The wallet declined the payment.' };
      default:
        return { status: 'PENDING', amountMinor: null, currency: null, reference: null, reason: null };
    }
  }

  async cancel(ref: { providerPaymentId: string | null; paymentId: string }): Promise<StatusResult> {
    const current = await this.status(ref);
    // Too late to stop one that already settled; anything still waiting stops.
    return current.status === 'PENDING' ? { ...current, status: 'CANCELLED' } : current;
  }

  /** A refund is accepted at once and completes when asked about, or when a refund event is emitted for it. */
  async refund(instruction: RefundInstruction): Promise<RefundResult> {
    return { providerRefundId: `${STAND_IN_REFUND_PREFIX}${instruction.refundId}`, status: 'SUBMITTED' };
  }

  async refundStatus(ref: { providerRefundId: string }) {
    return ref.providerRefundId.startsWith(STAND_IN_REFUND_PREFIX)
      ? { status: 'COMPLETED' as const, reason: null }
      : { status: 'NOT_FOUND' as const, reason: null };
  }

  verifyCallback(rawBody: Buffer, headers: Readonly<Record<string, string | undefined>>, now = new Date()): PaymentEvent {
    const timestamp = headers[STAND_IN_TIMESTAMP_HEADER]?.trim();
    const signature = headers[STAND_IN_SIGNATURE_HEADER]?.trim();
    if (!timestamp || !signature || !/^\d{10}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) throw invalidSignature();
    const presented = Buffer.from(signature, 'hex');
    const verified = this.secrets.some((secret) => timingSafeEqual(presented, this.mac(secret, timestamp, rawBody)));
    if (!verified) throw invalidSignature();
    if (Math.abs(now.getTime() - Number(timestamp) * 1_000) > CALLBACK_MAX_AGE_MS) {
      throw new ApiException('STALE_CALLBACK', 'This payment callback has expired.', 401);
    }
    return toEvent(rawBody);
  }

  /** A callback as the stand-in would send it, signed with the current secret. */
  sign(event: PaymentEvent, now = new Date()): SignedStandInEvent {
    const rawBody = Buffer.from(
      JSON.stringify({
        id: event.eventId,
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
        data: {
          providerPaymentId: event.providerPaymentId,
          amountMinor: event.amountMinor,
          currency: event.currency,
          reference: event.reference,
          reason: event.reason,
          providerRefundId: event.providerRefundId ?? null,
        },
      }),
    );
    const timestamp = String(Math.floor(now.getTime() / 1_000));
    return {
      rawBody,
      headers: {
        'content-type': 'application/json',
        [STAND_IN_TIMESTAMP_HEADER]: timestamp,
        [STAND_IN_SIGNATURE_HEADER]: this.mac(this.secrets[0], timestamp, rawBody).toString('hex'),
      },
    };
  }

  /** The amount the stand-in charged for one of its payment ids, for an event it is asked to emit. */
  chargedAmount(providerPaymentId: string): number | null {
    return parse(providerPaymentId)?.amountMinor ?? null;
  }

  private mac(secret: string, timestamp: string, rawBody: Buffer): Buffer {
    return createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  }

  private checkoutUrl(providerPaymentId: string, returnUrl: string | undefined): string {
    const origin = this.config.get('BETTER_AUTH_URL', { infer: true }).replace(/\/$/, '');
    const prefix = this.config.get('API_PREFIX', { infer: true });
    const url = new URL(`${origin}/${prefix}/dev/payment-provider/checkout/${encodeURIComponent(providerPaymentId)}`);
    if (returnUrl) url.searchParams.set('returnUrl', returnUrl);
    return url.toString();
  }
}

function toEvent(rawBody: Buffer): PaymentEvent {
  let body: unknown;
  try {
    body = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw invalidCallback();
  }
  if (!isRecord(body) || !isRecord(body.data)) throw invalidCallback();
  const { id, type, occurredAt, data } = body;
  if (typeof id !== 'string' || id.length < 1 || id.length > 200) throw invalidCallback();
  if (typeof type !== 'string' || !(PAYMENT_EVENT_TYPES as readonly string[]).includes(type)) throw invalidCallback();
  if (typeof data.providerPaymentId !== 'string' || data.providerPaymentId.length > 200) throw invalidCallback();
  const occurred = typeof occurredAt === 'string' ? new Date(occurredAt) : null;
  if (!occurred || Number.isNaN(occurred.getTime())) throw invalidCallback();
  const amountMinor = data.amountMinor;
  if (amountMinor !== null && amountMinor !== undefined && !(Number.isSafeInteger(amountMinor) && (amountMinor as number) >= 0)) {
    throw invalidCallback();
  }
  return {
    eventId: id,
    type: type as PaymentEventType,
    providerPaymentId: data.providerPaymentId,
    paymentId: parse(data.providerPaymentId)?.paymentId ?? null,
    amountMinor: typeof amountMinor === 'number' ? amountMinor : null,
    currency: typeof data.currency === 'string' ? data.currency.slice(0, 3) : null,
    reference: typeof data.reference === 'string' ? data.reference.slice(0, 200) : null,
    reason: typeof data.reason === 'string' ? data.reason.slice(0, 300) : null,
    providerRefundId: typeof data.providerRefundId === 'string' ? data.providerRefundId.slice(0, 200) : null,
    occurredAt: occurred,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function invalidSignature(): ApiException {
  return new ApiException('INVALID_CALLBACK_SIGNATURE', 'This payment callback could not be verified.', 401);
}

function invalidCallback(): ApiException {
  return new ApiException('INVALID_CALLBACK', 'This payment callback is not in the expected format.', 400);
}
