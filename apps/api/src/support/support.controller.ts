import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { SupportService } from './support.service.js';

class RecordLookupQuery {
  /** Why the record is being looked at, kept in the audit trail. */
  @IsString() @MinLength(5, { message: 'Say why you are looking, for example the support ticket number.' }) @MaxLength(300)
  reason!: string;
}

@Controller()
export class SupportController {
  constructor(private readonly support: SupportService) {}

  /** Where the help desk is and which references to quote to it. */
  @Needs('support:contact')
  @Get('support/contact')
  contact(@CurrentUser() principal: Principal) {
    if (principal.kind !== 'customer') throw ApiException.forbidden('This endpoint is for customer accounts.');
    return this.support.contact(principal);
  }

  /** A help-desk agent finds the record a customer quoted (US-ADM-012). */
  @Needs('admin:record-find')
  @Get('admin/records/:reference')
  @ApiRateLimit(API_LIMITS.bulkRead)
  find(@Param('reference') reference: string, @Query() query: RecordLookupQuery, @CurrentUser() principal: Principal) {
    return this.support.findRecord(principal, reference.trim(), query.reason.trim());
  }
}
