import { Module } from '@nestjs/common';
import { InsurersModule } from '../insurers/insurers.module.js';
import { AdminProductsController } from './admin-products.controller.js';
import { InsurerProductsController } from './insurer-products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';
import { PublicProductsController } from './public-products.controller.js';

@Module({
  imports: [InsurersModule],
  controllers: [InsurerProductsController, AdminProductsController, PublicProductsController],
  providers: [ProductsRepository, ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
