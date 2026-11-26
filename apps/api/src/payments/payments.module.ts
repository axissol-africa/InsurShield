import { Module, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProviderRegistry } from '../common/providers/provider-registry.js';
import type { Env } from '../config/env.js';
import { JobRunner } from '../jobs/job-runner.service.js';
import { ApprovalsModule } from '../approvals/approvals.module.js';
import { InspectionsModule } from '../inspections/inspections.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { ReconciliationController } from './reconciliation.controller.js';
import { ReconciliationService } from './reconciliation.service.js';
import { StatementsService } from './statements.service.js';
import { RefundsRepository } from './refunds.repository.js';
import { REFUND_SUBMIT, RefundsService } from './refunds.service.js';
import { ISSUANCE_OVERDUE_CHECK, IssuanceJobs } from './issuance-jobs.js';
import { PaymentEventsService } from './payment-events.service.js';
import { PAYMENT_PROVIDER_CANCEL, PAYMENT_STATUS_CHECK, PaymentJobs } from './payment-jobs.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsRepository } from './payments.repository.js';
import { PaymentsService } from './payments.service.js';
import { PAYMENT_PROVIDER } from './provider/payment-provider.js';
import { StandInPaymentController } from './provider/stand-in.controller.js';
import { StandInPaymentProvider } from './provider/stand-in-payment-provider.js';

@Module({
  imports: [SettingsModule, ApprovalsModule, InspectionsModule],
  controllers: [PaymentsController, StandInPaymentController, ReconciliationController],
  providers: [
    PaymentsService,
    PaymentsRepository,
    PaymentEventsService,
    PaymentJobs,
    IssuanceJobs,
    RefundsRepository,
    RefundsService,
    ReconciliationService,
    StatementsService,
    StandInPaymentProvider,
    // Only the stand-in exists until DEC-008 names the providers; PAYMENT_PROVIDER selects among them.
    { provide: PAYMENT_PROVIDER, useExisting: StandInPaymentProvider },
  ],
  exports: [PAYMENT_PROVIDER, RefundsService, RefundsRepository],
})
export class PaymentsModule implements OnModuleInit {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly config: ConfigService<Env, true>,
    private readonly runner: JobRunner,
    private readonly jobs: PaymentJobs,
    private readonly issuance: IssuanceJobs,
    private readonly refunds: RefundsService,
  ) {}

  onModuleInit(): void {
    // The stand-in is the only adapter, so production refuses to start until a live one is configured.
    this.registry.register({
      name: 'payment-provider',
      mode: this.config.get('PAYMENT_PROVIDER', { infer: true }) === 'stand-in' ? 'stand-in' : 'live',
      setting: 'PAYMENT_PROVIDER',
    });
    this.runner.register(PAYMENT_STATUS_CHECK, async () => {
      await this.jobs.checkOpen();
    });
    this.runner.onStart(() => this.jobs.schedule(new Date()));
    this.runner.register(PAYMENT_PROVIDER_CANCEL, (job) => this.jobs.cancelAtProvider(job.key));
    this.runner.register(ISSUANCE_OVERDUE_CHECK, async () => {
      await this.issuance.flagOverdue();
    });
    this.runner.onStart(() => this.issuance.schedule(new Date()));
    this.runner.register(REFUND_SUBMIT, (job) => this.refunds.submit(job.key));
  }
}
