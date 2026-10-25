import { Module } from '@nestjs/common';
import { InspectionsController } from './inspections.controller.js';
import { InspectionsRepository } from './inspections.repository.js';
import { InspectionsService } from './inspections.service.js';

@Module({
  controllers: [InspectionsController],
  providers: [InspectionsService, InspectionsRepository],
})
export class InspectionsModule {}
