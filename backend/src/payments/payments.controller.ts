import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentsService } from './payments.service.js';
import { PayDto } from './dto/payment.dto.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  private scope(principal: Principal): string {
    if (principal.kind !== 'customer') {
      throw ApiException.forbidden('Only a customer can pay for their own quote.');
    }
    return principal.id;
  }

  /**
   * Pays for an accepted quote and creates the policy awaiting the insurer's
   * certificate.
   *
   * `Idempotency-Key` makes a retry safe: the same key returns the original
   * receipt rather than charging again. A client that omits it still cannot be
   * charged twice for one request — the second attempt is refused as already
   * paid — but it loses the ability to retry a lost response.
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  pay(
    @Body() dto: PayDto,
    @CurrentUser() principal: Principal,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.payments.pay(this.scope(principal), idempotencyKey?.trim() || randomUUID(), dto);
  }

  @Get(':transactionId')
  status(@Param('transactionId') transactionId: string, @CurrentUser() principal: Principal) {
    return this.payments.status(this.scope(principal), transactionId);
  }
}
