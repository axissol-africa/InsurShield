import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Needs, Public } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { INSURER_PROFILE_ROUTES } from './dto/insurer-profiles.contract.js';
import { DecideInsurerProfileDto, InsurerProfileHistoryQueryDto, SubmitInsurerProfileDto } from './dto/insurer-profiles.dto.js';
import { InsurerProfilesService } from './insurer-profiles.service.js';

@Controller()
export class InsurerProfilesController {
  constructor(private readonly profiles: InsurerProfilesService) {}

  @Public()
  @ApiRateLimit(API_LIMITS.publicRead)
  @Get(INSURER_PROFILE_ROUTES.public)
  publicProfile(@Param('insurerId', ParseUUIDPipe) insurerId: string) {
    return this.profiles.publicProfile(insurerId);
  }

  @Needs('portal:profile:read')
  @Get(INSURER_PROFILE_ROUTES.ownRevisions)
  ownHistory(@CurrentUser() principal: Principal, @Query() query: InsurerProfileHistoryQueryDto) {
    return this.profiles.ownHistory(principal, query);
  }

  // The service additionally restricts writes to the insurer administrator.
  @Needs('portal:profile:read')
  @Post(INSURER_PROFILE_ROUTES.ownRevisions)
  submit(@Body() dto: SubmitInsurerProfileDto, @CurrentUser() principal: Principal) {
    return this.profiles.submit(dto, principal);
  }

  @Needs('insurer:read')
  @Get(INSURER_PROFILE_ROUTES.adminRevisions)
  adminHistory(@Param('insurerId', ParseUUIDPipe) insurerId: string, @CurrentUser() principal: Principal, @Query() query: InsurerProfileHistoryQueryDto) {
    return this.profiles.adminHistory(insurerId, principal, query);
  }

  @Needs('insurer:update')
  @Post(INSURER_PROFILE_ROUTES.decision)
  @HttpCode(200)
  decide(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Param('revisionId', ParseUUIDPipe) revisionId: string,
    @Body() dto: DecideInsurerProfileDto, @CurrentUser() principal: Principal) {
    return this.profiles.decide(insurerId, revisionId, dto, principal);
  }
}
