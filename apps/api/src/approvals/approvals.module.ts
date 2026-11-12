import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module.js';
import { ApprovalsRepository } from './approval.repository.js';
import { ApprovalService } from './approval.service.js';

@Module({
  imports: [AuditModule],
  providers: [ApprovalsRepository, ApprovalService],
  exports: [ApprovalService],
})
export class ApprovalsModule {}
