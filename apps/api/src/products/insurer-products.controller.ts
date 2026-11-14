import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ProductsService } from './products.service.js';
import { CreateProductDto, UpdateDraftProductVersionDto } from './dto/product.dto.js';

/** Insurer-owned product drafts and submissions; the insurer id always comes from the trusted staff session. */
@Controller('insurer/products')
export class InsurerProductsController {
  constructor(private readonly products: ProductsService) {}

  @Needs('product:read-own')
  @Get()
  list(@CurrentUser() principal: Principal) {
    return this.products.listOwn(principal);
  }

  @Needs('product:read-own')
  @Get(':productId')
  get(@Param('productId', ParseUUIDPipe) productId: string, @CurrentUser() principal: Principal) {
    return this.products.getOwn(productId, principal);
  }

  @Needs('product:draft:manage')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProductDto, @CurrentUser() principal: Principal) {
    return this.products.create(dto, principal);
  }

  @Needs('product:draft:manage')
  @Patch(':productId/versions/:versionId')
  updateDraft(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Body() dto: UpdateDraftProductVersionDto,
    @CurrentUser() principal: Principal,
  ) {
    return this.products.updateDraft(productId, versionId, dto, principal);
  }

  @Needs('product:draft:manage')
  @Post(':productId/versions/:versionId/revise')
  @HttpCode(HttpStatus.CREATED)
  revise(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.products.revise(productId, versionId, principal);
  }

  @Needs('product:submit')
  @Post(':productId/versions/:versionId/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @CurrentUser() principal: Principal,
  ) {
    return this.products.submit(productId, versionId, principal);
  }
}
