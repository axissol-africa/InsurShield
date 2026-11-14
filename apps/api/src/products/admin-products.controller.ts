import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ProductsService } from './products.service.js';
import { ApproveProductVersionDto, RejectProductVersionDto, WithdrawProductVersionDto } from './dto/product.dto.js';
import { IsIn, IsOptional } from 'class-validator';
import { PRODUCT_VERSION_STATUSES, type ProductVersionStatus } from '../common/domain/enums.js';

class ProductReviewQueryDto {
  @IsOptional() @IsIn(PRODUCT_VERSION_STATUSES) status?: ProductVersionStatus;
}

/** Platform review deliberately stays separate from the insurer's drafting routes. */
@Controller('admin/products')
export class AdminProductsController {
  constructor(private readonly products: ProductsService) {}

  @Needs('admin:product:read')
  @Get()
  list(@Query() query: ProductReviewQueryDto, @CurrentUser() principal: Principal) {
    return this.products.reviewQueue(principal, query.status);
  }

  @Needs('admin:product:review')
  @Post(':productId/versions/:versionId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: ApproveProductVersionDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.products.approve(productId, versionId, dto, principal);
  }

  @Needs('admin:product:review')
  @Post(':productId/versions/:versionId/reject')
  @HttpCode(HttpStatus.OK)
  reject(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: RejectProductVersionDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.products.reject(productId, versionId, dto, principal);
  }

  @Needs('admin:product:review')
  @Post(':productId/versions/:versionId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: WithdrawProductVersionDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.products.withdraw(productId, versionId, dto, principal);
  }
}
