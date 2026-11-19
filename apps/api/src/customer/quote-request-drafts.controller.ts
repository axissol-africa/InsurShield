import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs } from '../common/auth/auth.guard.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { CreateQuoteRequestDraftDto, UpdateQuoteRequestDraftDto } from './dto/quote-request-draft.dto.js';
import { QuoteRequestDraftsService } from './quote-request-drafts.service.js';

/** Customer-only, server-resumable product-selection work. */
@Controller('quote-request-drafts')
export class QuoteRequestDraftsController {
  constructor(private readonly drafts: QuoteRequestDraftsService) {}

  private customerOf(principal: Principal): CustomerPrincipal {
    if (principal.kind !== 'customer') throw ApiException.forbidden('This endpoint is for customer accounts.');
    return principal;
  }

  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('quote-request:read')
  @Get()
  list(@CurrentUser() principal: Principal) {
    return this.drafts.list(this.customerOf(principal));
  }

  @Needs('quote-request:submit')
  @ApiRateLimit(API_LIMITS.customerWrite)
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateQuoteRequestDraftDto, @CurrentUser() principal: Principal) {
    return this.drafts.create(this.customerOf(principal), dto);
  }

  @ApiRateLimit(API_LIMITS.bulkRead)
  @Needs('quote-request:read')
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() principal: Principal) {
    return this.drafts.get(this.customerOf(principal), id);
  }

  @Needs('quote-request:submit')
  @ApiRateLimit(API_LIMITS.customerWrite)
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQuoteRequestDraftDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.drafts.update(this.customerOf(principal), id, dto);
  }

  @Needs('quote-request:submit')
  @ApiRateLimit(API_LIMITS.customerWrite)
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() principal: Principal) {
    return this.drafts.remove(this.customerOf(principal), id);
  }
}
