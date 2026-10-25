import { Body, Controller, Get, Put } from '@nestjs/common';
import { Public, Roles } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { SetPiaConfigDto } from './dto/pia.dto.js';
import { PiaService } from './pia.service.js';

/**
 * The PIA minimum rate. A single row (`id = "current"`), because it is platform
 * configuration rather than a collection, and the premium engine reads it on
 * every quote.
 */
@Controller('config/pia')
export class PiaController {
  constructor(private readonly pia: PiaService) {}

  @Public()
  @Get()
  get() {
    return this.pia.get();
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Put()
  set(@Body() dto: SetPiaConfigDto, @CurrentUser() principal: Principal) {
    return this.pia.set(dto.piaRatePercentage, principal.id);
  }
}
