import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { InsurerPortalService } from './insurer-portal.service.js';
import { InsurersService } from '../insurers/insurers.service.js';
import {
  AcknowledgeClaimDto,
  ExtendQuoteDto,
  IssueCertificateDto,
  NcdDecisionDto,
  SubmitQuoteDto,
} from './dto/portal.dto.js';
import { Roles } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';

/**
 * The insurer portal.
 *
 * Every route is restricted to INSURER_USER and scoped to the insurer on the
 * caller's own staff record. No endpoint takes an insurer id from the request,
 * so the scope cannot be widened by anything a client sends.
 */
@Roles('INSURER_USER')
@Controller('insurer')
export class InsurerPortalController {
  constructor(
    private readonly portal: InsurerPortalService,
    private readonly insurers: InsurersService,
  ) {}

  /** The insurer this caller acts for, or a refusal if the account has none. */
  private scope(principal: Principal): string {
    if (principal.kind !== 'staff' || !principal.insurerId) {
      throw ApiException.forbidden('This account is not linked to an insurer.');
    }
    return principal.insurerId;
  }

  // ── This insurer ────────────────────────────────────────────────

  /**
   * The caller's own insurer record. The portal needs its rate, quote validity
   * and NCD setting to show an indicative premium beside the field where the
   * underwriter types the real one.
   */
  @Get('profile')
  profile(@CurrentUser() principal: Principal) {
    return this.insurers.profile(this.scope(principal));
  }

  // ── Quote requests ──────────────────────────────────────────────

  @Get('quote-requests')
  listQuoteRequests(@CurrentUser() principal: Principal) {
    return this.portal.listQuoteRequests(this.scope(principal));
  }

  @Post('quote-requests/:id/quote')
  @HttpCode(HttpStatus.CREATED)
  submitQuote(
    @Param('id') id: string,
    @Body() dto: SubmitQuoteDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.submitQuote(this.scope(principal), id, dto);
  }

  @Post('quote-requests/:id/extend')
  @HttpCode(HttpStatus.OK)
  extendQuote(
    @Param('id') id: string,
    @Body() dto: ExtendQuoteDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.extendQuote(this.scope(principal), id, dto);
  }

  // ── Paid policies ───────────────────────────────────────────────

  @Get('policies')
  listPolicies(@CurrentUser() principal: Principal) {
    return this.portal.listPolicies(this.scope(principal));
  }

  @Post('policies/:policyNumber/certificate')
  @HttpCode(HttpStatus.OK)
  issueCertificate(
    @Param('policyNumber') policyNumber: string,
    @Body() dto: IssueCertificateDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.issueCertificate(this.scope(principal), policyNumber, dto);
  }

  // ── Claims ──────────────────────────────────────────────────────

  @Get('claims')
  listClaims(@CurrentUser() principal: Principal) {
    return this.portal.listClaims(this.scope(principal));
  }

  @Post('claims/:claimNumber/received')
  @HttpCode(HttpStatus.OK)
  acknowledgeClaim(
    @Param('claimNumber') claimNumber: string,
    @Body() dto: AcknowledgeClaimDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.acknowledgeClaim(this.scope(principal), claimNumber, dto);
  }

  // ── No-claim discount ───────────────────────────────────────────

  @Get('ncd/applications')
  listNcdApplications(@CurrentUser() principal: Principal) {
    return this.portal.listNcdApplications(this.scope(principal));
  }

  @Post('ncd/applications/:id/decision')
  @HttpCode(HttpStatus.OK)
  decideNcdApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NcdDecisionDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.decideNcdApplication(this.scope(principal), id, dto);
  }
}
