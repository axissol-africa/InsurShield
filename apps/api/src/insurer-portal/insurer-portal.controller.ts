import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { InsurerPortalService } from './insurer-portal.service.js';
import { InsurersService } from '../insurers/insurers.service.js';
import {
  AcknowledgeClaimDto,
  AssignInspectorDto,
  AssignProductDto,
  InspectionReasonDto,
  ScheduleInspectionDto,
  DeclineProductDto,
  ProductPriorityDto,
  QueueQueryDto,
  ExtendQuoteDto,
  InternalNoteDto,
  RequestInformationDto,
  IssueCertificateDto,
  AcceptIssuanceDto,
  IssuanceFailureDto,
  NcdDecisionDto,
  SubmitQuoteDto,
  WithdrawQuoteDto,
} from './dto/portal.dto.js';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { IntegrationsService } from '../integrations/integrations.service.js';

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
    private readonly integrations: IntegrationsService,
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

  /** Technical status for this insurer only; payloads and secrets never leave the API. */
  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('portal:integration:read')
  @Get('integrations/deliveries')
  integrationDeliveries(@CurrentUser() principal: Principal) {
    return this.integrations.listForInsurer(this.portal.staffOf(principal).insurerId!);
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

  // ── One chosen product ──────────────────────────────────────────

  /** Open chosen products, one row each, most urgent first. */
  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('portal:queue:read')
  @Get('queue')
  queue(@Query() query: QueueQueryDto, @CurrentUser() principal: Principal) {
    return this.portal.queue(principal, query);
  }

  @Needs('portal:quote:withdraw')
  @Post('quote-requests/:id/products/:productVersionId/quote/withdraw')
  @HttpCode(HttpStatus.OK)
  withdrawQuote(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @Body() dto: WithdrawQuoteDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.withdrawQuote(principal, id, productVersionId, dto);
  }

  @Needs('portal:quote:withdraw')
  @Post('quote-requests/:id/products/:productVersionId/quote/replace')
  @HttpCode(HttpStatus.CREATED)
  replaceQuote(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @Body() dto: SubmitQuoteDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.replaceQuote(principal, id, productVersionId, dto);
  }

  @Needs('portal:queue:claim')
  @Post('quote-requests/:id/products/:productVersionId/claim')
  @HttpCode(HttpStatus.OK)
  claimProduct(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.claimProduct(principal, id, productVersionId);
  }

  @Needs('portal:queue:assign')
  @Post('quote-requests/:id/products/:productVersionId/assign')
  @HttpCode(HttpStatus.OK)
  assignProduct(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @Body() dto: AssignProductDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.assignProduct(principal, id, productVersionId, dto);
  }

  @Needs('portal:queue:assign')
  @Post('quote-requests/:id/products/:productVersionId/priority')
  @HttpCode(HttpStatus.OK)
  setProductPriority(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @Body() dto: ProductPriorityDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.setProductPriority(principal, id, productVersionId, dto);
  }

  @Needs('portal:request:read')
  @Get('decline-reasons')
  declineReasons(@CurrentUser() principal: Principal) {
    return this.portal.declineReasons(principal);
  }

  @Needs('portal:quote:decline')
  @Post('quote-requests/:id/products/:productVersionId/decline')
  @HttpCode(HttpStatus.OK)
  declineProduct(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @Body() dto: DeclineProductDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.declineProduct(principal, id, productVersionId, dto);
  }

  @Needs('portal:quote:request-info')
  @Post('quote-requests/:id/products/:productVersionId/information-requests')
  @HttpCode(HttpStatus.CREATED)
  requestInformation(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @Body() dto: RequestInformationDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.requestInformation(principal, id, productVersionId, dto);
  }

  @Needs('portal:note:read')
  @Get('quote-requests/:id/products/:productVersionId/notes')
  listNotes(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.listNotes(principal, id, productVersionId);
  }

  @Needs('portal:note:write')
  @Post('quote-requests/:id/products/:productVersionId/notes')
  @HttpCode(HttpStatus.CREATED)
  addNote(
    @Param('id') id: string,
    @Param('productVersionId', ParseUUIDPipe) productVersionId: string,
    @Body() dto: InternalNoteDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.portal.addNote(principal, id, productVersionId, dto);
  }

  // ── Inspections ─────────────────────────────────────────────────

  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('portal:inspection:read')
  @Get('inspections')
  listInspections(@CurrentUser() principal: Principal) {
    return this.portal.listInspections(principal);
  }

  @Needs('portal:inspection:manage')
  @Post('inspections/:id/schedule')
  @HttpCode(HttpStatus.OK)
  scheduleInspection(@Param('id') id: string, @Body() dto: ScheduleInspectionDto, @CurrentUser() principal: Principal) {
    return this.portal.actOnInspection(principal, id, 'SCHEDULE', {
      scheduledDate: new Date(dto.scheduledDate),
      location: dto.location?.trim() || undefined,
    });
  }

  @Needs('portal:inspection:manage')
  @Post('inspections/:id/inspector')
  @HttpCode(HttpStatus.OK)
  assignInspector(@Param('id') id: string, @Body() dto: AssignInspectorDto, @CurrentUser() principal: Principal) {
    return this.portal.actOnInspection(principal, id, 'ASSIGN', {
      inspectorName: dto.inspectorName.trim(),
      inspectorPhone: dto.inspectorPhone?.trim() || undefined,
    });
  }

  @Needs('portal:inspection:manage')
  @Post('inspections/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveInspection(@Param('id') id: string, @CurrentUser() principal: Principal) {
    return this.portal.actOnInspection(principal, id, 'APPROVE', {});
  }

  @Needs('portal:inspection:manage')
  @Post('inspections/:id/fail')
  @HttpCode(HttpStatus.OK)
  failInspection(@Param('id') id: string, @Body() dto: InspectionReasonDto, @CurrentUser() principal: Principal) {
    return this.portal.actOnInspection(principal, id, 'FAIL', { reason: dto.reason.trim() });
  }

  @Needs('portal:inspection:manage')
  @Post('inspections/:id/no-show')
  @HttpCode(HttpStatus.OK)
  inspectionNoShow(@Param('id') id: string, @Body() dto: InspectionReasonDto, @CurrentUser() principal: Principal) {
    return this.portal.actOnInspection(principal, id, 'NO_SHOW', { reason: dto.reason.trim() });
  }

  @Needs('portal:inspection:manage')
  @Post('inspections/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancelInspection(@Param('id') id: string, @Body() dto: InspectionReasonDto, @CurrentUser() principal: Principal) {
    return this.portal.actOnInspection(principal, id, 'CANCEL', { reason: dto.reason.trim() });
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

  /** The insurer takes on issuing; the certificate can follow later. */
  @Needs('portal:certificate:issue')
  @Post('policies/:policyNumber/accept')
  @HttpCode(HttpStatus.OK)
  acceptIssuance(@Param('policyNumber') policyNumber: string, @Body() dto: AcceptIssuanceDto, @CurrentUser() principal: Principal) {
    return this.portal.acceptIssuance(principal, policyNumber, dto);
  }

  /** The insurer cannot issue a paid policy; the customer is refunded. */
  @Needs('portal:certificate:issue')
  @Post('policies/:policyNumber/issuance-failure')
  @HttpCode(HttpStatus.OK)
  reportIssuanceFailure(@Param('policyNumber') policyNumber: string, @Body() dto: IssuanceFailureDto, @CurrentUser() principal: Principal) {
    return this.portal.reportIssuanceFailure(principal, policyNumber, dto);
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
    @Headers('idempotency-key') key?: string,
  ) {
    return this.portal.decideNcdApplication(principal, id, dto, key);
  }
}
