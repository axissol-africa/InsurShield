import {
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { UsersService } from './users.service.js';
import { CreateStaffDto, SuspendCustomerDto, UpdateStaffDto } from './dto/users.dto.js';
import { Roles } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';

/** The administrator console. Platform-wide, so it is staff-only. */
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly users: UsersService,
  ) {}

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

  // ── Staff accounts ──────────────────────────────────────────────

  @Get('staff')
  listStaff() {
    return this.users.listStaff();
  }

  @Post('staff')
  @HttpCode(HttpStatus.CREATED)
  createStaff(@Body() dto: CreateStaffDto) {
    return this.users.createStaff(dto);
  }

  @Patch('staff/:id')
  updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffDto, @CurrentUser() actor: Principal) {
    return this.users.updateStaff(id, dto, actor);
  }

  @Post('staff/:id/password')
  @HttpCode(HttpStatus.OK)
  resetStaffPassword(@Param('id') id: string) {
    return this.users.resetStaffPassword(id);
  }

  @Delete('staff/:id')
  @HttpCode(HttpStatus.OK)
  deactivateStaff(@Param('id') id: string, @CurrentUser() actor: Principal) {
    return this.users.deactivateStaff(id, actor);
  }

  // ── Customer accounts (read-only, plus suspension) ──────────────

  @Get('customers')
  listCustomers(
    @Query('query') query = '',
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
  ) {
    return this.users.listCustomers(query, Math.min(Math.max(limit, 1), 200));
  }

  @Patch('customers/:id/suspension')
  setCustomerSuspended(@Param('id') id: string, @Body() dto: SuspendCustomerDto) {
    return this.users.setCustomerSuspended(id, dto.suspended);
  }
}
