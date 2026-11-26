import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CreateReviewAppealDto, ResolveReviewAppealDto, ReviewAppealListDto, ReviewLegalHoldDto } from './dto/review-appeals.dto.js';
import { ReviewAppealsService } from './review-appeals.service.js';

@Controller('review-appeals')
export class CustomerReviewAppealsController {
  constructor(private readonly appeals: ReviewAppealsService) {}
  @Needs('review:manage')
  @Get()
  list(@CurrentUser() principal: Principal, @Query() query: ReviewAppealListDto) { return this.appeals.list(principal, 'CUSTOMER', query); }
  @Needs('review:manage')
  @Post()
  create(@Body() dto: CreateReviewAppealDto, @CurrentUser() principal: Principal) { return this.appeals.create(dto, principal, 'CUSTOMER'); }
}

@Controller('portal/review-appeals')
export class InsurerReviewAppealsController {
  constructor(private readonly appeals: ReviewAppealsService) {}
  @Needs('portal:review:manage')
  @Get()
  list(@CurrentUser() principal: Principal, @Query() query: ReviewAppealListDto) { return this.appeals.list(principal, 'INSURER', query); }
  @Needs('portal:review:manage')
  @Post()
  create(@Body() dto: CreateReviewAppealDto, @CurrentUser() principal: Principal) { return this.appeals.create(dto, principal, 'INSURER'); }
}

@Controller('admin/review-appeals')
export class AdminReviewAppealsController {
  constructor(private readonly appeals: ReviewAppealsService) {}
  @Needs('admin:review:moderate')
  @Get()
  list(@CurrentUser() principal: Principal, @Query() query: ReviewAppealListDto) { return this.appeals.list(principal, 'ADMIN', query); }
  @Needs('admin:review:moderate')
  @Post(':id/resolve')
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveReviewAppealDto, @CurrentUser() principal: Principal) { return this.appeals.resolve(id, dto, principal); }
  @Needs('admin:review:moderate')
  @Patch('reviews/:reviewId/legal-hold')
  hold(@Param('reviewId', ParseUUIDPipe) reviewId: string, @Body() dto: ReviewLegalHoldDto, @CurrentUser() principal: Principal) { return this.appeals.legalHold(reviewId, dto.held, principal); }
}
