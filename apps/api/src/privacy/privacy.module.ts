import { Module, type OnModuleInit } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module.js';
import { InspectionsModule } from '../inspections/inspections.module.js';
import { JobRunner } from '../jobs/job-runner.service.js';
import { ServiceRequestsModule } from '../service-requests/service-requests.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DataExportService } from './data-export.service.js';
import { DATA_RETENTION, DataRetention } from './data-retention.js';
import { PrivacyController } from './privacy.controller.js';
import { PrivacyRepository } from './privacy.repository.js';

/** The data lifecycle: a customer's export, and retention applied every day. */
@Module({
  imports: [CustomerModule, InspectionsModule, ServiceRequestsModule, SettingsModule],
  controllers: [PrivacyController],
  providers: [PrivacyRepository, DataExportService, DataRetention],
  exports: [DataRetention],
})
export class PrivacyModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly retention: DataRetention,
  ) {}

  onModuleInit(): void {
    this.runner.register(DATA_RETENTION, async () => {
      await this.retention.run();
    });
    this.runner.onStart(() => this.retention.schedule(new Date()));
  }
}
