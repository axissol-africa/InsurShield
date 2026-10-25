import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentsService } from './payments.service.js';
import { PayDto } from './dto/payment.dto.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

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
    return this.payments.pay(this.scope(principal), this.idempotencyKey(idempotencyKey), dto);
  }

  /** A key longer than this could not be indexed; a header sent empty is a client fault, not a request without a key. */
  private idempotencyKey(header: string | undefined): string {
    if (header === undefined) return randomUUID();
    const key = header.trim();
    if (key.length === 0 || key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new ApiException(
        'VALIDATION_FAILED',
        `The payment key must be 1 to ${MAX_IDEMPOTENCY_KEY_LENGTH} characters long.`,
      );
    }
    return key;
  }

  @Get(':transactionId')
  status(@Param('transactionId') transactionId: string, @CurrentUser() principal: Principal) {
    return this.payments.status(this.scope(principal), transactionId);
  }
}
