import { Module } from '@nestjs/common';
import { InsurersService } from './insurers.service.js';
import { InsurersController } from './insurers.controller.js';
import { InsurersRepository } from './insurers.repository.js';
import { CustomerModule } from '../customer/customer.module.js';
import { ApprovalsModule } from '../approvals/approvals.module.js';

@Module({
  imports: [CustomerModule, ApprovalsModule],
  controllers: [InsurersController],
  providers: [InsurersService, InsurersRepository],
  exports: [InsurersService],
})
export class InsurersModule {}
