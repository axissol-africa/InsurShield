import { Controller, Get, Query } from '@nestjs/common';
import { VehiclesService } from './vehicles.service.js';
import { Public } from '../common/auth/auth.guard.js';

@Controller('vehicles')
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  /**
   * Identify a vehicle from its licence plate.
   *
   * Public: a guest identifies their vehicle before an account exists, which
   * is the whole point of letting people explore before signing up.
   */
  @Public()
  @Get('lookup')
  lookup(@Query('plate') plate: string) {
    return this.vehicles.lookup(plate);
  }
}
