import { Controller, Get, Header } from '@nestjs/common';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { DataExportService } from './data-export.service.js';

@Controller('account')
export class PrivacyController {
  constructor(private readonly exports: DataExportService) {}

  /** Everything held about the signed-in customer, built now and never stored. */
  @Needs('account:export')
  @ApiRateLimit(API_LIMITS.dataExport)
  @Get('export')
  @Header('Cache-Control', 'no-store')
  export(@CurrentUser() principal: Principal) {
    if (principal.kind !== 'customer') throw ApiException.forbidden('This endpoint is for customer accounts.');
    return this.exports.export(principal);
  }
}
