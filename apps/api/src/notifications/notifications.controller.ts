import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiException } from '../common/errors/api.exception.js';
import { MAX_PAGE, NotificationQueryDto, PreferenceDto, toNotification } from './dto/notification.dto.js';
import { NotificationsRepository } from './notifications.repository.js';

/** The customer's own messages and the choices that govern them. */
@Controller()
export class NotificationsController {
  constructor(private readonly repository: NotificationsRepository) {}

  private customerOf(principal: Principal): string {
    // Staff have no centre: messages belong to the customer they are about.
    if (principal.kind !== 'customer') throw ApiException.forbidden();
    return principal.id;
  }

  @ApiRateLimit(API_LIMITS.bulkRead)
  @Get('notifications')
  async list(@CurrentUser() principal: Principal, @Query() query: NotificationQueryDto) {
    const customerId = this.customerOf(principal);
    const items = await this.repository.listFor(customerId, {
      before: query.before ? new Date(query.before) : undefined,
      limit: query.limit ?? MAX_PAGE,
    });
    return {
      items: items.map(toNotification),
      // The caller continues from the oldest row it has, so a message arriving
      // mid-read cannot push one off the end of a page unseen.
      nextCursor: items.length > 0 ? items[items.length - 1].createdAt.toISOString() : null,
      unread: await this.repository.unreadCount(customerId),
    };
  }

  @Post('notifications/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string) {
    const customerId = this.customerOf(principal);
    // False means the message is not this customer's, or does not exist; both
    // answer the same way, so the route reveals nothing. Marking one read twice
    // succeeds and keeps the first time.
    const marked = await this.repository.markRead(customerId, id, new Date());
    if (!marked) throw ApiException.notFound('Notification', id);
  }

  @Get('contact-preferences')
  async preferences(@CurrentUser() principal: Principal) {
    const customerId = this.customerOf(principal);
    return {
      preferences: await this.repository.transaction((tx) => this.repository.preferencesFor(tx, customerId)),
      marketingConsent: await this.repository.marketingConsent(customerId),
    };
  }

  @Put('contact-preferences')
  @HttpCode(HttpStatus.NO_CONTENT)
  async setPreference(@CurrentUser() principal: Principal, @Body() choice: PreferenceDto) {
    await this.repository.setPreference(this.customerOf(principal), choice, new Date());
  }
}
