import { Controller, Get, Query } from '@nestjs/common';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs, OptionalAuth } from '../common/auth/auth.guard.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { VehiclesService } from './vehicles.service.js';

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  /**
   * Identify a vehicle from its licence plate.
   *
   * Guests can identify a vehicle before an account exists. A signed-in
   * customer may also recover only their own previously submitted details.
   */
  @Needs('vehicle:lookup')
  @OptionalAuth()
  @Get('lookup')
  @ApiRateLimit(API_LIMITS.publicRead)
  lookup(@Query('plate') plate: string, @CurrentUser() principal?: Principal) {
    return this.vehicles.lookup(plate, principal);
  }
}
