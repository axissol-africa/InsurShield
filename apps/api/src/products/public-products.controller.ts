import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../common/auth/auth.guard.js';
import { ApiRateLimit, API_LIMITS } from '../common/rate-limit/api-rate-limit.guard.js';
import { ProductsService } from './products.service.js';
import { ProductDirectoryQueryDto } from './dto/product.dto.js';

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
}
