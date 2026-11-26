import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import {
  CreatePrivacyRequestDto,
  StaffCreatePrivacyRequestDto,
  PrivacyHoldDto,
  PrivacyListDto,
  PrivacyTransitionDto,
} from './dto/privacy-review.dto.js';
import { PrivacyReviewService } from './privacy-review.service.js';
@Controller('privacy-requests')
export class CustomerPrivacyReviewController {
  constructor(private readonly service: PrivacyReviewService) {}
  @Get()
  @Needs('account:privacy:request')
  list(@CurrentUser() principal: Principal, @Query() query: PrivacyListDto) {
    return this.service.list(principal, query);
  }
  @Post()
  @Needs('account:privacy:request')
  create(
    @CurrentUser() principal: Principal,
    @Body() dto: CreatePrivacyRequestDto,
  ) {
    return this.service.create(principal, dto);
  }
}
@Controller('admin/privacy-requests')
export class AdminPrivacyReviewController {
  constructor(private readonly service: PrivacyReviewService) {}
  @Get()
  @Needs('admin:privacy:review')
  list(@CurrentUser() principal: Principal, @Query() query: PrivacyListDto) {
    return this.service.list(principal, query, true);
  }
  @Post()
  @Needs('admin:privacy:review')
  create(
    @CurrentUser() principal: Principal,
    @Body() dto: StaffCreatePrivacyRequestDto,
  ) {
    return this.service.create(principal, dto, true);
  }
  @Get(':id')
  @Needs('admin:privacy:review')
  detail(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: PrivacyListDto,
  ) {
    return this.service.detail(principal, id, query);
  }
  @Post(':id/transitions')
  @Needs('admin:privacy:review')
  transition(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrivacyTransitionDto,
  ) {
    return this.service.transition(principal, id, dto);
  }
  @Post(':id/hold')
  @Needs('admin:privacy:review')
  hold(
    @CurrentUser() principal: Principal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: PrivacyHoldDto,
  ) {
    return this.service.hold(principal, id, dto);
  }
}
