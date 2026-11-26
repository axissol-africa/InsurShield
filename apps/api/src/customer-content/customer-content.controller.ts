import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Needs, Public } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { ContentPageDto, ContentSlugDto, CreateContentDto, WithdrawContentDto } from './customer-content.dto.js';
import { CustomerContentService } from './customer-content.service.js';
@Controller('customer-content')
export class CustomerContentController {
  constructor(private readonly content: CustomerContentService) {}
  @Public() @ApiRateLimit(API_LIMITS.publicRead) @Get('public')
  published() { return this.content.published(); }
  @Needs('admin:content:manage') @Get('admin')
  list(@Query() query: ContentPageDto, @CurrentUser() principal: Principal) { return this.content.list(query.page ?? 1, principal); }
  @Needs('admin:content:manage') @Get('admin/:slug/history')
  history(@Param() params: ContentSlugDto, @CurrentUser() principal: Principal) { return this.content.history(params.slug, principal); }
  @Needs('admin:content:manage') @Post('admin/:slug/versions')
  create(@Param() params: ContentSlugDto, @Body() dto: CreateContentDto, @CurrentUser() principal: Principal) { return this.content.create(params.slug, dto, principal); }
  @Needs('admin:content:manage') @Post('admin/:slug/versions/:id/approve')
  approve(@Param('slug') slug: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() principal: Principal) { return this.content.approve(slug, id, principal); }
  @Needs('admin:content:manage') @Post('admin/:slug/versions/:id/withdraw')
  withdraw(@Param('slug') slug: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: WithdrawContentDto, @CurrentUser() principal: Principal) { return this.content.withdraw(slug, id, dto.reason, principal); }
}
