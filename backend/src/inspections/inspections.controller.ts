import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { InspectionsService } from './inspections.service.js';
import { RequestInspectionDto, UpdateInspectionDto } from '../customer/dto/customer.dto.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Principal } from '../common/auth/auth.types.js';

@Controller('inspections')
export class InspectionsController {
  constructor(private readonly inspections: InspectionsService) {}

  private scope(principal: Principal): string {
    if (principal.kind !== 'customer') {
      throw ApiException.forbidden('This endpoint is for customer accounts.');
    }
    return principal.id;
  }

  @Get()
  list(@CurrentUser() principal: Principal) {
    return this.inspections.list(this.scope(principal));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  request(@Body() dto: RequestInspectionDto, @CurrentUser() principal: Principal) {
    return this.inspections.request(this.scope(principal), dto);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateInspectionDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.inspections.update(this.scope(principal), id, dto);
  }
}
