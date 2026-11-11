import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InsurersService } from './insurers.service.js';
import { CreateInsurerDto, SetInsurerStatusDto, UpdateInsurerDto } from './dto/insurer.dto.js';
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

  @Needs('insurer:delete')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.insurers.remove(id, principal);
  }
}
