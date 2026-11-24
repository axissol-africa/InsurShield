import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Needs, Public } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import type { CustomerPrincipal } from '../customer/customer-principal.js';
import { PayDto } from './dto/payment.dto.js';
import { PaymentEventsService } from './payment-events.service.js';
import { PaymentsService } from './payments.service.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly events: PaymentEventsService,
  ) {}

  private scope(principal: Principal): CustomerPrincipal {
    if (principal.kind !== 'customer') {
      throw ApiException.forbidden('Only a customer can pay for their own quote.');
    }
    return principal;
  }

  /**
   * Starts a payment for an accepted quote and answers with its status. It is
   * never a receipt: the provider confirms the money later.
   *
   * `Idempotency-Key` is required, so a retry after a lost response finds the
   * attempt it started rather than starting a second one.
   */
  @Needs('payment:make')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  pay(@Body() dto: PayDto, @CurrentUser() principal: Principal, @Headers('idempotency-key') idempotencyKey?: string) {
    return this.payments.initiate(this.scope(principal), this.idempotencyKey(idempotencyKey), dto);
  }

  private idempotencyKey(header: string | undefined): string {
    const key = header?.trim() ?? '';
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new ApiException(
        'VALIDATION_FAILED',
        `Send an Idempotency-Key header of 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters, so a retry cannot pay twice.`,
      );
    }
    return key;
  }

  /**
   * A provider has no browser session. Its signature over the raw body is the
   * credential, and each event id is applied once.
   */
  @Public()
  @Post('callbacks/:provider')
  @HttpCode(HttpStatus.OK)
  @ApiRateLimit(API_LIMITS.integrationCallback)
  callback(@Param('provider') provider: string, @Req() request: RawBodyRequest<Request>) {
    return this.events.receiveCallback(provider, request.rawBody, headersOf(request));
  }

  @Needs('payment:read')
  @Get(':transactionId')
  status(@Param('transactionId') transactionId: string, @CurrentUser() principal: Principal) {
    return this.payments.status(this.scope(principal).id, transactionId);
  }

  @Needs('payment:make')
  @Post(':transactionId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('transactionId') transactionId: string, @CurrentUser() principal: Principal) {
    return this.payments.cancel(this.scope(principal), transactionId);
  }
}

function headersOf(request: Request): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.headers)) headers[name] = Array.isArray(value) ? value[0] : value;
  return headers;
}
