import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import {
  ApiRateLimit,
  API_LIMITS,
} from '../common/rate-limit/api-rate-limit.guard.js';
import { ClaimsService } from './claims.service.js';
import { ClaimEvidenceDto, ClaimUpdateDto } from './dto/claims.dto.js';

@Controller('claims')
export class CustomerClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get(':claimNumber/timeline')
  @Needs('claim:read')
  @ApiRateLimit(API_LIMITS.bulkRead)
  timeline(
    @CurrentUser() principal: Principal,
    @Param('claimNumber') claimNumber: string,
  ) {
    return this.claims.timeline(principal, claimNumber, 'customer');
  }

  @Post(':claimNumber/evidence')
  @HttpCode(200)
  @Needs('claim:evidence')
  @ApiRateLimit(API_LIMITS.customerWrite)
  evidence(
    @CurrentUser() principal: Principal,
    @Param('claimNumber') claimNumber: string,
    @Body() dto: ClaimEvidenceDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.claims.evidence(principal, claimNumber, dto, key);
  }
}

@Controller('insurer/claims')
export class InsurerClaimsController {
  constructor(private readonly claims: ClaimsService) {}

  @Get(':claimNumber/timeline')
  @Needs('portal:claim:read')
  @ApiRateLimit(API_LIMITS.bulkRead)
  timeline(
    @CurrentUser() principal: Principal,
    @Param('claimNumber') claimNumber: string,
  ) {
    return this.claims.timeline(principal, claimNumber, 'insurer');
  }

  @Post(':claimNumber/updates')
  @HttpCode(200)
  @Needs('portal:claim:update')
  @ApiRateLimit(API_LIMITS.customerWrite)
  update(
    @CurrentUser() principal: Principal,
    @Param('claimNumber') claimNumber: string,
    @Body() dto: ClaimUpdateDto,
    @Headers('idempotency-key') key?: string,
  ) {
    return this.claims.update(principal, claimNumber, dto, key);
  }
}
