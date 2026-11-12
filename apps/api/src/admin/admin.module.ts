import { Module } from '@nestjs/common';
import { AdminService } from './admin.service.js';
import { AdminController } from './admin.controller.js';
import { AdminRepository } from './admin.repository.js';
import { ApprovalsController } from './approvals.controller.js';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { InsurersModule } from '../insurers/insurers.module.js';
import { PiaModule } from '../pia/pia.module.js';

@Module({
  imports: [ApprovalsModule, InsurersModule, PiaModule],
  controllers: [AdminController, ApprovalsController],
  providers: [AdminService, AdminRepository],
})
export class AdminModule {}
