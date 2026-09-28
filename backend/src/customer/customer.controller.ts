import { Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CustomerService } from './customer.service.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';

/**
 * A customer's own records.
 *
 * Every route is scoped to the customer on the token. Staff have their own
 * endpoints; a staff token here is refused rather than silently returning
 * nothing, so the failure is obvious instead of looking like an empty account.
 */
@Controller()
export class CustomerController {
  constructor(private readonly customer: CustomerService) {}

  private scope(principal: Principal): string {
    if (principal.kind !== 'customer') {
      throw ApiException.forbidden('This endpoint is for customer accounts.');
    }
    return principal.id;
  }

  // ── Quote requests ──────────────────────────────────────────────

  @Get('quote-requests')
  listQuoteRequests(@CurrentUser() principal: Principal) {
    return this.customer.listQuoteRequests(this.scope(principal));
  }

  @Get('quote-requests/:id')
  getQuoteRequest(@Param('id') id: string, @CurrentUser() principal: Principal) {
    return this.customer.getQuoteRequest(this.scope(principal), id);
  }

  @Post('quote-requests/:id/requote')
  @HttpCode(HttpStatus.CREATED)
  requote(@Param('id') id: string, @CurrentUser() principal: Principal) {
    return this.customer.requote(this.scope(principal), id);
  }

  // ── Policies ────────────────────────────────────────────────────

  @Get('policies')
  listPolicies(@CurrentUser() principal: Principal) {
    return this.customer.listPolicies(this.scope(principal));
  }

  @Get('policies/:policyNumber')
  getPolicy(@Param('policyNumber') policyNumber: string, @CurrentUser() principal: Principal) {
    return this.customer.getPolicy(this.scope(principal), policyNumber);
  }

  /** Starts a renewal: a new quote request carrying this policy's cover forward. */
  @Post('policies/:policyNumber/renew')
  @HttpCode(HttpStatus.CREATED)
  renewPolicy(@Param('policyNumber') policyNumber: string, @CurrentUser() principal: Principal) {
    return this.customer.renewPolicy(this.scope(principal), policyNumber);
  }

  // ── Claims and NCD ──────────────────────────────────────────────

  @Get('claims')
  listClaims(@CurrentUser() principal: Principal) {
    return this.customer.listClaims(this.scope(principal));
  }

  @Get('ncd/applications')
  listNcdApplications(@CurrentUser() principal: Principal) {
    return this.customer.listNcdApplications(this.scope(principal));
  }

  // ── Account ─────────────────────────────────────────────────────

  /** Closes the account. Refused while an active policy is in force. */
  @Delete('account')
  @HttpCode(HttpStatus.OK)
  closeAccount(@CurrentUser() principal: Principal) {
    return this.customer.closeAccount(this.scope(principal));
  }
}
