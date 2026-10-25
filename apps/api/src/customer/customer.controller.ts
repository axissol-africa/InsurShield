import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Public } from '../common/auth/auth.guard.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';
import { AccountService } from './account.service.js';
import { ClaimsService } from './claims.service.js';
import type { CustomerPrincipal } from './customer-principal.js';
import {
  ApplyForNcdDto,
  NotifyClaimDto,
  SubmitQuoteRequestDto,
  ValidateNcdCodeDto,
} from './dto/customer.dto.js';
import { NcdService } from './ncd.service.js';
import { PoliciesService } from './policies.service.js';
import { QuoteRequestsService } from './quote-requests.service.js';

/**
 * A customer's own records.
 *
 * Every route is scoped to the customer on the token. Staff have their own
 * endpoints; a staff token here is refused rather than silently returning
 * nothing, so the failure is obvious instead of looking like an empty account.
 */
@Controller()
export class CustomerController {
  constructor(
    private readonly quoteRequests: QuoteRequestsService,
    private readonly policies: PoliciesService,
    private readonly claims: ClaimsService,
    private readonly ncd: NcdService,
    private readonly account: AccountService,
  ) {}

  private scope(principal: Principal): CustomerPrincipal {
    if (principal.kind !== 'customer') {
      throw ApiException.forbidden('This endpoint is for customer accounts.');
    }
    return principal;
  }

  // ── Quote requests ──────────────────────────────────────────────

  @Get('quote-requests')
  listQuoteRequests(@CurrentUser() principal: Principal) {
    return this.quoteRequests.list(this.scope(principal).id);
  }

  /** Sends one request to every active insurer at once. */
  @Post('quote-requests')
  @HttpCode(HttpStatus.CREATED)
  submitQuoteRequest(@Body() dto: SubmitQuoteRequestDto, @CurrentUser() principal: Principal) {
    return this.quoteRequests.submit(this.scope(principal), dto);
  }

  @Get('quote-requests/:id')
  getQuoteRequest(@Param('id') id: string, @CurrentUser() principal: Principal) {
    return this.quoteRequests.get(this.scope(principal).id, id);
  }

  @Post('quote-requests/:id/requote')
  @HttpCode(HttpStatus.CREATED)
  requote(@Param('id') id: string, @CurrentUser() principal: Principal) {
    return this.quoteRequests.requote(this.scope(principal).id, id);
  }

  // ── Policies ────────────────────────────────────────────────────

  @Get('policies')
  listPolicies(@CurrentUser() principal: Principal) {
    return this.policies.list(this.scope(principal).id);
  }

  @Get('policies/:policyNumber')
  getPolicy(@Param('policyNumber') policyNumber: string, @CurrentUser() principal: Principal) {
    return this.policies.get(this.scope(principal).id, policyNumber);
  }

  /** Starts a renewal: a new quote request carrying this policy's cover forward. */
  @Post('policies/:policyNumber/renew')
  @HttpCode(HttpStatus.CREATED)
  renewPolicy(@Param('policyNumber') policyNumber: string, @CurrentUser() principal: Principal) {
    return this.policies.renew(this.scope(principal).id, policyNumber);
  }

  // ── Claims and NCD ──────────────────────────────────────────────

  @Get('claims')
  listClaims(@CurrentUser() principal: Principal) {
    return this.claims.list(this.scope(principal).id);
  }

  /** First notification: issues the claim number the customer quotes by phone. */
  @Post('claims')
  @HttpCode(HttpStatus.CREATED)
  notifyClaim(@Body() dto: NotifyClaimDto, @CurrentUser() principal: Principal) {
    return this.claims.notify(this.scope(principal), dto);
  }

  @Get('ncd/applications')
  listNcdApplications(@CurrentUser() principal: Principal) {
    return this.ncd.list(this.scope(principal).id);
  }

  @Post('ncd/applications')
  @HttpCode(HttpStatus.CREATED)
  applyForNcd(@Body() dto: ApplyForNcdDto, @CurrentUser() principal: Principal) {
    return this.ncd.apply(this.scope(principal).id, dto);
  }

  /**
   * Checks a discount code before it is applied to a quote. Public: the code
   * is the secret, and a customer may check one before signing in.
   */
  @Public()
  @Post('ncd/codes/validate')
  @HttpCode(HttpStatus.OK)
  validateNcdCode(@Body() dto: ValidateNcdCodeDto) {
    return this.ncd.validateCode(dto);
  }

  // ── Account ─────────────────────────────────────────────────────

  /** Closes the account. Refused while an active policy is in force. */
  @Delete('account')
  @HttpCode(HttpStatus.OK)
  closeAccount(@CurrentUser() principal: Principal) {
    return this.account.close(this.scope(principal).id);
  }
}
