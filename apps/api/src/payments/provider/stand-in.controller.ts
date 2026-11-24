import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Public } from '../../common/auth/auth.guard.js';
import { ApiException } from '../../common/errors/api.exception.js';
import type { Env } from '../../config/env.js';
import { PaymentEventsService } from '../payment-events.service.js';
import { PAYMENT_EVENT_TYPES, PAYMENT_PROVIDER, type PaymentEventType, type PaymentProvider } from './payment-provider.js';
import { StandInPaymentProvider } from './stand-in-payment-provider.js';

export class StandInEventDto {
  @IsString() @MaxLength(200) providerPaymentId!: string;
  @IsIn(PAYMENT_EVENT_TYPES) type!: PaymentEventType;
  /** Defaults to what the stand-in charged; set it to test a mismatch. */
  @IsOptional() @IsInt() @Min(0) amountMinor?: number;
  /** Refund events: which refund. */
  @IsOptional() @IsString() @MaxLength(200) providerRefundId?: string;
}

export class StandInCheckoutDto {
  @IsIn(['pay', 'decline']) outcome!: 'pay' | 'decline';
  @IsOptional() @IsString() @MaxLength(500) returnUrl?: string;
}

/**
 * The stand-in provider's side of the world, for development and tests only:
 * an endpoint that makes it send a signed callback, and the card checkout page
 * a customer is sent to. Every route answers as absent in production, which
 * also refuses to start with the stand-in at all.
 */
@Controller('dev/payment-provider')
export class StandInPaymentController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly events: PaymentEventsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private standIn(): StandInPaymentProvider {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production' || !(this.provider instanceof StandInPaymentProvider)) {
      throw ApiException.notFound('Route', 'dev/payment-provider');
    }
    return this.provider;
  }

  /** Makes the stand-in send one signed event through the real callback path. */
  @Public()
  @Post('events')
  @HttpCode(HttpStatus.OK)
  emit(@Body() dto: StandInEventDto) {
    return this.send(dto.providerPaymentId, dto.type, dto.amountMinor, dto.providerRefundId);
  }

  private send(providerPaymentId: string, type: PaymentEventType, amountMinor?: number, providerRefundId?: string) {
    const standIn = this.standIn();
    const signed = standIn.sign({
      eventId: `SIE-${randomUUID()}`,
      type,
      providerPaymentId,
      paymentId: null,
      amountMinor: amountMinor ?? standIn.chargedAmount(providerPaymentId),
      currency: 'ZMW',
      reference: type === 'payment.confirmed' ? `SIR-${providerPaymentId.slice(-12)}` : null,
      reason: type === 'payment.failed' ? 'Declined on the stand-in checkout.' : type === 'refund.failed' ? 'The stand-in refused the refund.' : null,
      providerRefundId: providerRefundId ?? null,
      occurredAt: new Date(),
    });
    return this.events.receiveCallback(standIn.route, signed.rawBody, signed.headers);
  }

  @Public()
  @Get('checkout/:providerPaymentId')
  checkout(@Param('providerPaymentId') providerPaymentId: string, @Query('returnUrl') returnUrl: string | undefined, @Res() response: Response) {
    const standIn = this.standIn();
    const amount = standIn.chargedAmount(providerPaymentId);
    if (amount === null) throw ApiException.notFound('Checkout', providerPaymentId);
    const kwacha = (amount / 100).toLocaleString('en-ZM', { minimumFractionDigits: 2 });
    const back = escapeHtml(this.allowedReturn(returnUrl) ?? '');
    response
      .status(200)
      .type('html')
      .set('Cache-Control', 'no-store')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stand-in card checkout</title>
<style>body{font-family:system-ui,sans-serif;max-width:28rem;margin:3rem auto;padding:0 1rem;color:#111}button{font:inherit;padding:.6rem 1rem;margin-right:.5rem;border-radius:.4rem;border:1px solid #333;cursor:pointer}.pay{background:#0b6b3a;color:#fff;border-color:#0b6b3a}</style></head>
<body><h1>Stand-in card checkout</h1><p>This page stands in for a card provider in development. No card details are asked for and no money moves.</p>
<p>Amount: <strong>ZMW ${kwacha}</strong></p>
<form method="post"><input type="hidden" name="returnUrl" value="${back}">
<button class="pay" name="outcome" value="pay">Pay</button><button name="outcome" value="decline">Decline</button></form></body></html>`);
  }

  @Public()
  @Post('checkout/:providerPaymentId')
  async finishCheckout(@Param('providerPaymentId') providerPaymentId: string, @Body() dto: StandInCheckoutDto, @Res() response: Response) {
    await this.send(providerPaymentId, dto.outcome === 'pay' ? 'payment.confirmed' : 'payment.failed');
    const back = this.allowedReturn(dto.returnUrl);
    if (back) {
      response.redirect(303, back);
      return;
    }
    response.status(200).type('text').send('Done. You can close this page.');
  }

  /** Only back to InsurShield's own web origins, never to an address someone put in the link. */
  private allowedReturn(returnUrl: string | undefined): string | null {
    if (!returnUrl) return null;
    try {
      const url = new URL(returnUrl);
      return this.config.get('CORS_ORIGINS', { infer: true }).includes(url.origin) ? url.toString() : null;
    } catch {
      return null;
    }
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}
