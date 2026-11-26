import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Needs, Public } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { ModerationPageDto, ReviewDecisionDto, ReviewPageDto, ReviewResponseDto, SaveReviewDto } from './reviews.dto.js';
import { ReviewsService } from './reviews.service.js';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Needs('review:manage')
  @Get('customer/policies/:number')
  customerState(@Param('number') number: string, @CurrentUser() principal: Principal) {
    return this.reviews.customerState(number, principal);
  }

  @Needs('review:manage')
  @Post('customer/policies/:number')
  submit(@Param('number') number: string, @Body() dto: SaveReviewDto, @CurrentUser() principal: Principal) {
    return this.reviews.save(number, dto, principal, false);
  }

  @Needs('review:manage')
  @Patch('customer/policies/:number')
  edit(@Param('number') number: string, @Body() dto: SaveReviewDto, @CurrentUser() principal: Principal) {
    return this.reviews.save(number, dto, principal, true);
  }

  @Needs('review:manage')
  @Delete('customer/policies/:number')
  withdraw(@Param('number') number: string, @CurrentUser() principal: Principal) {
    return this.reviews.withdraw(number, principal);
  }

  @Public()
  @ApiRateLimit(API_LIMITS.publicRead)
  @Get('public/:insurerId')
  publicReviews(@Param('insurerId', ParseUUIDPipe) insurerId: string, @Query() dto: ReviewPageDto) {
    return this.reviews.publicReviews(insurerId, dto.page ?? 1);
  }

  @Needs('portal:review:manage')
  @Get('insurer')
  insurerReviews(@Query() dto: ReviewPageDto, @CurrentUser() principal: Principal) {
    return this.reviews.insurerReviews(principal, dto.page ?? 1);
  }

  @Needs('portal:review:manage')
  @Put('insurer/:reviewId/response')
  response(@Param('reviewId', ParseUUIDPipe) reviewId: string, @Body() dto: ReviewResponseDto, @CurrentUser() principal: Principal) {
    return this.reviews.respond(reviewId, dto.text, principal);
  }

  @Needs('admin:review:moderate')
  @Get('admin')
  moderation(@Query() dto: ModerationPageDto, @CurrentUser() principal: Principal) {
    return this.reviews.moderationQueue(dto.status ?? 'PENDING', dto.page ?? 1, principal);
  }

  @Needs('admin:review:moderate')
  @Post('admin/:reviewId/decisions')
  decide(@Param('reviewId', ParseUUIDPipe) reviewId: string, @Body() dto: ReviewDecisionDto, @CurrentUser() principal: Principal) {
    return this.reviews.decide(reviewId, dto, principal);
  }
}
