import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module.js';
import { AdminReportingController, InsurerReportingController } from './reporting.controller.js';
import { ReportingRepository } from './reporting.repository.js';
import { ReportingService } from './reporting.service.js';

@Module({
  imports: [AuditModule],
  controllers: [AdminReportingController, InsurerReportingController],
  providers: [ReportingRepository, ReportingService],
})
export class ReportingModule {}
