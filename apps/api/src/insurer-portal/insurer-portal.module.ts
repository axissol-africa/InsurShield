import { Module } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { InsurerPortalService, NCD_CODE_PICK } from './insurer-portal.service.js';
import { InsurerPortalController } from './insurer-portal.controller.js';
import { InsurerPortalRepository } from './insurer-portal.repository.js';
import { InsurersModule } from '../insurers/insurers.module.js';

@Module({
  imports: [InsurersModule],
  controllers: [InsurerPortalController],
  providers: [InsurerPortalService, InsurerPortalRepository, { provide: NCD_CODE_PICK, useValue: randomInt }],
})
export class InsurerPortalModule {}
