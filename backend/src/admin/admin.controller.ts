import { Controller, DefaultValuePipe, Get, ParseIntPipe, Query } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { Roles } from '../common/auth/auth.guard.js';

/** The administrator console. Platform-wide, so it is staff-only. */
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('premium-by-month')
  premiumByMonth(@Query('months', new DefaultValuePipe(12), ParseIntPipe) months: number) {
    return this.admin.premiumByMonth(Math.min(Math.max(months, 1), 24));
  }

  @Get('policies')
  recentPolicies(@Query('limit', new DefaultValuePipe(8), ParseIntPipe) limit: number) {
    return this.admin.recentPolicies(Math.min(Math.max(limit, 1), 50));
  }

  @Get('customers/find')
  findCustomer(@Query('query') query = '') {
    return this.admin.findCustomer(query);
  }
}
