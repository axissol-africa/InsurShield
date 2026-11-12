import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CreateStaffTeamDto, CreateStaffUserDto, ReasonDto, UpdateStaffTeamDto, UpdateStaffUserDto } from './dto/staff.dto.js';
import { StaffService } from './staff.service.js';

@Controller('staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Needs('staff:read')
  @Get('users')
  listUsers(@CurrentUser() principal: Principal) {
    return this.staff.listUsers(principal);
  }

  @Needs('staff:manage')
  @Post('users')
  createUser(@CurrentUser() principal: Principal, @Body() dto: CreateStaffUserDto) {
    return this.staff.createUser(principal, dto);
  }

  @Needs('staff:manage')
  @Patch('users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateStaffUserDto,
  ) {
    return this.staff.updateUser(principal, id, dto);
  }

  @Needs('staff:manage')
  @Post('users/:id/invitation')
  @HttpCode(HttpStatus.OK)
  resendInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: ReasonDto,
  ) {
    return this.staff.resendInvitation(principal, id, dto.reason);
  }

  @Needs('staff:read')
  @Get('teams')
  listTeams(@CurrentUser() principal: Principal) {
    return this.staff.listTeams(principal);
  }

  @Needs('staff:manage')
  @Post('teams')
  createTeam(@CurrentUser() principal: Principal, @Body() dto: CreateStaffTeamDto) {
    return this.staff.createTeam(principal, dto);
  }

  @Needs('staff:manage')
  @Patch('teams/:id')
  updateTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: UpdateStaffTeamDto,
  ) {
    return this.staff.updateTeam(principal, id, dto);
  }

  @Needs('staff:manage')
  @Delete('teams/:id')
  removeTeam(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: Principal,
    @Body() dto: ReasonDto,
  ) {
    return this.staff.removeTeam(principal, id, dto.reason);
  }
}
