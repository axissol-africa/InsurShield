import { Controller, Get, Header, Param, ParseUUIDPipe, Redirect } from '@nestjs/common';
import { Needs, RecentSignIn } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { API_LIMITS, ApiRateLimit } from '../common/rate-limit/api-rate-limit.guard.js';
import { AccountDataService } from './account-data.service.js';

const EXPORT_FRESHNESS_MS = 10 * 60_000;
const EXPORT_LIMIT = { bucket: 'account-export', limit: 3, windowMs: 15 * 60_000 };

@Controller('account')
export class AccountDataController {
  constructor(private readonly account: AccountDataService) {}

  @Get('documents')
  @Header('Cache-Control', 'private, no-store')
  @Needs('document:read')
  @ApiRateLimit(API_LIMITS.bulkRead)
  listDocuments(@CurrentUser() principal: Principal) {
    return this.account.documentsFor(principal);
  }

  @Get('documents/:id/download')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  @Needs('document:read')
  @ApiRateLimit(API_LIMITS.download)
  @Redirect()
  download(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.download(principal, id);
  }

  @Get('export')
  @Header('Cache-Control', 'private, no-store')
  @Needs('account:export')
  @RecentSignIn(EXPORT_FRESHNESS_MS)
  @ApiRateLimit(EXPORT_LIMIT)
  @Header('Content-Disposition', 'attachment; filename="insurshield-account.json"')
  export(@CurrentUser() principal: Principal) {
    return this.account.export(principal);
  }
}
