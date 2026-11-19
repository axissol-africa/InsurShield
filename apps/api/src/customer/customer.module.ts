import { Module, type OnModuleInit } from '@nestjs/common';
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
import { QuoteAvailabilityService } from './quote-availability.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { JobRunner } from '../jobs/job-runner.service.js';
import { QuoteRequestDraftsController } from './quote-request-drafts.controller.js';
import { QuoteRequestDraftPurge, QUOTE_REQUEST_DRAFT_PURGE } from './quote-request-draft-purge.js';
import { QuoteRequestDraftsRepository } from './quote-request-drafts.repository.js';
import { QuoteRequestDraftsService } from './quote-request-drafts.service.js';

@Module({
  controllers: [CustomerController, QuoteRequestDraftsController],
  providers: [
    QuoteRequestsService,
    QuoteRequestsRepository,
    QuoteAvailabilityService,
    PoliciesService,
    PoliciesRepository,
    ClaimsService,
    ClaimsRepository,
    NcdService,
    NcdRepository,
    AccountService,
    AccountRepository,
    IdempotencyService,
    QuoteRequestDraftsService,
    QuoteRequestDraftsRepository,
    QuoteRequestDraftPurge,
  ],
  exports: [QuoteAvailabilityService],
})
export class CustomerModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly draftPurge: QuoteRequestDraftPurge,
  ) {}

  onModuleInit(): void {
    this.runner.register(QUOTE_REQUEST_DRAFT_PURGE, () => this.draftPurge.run());
    this.runner.onStart(() => this.draftPurge.schedule(new Date()));
  }
}
