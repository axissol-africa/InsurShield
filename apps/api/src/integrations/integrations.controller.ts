import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs, Public } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { ManualFallbackDto } from './dto/manual-fallback.dto.js';
import { IntegrationsService } from './integrations.service.js';

/** Platform operations and the narrowly-scoped external callback envelope. */
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Needs('integration:read')
  @Get('deliveries')
  @ApiRateLimit(API_LIMITS.bulkRead)
  deliveries() {
    return this.integrations.listForOperations();
  }

  @Needs('integration:resolve')
  @Post('deliveries/:id/manual-fallback')
  @HttpCode(HttpStatus.OK)
  manualFallback(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ManualFallbackDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.integrations.resolveManually(id, dto.note, principal);
  }

  /**
   * A provider has no browser session. Its signature is the credential, and
   * its idempotency is kept separately from user-command idempotency.
   */
  @Public()
  @Post('callbacks/insurers/:insurerId')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiRateLimit(API_LIMITS.integrationCallback)
  insurerCallback(
    @Param('insurerId', ParseUUIDPipe) insurerId: string,
    @Body() body: Record<string, unknown>,
    @Headers('x-insurshield-event-id') eventId: string | undefined,
    @Headers('x-insurshield-event-type') eventType: string | undefined,
    @Headers('x-insurshield-timestamp') timestamp: string | undefined,
    @Headers('x-insurshield-signature') signature: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
  ) {
    return this.integrations.receiveInsurerCallback({
      insurerId,
      eventId,
      eventType,
      correlationId,
      timestamp,
      signature,
      body,
    });
  }
}
