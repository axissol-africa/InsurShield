import { Body, Controller, Get, Put } from '@nestjs/common';
import { Needs, Public } from '../common/auth/auth.guard.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
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
  @ApiRateLimit(API_LIMITS.publicRead)
  get() {
    return this.pia.get();
  }

  @Needs('pia:set-floor')
  @Put()
  set(@Body() dto: SetPiaConfigDto, @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>) {
    return this.pia.proposeSet(dto.piaRatePercentage, principal);
  }
}
