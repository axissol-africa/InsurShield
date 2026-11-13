import { Body, Controller, DefaultValuePipe, Get, ParseIntPipe, Post, Query } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { Needs } from '../common/auth/auth.guard.js';
import { AuditLogQueryDto } from './dto/audit-log-query.dto.js';
import { SupportPasswordResetDto } from './dto/support-password-reset.dto.js';
import { SupportPasswordResetService } from './support-password-reset.service.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';

/** The administrator console. Platform-wide, so it is staff-only. */
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly passwordResets: SupportPasswordResetService,
  ) {}

  @Needs('admin:overview')
  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Needs('admin:premium-report')
  @Get('premium-by-month')
  premiumByMonth(@Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number) {
    return this.admin.premiumByMonth(Math.min(Math.max(months, 1), 24));
  }

  @Needs('admin:policy-list')
  @Get('policies')
  recentPolicies(@Query('limit', new DefaultValuePipe(8), ParseIntPipe) limit: number) {
    return this.admin.recentPolicies(Math.min(Math.max(limit, 1), 50));
  }

  @Needs('admin:customer-find')
  @Get('customers/find')
  findCustomer(@Query('query') query = '') {
    return this.admin.findCustomer(query);
  }

  /** A reset link is sent only after the exact customer account is re-confirmed. */
  @Needs('admin:customer-password-reset')
  @Post('customers/password-reset')
  requestCustomerPasswordReset(
    @Body() dto: SupportPasswordResetDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.passwordResets.request(principal, dto);
  }

  /** Immutable operational history, intentionally limited to safe summaries. */
  @Needs('admin:audit-read')
  @Get('audit-logs')
  auditLogs(@Query() query: AuditLogQueryDto) {
    return this.admin.auditLogs(query);
  }
}
