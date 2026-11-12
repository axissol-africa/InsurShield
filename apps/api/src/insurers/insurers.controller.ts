import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { InsurersService } from './insurers.service.js';
import {
  ActivateInsurerDto,
  CaptureEvidenceDto,
  CreateInsurerDto,
  InsurerIntegrationDto,
  ReviewEvidenceDto,
  SetInsurerStatusDto,
  SuspendInsurerDto,
  UpdateInsurerDto,
} from './dto/insurer.dto.js';
import { InsurerListQuery } from './dto/insurer-list.query.js';
import { Needs, Public } from '../common/auth/auth.guard.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';

@Controller('insurers')
export class InsurersController {
  constructor(private readonly insurers: InsurersService) {}

  /**
   * The public catalogue: active insurers with what a customer needs to
   * compare and to contact a claims desk. Deliberately omits the licence,
   * registration and tax numbers captured at onboarding.
   */
  @Public()
  @Get('directory')
  @ApiRateLimit(API_LIMITS.publicRead)
  directory() {
    return this.insurers.directory();
  }

  /** Every insurer in full, including onboarding details. Staff only. */
  @Needs('insurer:read')
  @Get()
  list(
    @Query() query: InsurerListQuery,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.list(query.status, principal.role);
  }

  @HttpCode(HttpStatus.OK)
  @Needs('insurer:restore')
  @Post(':id/restore')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.restore(id, principal);
  }

  @Needs('insurer:read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.insurers.get(id);
  }

  @Needs('insurer:create')
  @Post()
  create(@Body() dto: CreateInsurerDto, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.insurers.create(dto, principal);
  }

  @Needs('insurer:update')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInsurerDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.update(id, dto, principal);
  }

  @Needs('insurer:set-status')
  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetInsurerStatusDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.setStatus(id, dto.status, principal);
  }

  /** Suspension is a named operation because it also marks open quote work unavailable. */
  @Needs('insurer:set-status')
  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendInsurerDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.suspend(id, dto.reason, principal);
  }

  // ── The onboarding record ───────────────────────────────────────

  @Needs('insurer:evidence:read')
  @Get(':id/evidence')
  evidence(@Param('id', ParseUUIDPipe) id: string) {
    return this.insurers.evidence(id);
  }

  @Needs('insurer:evidence:add')
  @Post(':id/evidence')
  @HttpCode(HttpStatus.CREATED)
  captureEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CaptureEvidenceDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.captureEvidence(id, dto, principal);
  }

  @Needs('insurer:evidence:review')
  @Post(':id/evidence/:evidenceId/review')
  @HttpCode(HttpStatus.OK)
  reviewEvidence(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('evidenceId', ParseUUIDPipe) evidenceId: string,
    @Body() dto: ReviewEvidenceDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.reviewEvidence(id, evidenceId, dto, principal);
  }

  @Needs('insurer:integration:set')
  @Get(':id/integration')
  integration(@Param('id', ParseUUIDPipe) id: string) {
    return this.insurers.integration(id);
  }

  @Needs('insurer:integration:set')
  @Put(':id/integration')
  @HttpCode(HttpStatus.OK)
  setIntegration(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: InsurerIntegrationDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.setIntegration(id, dto, principal);
  }

  /** Activation is its own route, so the evidence gate cannot be stepped around. */
  @Needs('insurer:activate')
  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActivateInsurerDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.activate(id, dto, principal);
  }

  @Needs('insurer:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.insurers.remove(id, principal);
  }
}
