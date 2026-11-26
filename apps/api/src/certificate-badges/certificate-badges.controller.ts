import { Body, Controller, Get, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsInt, IsString, Length, Max, Min } from 'class-validator';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { CertificateBadgesService } from './certificate-badges.service.js';

export class SetBadgeSuspensionDto {
  @IsBoolean() suspended!: boolean;
  @IsInt() @Min(0) @Max(2_147_483_647) expectedGeneration!: number;
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @Length(1, 2000) reason!: string;
}

@Controller('admin/insurer-reputation/:insurerId/badge')
export class CertificateBadgesController {
  constructor(private readonly badges: CertificateBadgesService) {}

  @Get()
  @Needs('admin:badge:manage')
  get(@Param('insurerId', ParseUUIDPipe) insurerId: string, @CurrentUser() principal: Principal) {
    return this.badges.adminView(insurerId, principal);
  }

  @Put()
  @Needs('admin:badge:manage')
  put(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Body() dto: SetBadgeSuspensionDto, @CurrentUser() principal: Principal) {
    return this.badges.setSuspension(insurerId, dto.suspended, dto.reason, principal, dto.expectedGeneration);
  }
}
