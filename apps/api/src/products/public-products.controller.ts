import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { Public } from '../common/auth/auth.guard.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { ProductsService } from './products.service.js';
import { ProductDirectoryQueryDto, ProductEstimateQueryDto } from './dto/product.dto.js';

/** The customer-facing, approved product catalogue. Batch 12 selects from it. */
@Controller('products')
export class PublicProductsController {
  constructor(private readonly products: ProductsService) {}

  @Public()
  @ApiRateLimit(API_LIMITS.publicRead)
  @Get('directory')
  directory(@Query() query: ProductDirectoryQueryDto) {
    return this.products.directory(query);
  }

  /** A rate-limited, indicative amount only; a final insurer quote remains authoritative. */
  @Public()
  @ApiRateLimit(API_LIMITS.publicRead)
  @Get(':productId/versions/:versionId/estimate')
  estimate(
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('versionId', ParseUUIDPipe) versionId: string,
    @Query() query: ProductEstimateQueryDto,
  ) {
    return this.products.estimate(productId, versionId, query);
  }
}
