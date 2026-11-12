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
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';

/**
 * The insurer portal.
 *
 * Every route is restricted to INSURER_USER and scoped to the insurer on the
 * caller's own staff record. No endpoint takes an insurer id from the request,
 * so the scope cannot be widened by anything a client sends.
 */
@Controller('insurer')
export class InsurerPortalController {
  constructor(
    private readonly portal: InsurerPortalService,
    private readonly insurers: InsurersService,
  ) {}

  // ── This insurer ────────────────────────────────────────────────

  /**
   * The caller's own insurer record. The portal needs its rate, quote validity
   * and NCD setting to show an indicative premium beside the field where the
   * underwriter types the real one.
   */
  @Needs('portal:profile:read')
  @Get('profile')
  profile(@CurrentUser() principal: Principal) {
    return this.insurers.profile(this.portal.staffOf(principal));
  }

  // ── Quote requests ──────────────────────────────────────────────

  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('portal:request:read')
  @Get('quote-requests')
  listQuoteRequests(@CurrentUser() principal: Principal) {
    return this.portal.listQuoteRequests(principal);
  }

  @Needs('portal:quote:send')
  @Post('quote-requests/:id/quote')
  @HttpCode(HttpStatus.CREATED)
  submitQuote(
    @Param('id') id: string,
    @Body() dto: SubmitQuoteDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.submitQuote(principal, id, dto);
  }

  @Needs('portal:quote:extend')
  @Post('quote-requests/:id/extend')
  @HttpCode(HttpStatus.OK)
  extendQuote(
    @Param('id') id: string,
    @Body() dto: ExtendQuoteDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.extendQuote(principal, id, dto);
  }

  // ── Paid policies ───────────────────────────────────────────────

  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('portal:policy:read')
  @Get('policies')
  listPolicies(@CurrentUser() principal: Principal) {
    return this.portal.listPolicies(principal);
  }

  @Needs('portal:certificate:issue')
  @Post('policies/:policyNumber/certificate')
  @HttpCode(HttpStatus.OK)
  issueCertificate(
    @Param('policyNumber') policyNumber: string,
    @Body() dto: IssueCertificateDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.issueCertificate(principal, policyNumber, dto);
  }

  // ── Claims ──────────────────────────────────────────────────────

  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('portal:claim:read')
  @Get('claims')
  listClaims(@CurrentUser() principal: Principal) {
    return this.portal.listClaims(principal);
  }

  @Needs('portal:claim:acknowledge')
  @Post('claims/:claimNumber/received')
  @HttpCode(HttpStatus.OK)
  acknowledgeClaim(
    @Param('claimNumber') claimNumber: string,
    @Body() dto: AcknowledgeClaimDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.acknowledgeClaim(principal, claimNumber, dto);
  }

  // ── No-claim discount ───────────────────────────────────────────

  @Needs('portal:ncd:read')
  @Get('ncd/applications')
  listNcdApplications(@CurrentUser() principal: Principal) {
    return this.portal.listNcdApplications(principal);
  }

  @Needs('portal:ncd:decide')
  @Post('ncd/applications/:id/decision')
  @HttpCode(HttpStatus.OK)
  decideNcdApplication(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: NcdDecisionDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.decideNcdApplication(principal, id, dto);
  }
}
