import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { AssignRiskDto, ListRiskQuery, ReferRiskDto, ResolveRiskDto } from './dto/risk-review.dto.js';
import { RiskReviewService } from './risk-review.service.js';
@Controller('admin/risk-review')
export class RiskReviewController {
  constructor(private readonly service: RiskReviewService) {}
  @Get() @Needs('admin:risk:review')
  list(@CurrentUser() principal: Principal, @Query() query: ListRiskQuery) { return this.service.list(principal, query); }
  @Post() @Needs('admin:risk:review')
  refer(@CurrentUser() principal: Principal, @Body() dto: ReferRiskDto) { return this.service.refer(principal, dto); }
  @Post(':id/assign') @HttpCode(200) @Needs('admin:risk:review')
  assign(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignRiskDto) { return this.service.assign(principal, id, dto); }
  @Post(':id/resolve') @HttpCode(200) @Needs('admin:risk:review')
  resolve(@CurrentUser() principal: Principal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveRiskDto) { return this.service.resolve(principal, id, dto); }
}
