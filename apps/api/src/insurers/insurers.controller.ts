import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { InsurersService } from './insurers.service.js';
import { CreateInsurerDto, SetInsurerStatusDto, UpdateInsurerDto } from './dto/insurer.dto.js';
import { InsurerListQuery } from './dto/insurer-list.query.js';
import { Public, Roles } from '../common/auth/auth.guard.js';
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
  @Roles('SUPER_ADMIN', 'ADMIN')
  @Get()
  list(
    @Query() query: InsurerListQuery,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.list(query.status, principal.role);
  }

  @Roles('SUPER_ADMIN')
  @HttpCode(HttpStatus.OK)
  @Post(':id/restore')
  restore(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.restore(id, principal.role);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.insurers.get(id);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Post()
  create(@Body() dto: CreateInsurerDto) {
    return this.insurers.create(dto);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInsurerDto) {
    return this.insurers.update(id, dto);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetInsurerStatusDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.insurers.setStatus(id, dto.status, principal.role);
  }

  @Roles('SUPER_ADMIN')
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.insurers.remove(id);
  }
}
