import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import {
  ApiRateLimit,
  API_LIMITS,
} from '../common/rate-limit/api-rate-limit.guard.js';
import {
  CreateTemplateVersionDto,
  ReviewTemplateDto,
  TemplatePageDto,
} from './dto/template-governance.dto.js';
import { TemplateGovernanceService } from './template-governance.service.js';

@Controller('admin')
export class TemplateGovernanceController {
  constructor(private readonly service: TemplateGovernanceService) {}
  @Get('notification-templates')
  @Needs('admin:notification:manage')
  @ApiRateLimit(API_LIMITS.bulkRead)
  list(@CurrentUser() principal: Principal, @Query() query: TemplatePageDto) {
    return this.service.list(principal, query);
  }

  @Post('notification-templates/:id/versions')
  @Needs('admin:notification:manage')
  create(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: CreateTemplateVersionDto,
  ) {
    return this.service.create(principal, id, input);
  }
  @Post('notification-templates/:id/approve')
  @HttpCode(200)
  @Needs('admin:notification:manage')
  approve(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReviewTemplateDto,
  ) {
    return this.service.review(principal, id, input, 'approve');
  }
  @Post('notification-templates/:id/withdraw')
  @HttpCode(200)
  @Needs('admin:notification:manage')
  withdraw(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: ReviewTemplateDto,
  ) {
    return this.service.review(principal, id, input, 'withdraw');
  }
  @Get('notification-delivery-exceptions')
  @Needs('admin:notification:manage')
  @ApiRateLimit(API_LIMITS.bulkRead)
  exceptions(
    @CurrentUser() principal: Principal,
    @Query() query: TemplatePageDto,
  ) {
    return this.service.exceptions(principal, query);
  }
}
