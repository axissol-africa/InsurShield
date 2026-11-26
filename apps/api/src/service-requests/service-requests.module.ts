import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import {
  AdminServiceRequestsController,
  CustomerServiceRequestsController,
  InsurerServiceRequestsController,
} from './service-requests.controller.js';
import { ServiceRequestsRepository } from './service-requests.repository.js';
import { ServiceRequestsService } from './service-requests.service.js';

@Module({
  imports: [PaymentsModule],
  controllers: [CustomerServiceRequestsController, InsurerServiceRequestsController, AdminServiceRequestsController],
  providers: [ServiceRequestsService, ServiceRequestsRepository],
  exports: [ServiceRequestsService],
})
export class ServiceRequestsModule {}
