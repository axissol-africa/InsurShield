import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { InspectionsController } from './inspections.controller.js';
import { InspectionsRepository } from './inspections.repository.js';
import { InspectionsService } from './inspections.service.js';

@Module({
  imports: [CustomerModule],
  controllers: [InspectionsController],
  providers: [InspectionsService, InspectionsRepository],
})
export class InspectionsModule {}
