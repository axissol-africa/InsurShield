import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { PaymentEvent, PaymentInstruction } from './payment-provider.js';
import { StandInPaymentProvider, STAND_IN_SIGNATURE_HEADER, STAND_IN_TIMESTAMP_HEADER } from './stand-in-payment-provider.js';

const CURRENT = 'c'.repeat(40);
const PREVIOUS = 'p'.repeat(40);

function standIn(values: Record<string, unknown> = {}) {
  return new StandInPaymentProvider(
    new ConfigService({
      PAYMENT_CALLBACK_SECRET: CURRENT,
      BETTER_AUTH_URL: 'http://localhost:4000',
      API_PREFIX: 'api/v1',
      ...values,
    }),
  );
}

const instruction = (overrides: Partial<PaymentInstruction> = {}): PaymentInstruction => ({
  paymentId: randomUUID(),
  amountMinor: 123_400,
  currency: 'ZMW',
  method: 'MOBILE_MONEY',
  msisdn: '+260970000001',
  idempotencyKey: 'key',
  description: 'test',
  ...overrides,
});

const event = (providerPaymentId: string): PaymentEvent => ({
  eventId: 'SIE-1',
  type: 'payment.confirmed',
  providerPaymentId,
  paymentId: null,
  amountMinor: 123_400,
  currency: 'ZMW',
  reference: 'R-1',
  reason: null,
  occurredAt: new Date('2026-11-24T10:00:00.000Z'),
});

describe('the stand-in payment provider', () => {
  it.each([
    ['+260970000001', 'CONFIRMED'],
    ['+260970000002', 'FAILED'],
    ['+260970000003', 'PENDING'],
    ['+260970000004', 'CONFIRMED'],
    ['+260971234567', 'CONFIRMED'],
  ])('answers for wallet %s with %s', async (msisdn, status) => {
    const provider = standIn();
    const started = await provider.initiate(instruction({ msisdn }));
    expect(started).toMatchObject({ outcome: 'ACCEPTED', checkoutUrl: null });
    if (started.outcome !== 'ACCEPTED') return;
    expect((await provider.status({ providerPaymentId: started.providerPaymentId })).status).toBe(status);
  });

  it('sends a card payment to its checkout page and keeps it pending until then', async () => {
    const provider = standIn();
    const started = await provider.initiate(instruction({ method: 'CARD', msisdn: undefined, returnUrl: 'http://localhost:5173/payment/return' }));
    if (started.outcome !== 'ACCEPTED') throw new Error('refused');
    expect(started.checkoutUrl).toMatch(/^http:\/\/localhost:4000\/api\/v1\/dev\/payment-provider\/checkout\/SI-K-123400-/);
    expect(started.checkoutUrl).toContain('returnUrl=http%3A%2F%2Flocalhost%3A5173%2Fpayment%2Freturn');
    expect((await provider.status({ providerPaymentId: started.providerPaymentId })).status).toBe('PENDING');
    expect((await provider.cancel({ providerPaymentId: started.providerPaymentId, paymentId: 'x' })).status).toBe('CANCELLED');
  });

  it('knows nothing of a payment it never received', async () => {
    expect((await standIn().status({ providerPaymentId: null })).status).toBe('NOT_FOUND');
  });

  it('verifies its own signed callback and reads our payment id from it', () => {
    const provider = standIn();
    const paymentId = randomUUID();
    const signed = provider.sign(event(`SI-C-123400-${paymentId}`));
    expect(provider.verifyCallback(signed.rawBody, signed.headers)).toMatchObject({ type: 'payment.confirmed', amountMinor: 123_400, paymentId });
  });

  it('accepts the previous secret during a rotation, and refuses an unknown one', () => {
    const old = standIn({ PAYMENT_CALLBACK_SECRET: PREVIOUS });
    const signed = old.sign(event('SI-C-1-x'));
    expect(() => standIn({ PAYMENT_CALLBACK_SECRET_PREVIOUS: PREVIOUS }).verifyCallback(signed.rawBody, signed.headers)).not.toThrow();
    expect(() => standIn().verifyCallback(signed.rawBody, signed.headers)).toThrow(expect.objectContaining({ code: 'INVALID_CALLBACK_SIGNATURE' }));
  });

  it('refuses a changed body, a missing signature and a stale timestamp', () => {
    const provider = standIn();
    const signed = provider.sign(event('SI-C-1-x'), new Date('2026-11-24T10:00:00.000Z'));
    const tampered = Buffer.from(signed.rawBody.toString().replace('123400', '1'));
    expect(() => provider.verifyCallback(tampered, signed.headers, new Date('2026-11-24T10:00:00.000Z'))).toThrow(
      expect.objectContaining({ code: 'INVALID_CALLBACK_SIGNATURE' }),
    );
    expect(() => provider.verifyCallback(signed.rawBody, { ...signed.headers, [STAND_IN_SIGNATURE_HEADER]: undefined })).toThrow(
      expect.objectContaining({ code: 'INVALID_CALLBACK_SIGNATURE' }),
    );
    expect(() => provider.verifyCallback(signed.rawBody, signed.headers, new Date('2026-11-24T10:06:00.000Z'))).toThrow(
      expect.objectContaining({ code: 'STALE_CALLBACK' }),
    );
    expect(signed.headers[STAND_IN_TIMESTAMP_HEADER]).toBe('1795514400');
  });
});
