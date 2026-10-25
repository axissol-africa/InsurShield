import { Module } from '@nestjs/common';
import { AccountRepository } from './account.repository.js';
import { AccountService } from './account.service.js';
import { ClaimsRepository } from './claims.repository.js';
import { ClaimsService } from './claims.service.js';
import { CustomerController } from './customer.controller.js';
import { NcdRepository } from './ncd.repository.js';
import { NcdService } from './ncd.service.js';
import { PoliciesRepository } from './policies.repository.js';
import { PoliciesService } from './policies.service.js';
import { QuoteRequestsRepository } from './quote-requests.repository.js';
import { QuoteRequestsService } from './quote-requests.service.js';

@Module({
  controllers: [CustomerController],
  providers: [
    QuoteRequestsService,
    QuoteRequestsRepository,
    PoliciesService,
    PoliciesRepository,
    ClaimsService,
    ClaimsRepository,
    NcdService,
    NcdRepository,
    AccountService,
    AccountRepository,
  ],
})
export class CustomerModule {}
