import { Module } from '@nestjs/common';
import { InsurerPortalService } from './insurer-portal.service.js';
import { InsurerPortalController } from './insurer-portal.controller.js';
import { InsurersModule } from '../insurers/insurers.module.js';

@Module({
  imports: [InsurersModule],
  controllers: [InsurerPortalController],
  providers: [InsurerPortalService],
})
export class InsurerPortalModule {}
