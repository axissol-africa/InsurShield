import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { Needs } from '../common/auth/auth.guard.js';
import { AuditLogQueryDto } from './dto/audit-log-query.dto.js';

/** The administrator console. Platform-wide, so it is staff-only. */
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

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

  /** Immutable operational history, intentionally limited to safe summaries. */
  @Needs('admin:audit-read')
  @Get('audit-logs')
  auditLogs(@Query() query: AuditLogQueryDto) {
    return this.admin.auditLogs(query);
  }
}
