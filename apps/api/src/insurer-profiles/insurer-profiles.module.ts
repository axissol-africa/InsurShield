import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module.js';
import { InsurerProfilesController } from './insurer-profiles.controller.js';
import { InsurerProfilesRepository } from './insurer-profiles.repository.js';
import { InsurerProfilesService } from './insurer-profiles.service.js';

@Module({
  imports: [AuditModule],
  controllers: [InsurerProfilesController],
  providers: [InsurerProfilesRepository, InsurerProfilesService],
  exports: [InsurerProfilesService],
})
export class InsurerProfilesModule {}
