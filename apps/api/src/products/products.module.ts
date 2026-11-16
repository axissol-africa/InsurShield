import { Module } from '@nestjs/common';
import { InsurersModule } from '../insurers/insurers.module.js';
import { PiaModule } from '../pia/pia.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AdminProductsController } from './admin-products.controller.js';
import { InsurerProductsController } from './insurer-products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';
import { PublicProductsController } from './public-products.controller.js';

@Module({
  imports: [InsurersModule, PiaModule, SettingsModule],
  controllers: [InsurerProductsController, AdminProductsController, PublicProductsController],
  providers: [ProductsRepository, ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
