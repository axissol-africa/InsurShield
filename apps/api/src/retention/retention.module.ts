import { Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../jobs/job-runner.service.js';
import { SettingsModule } from '../settings/settings.module.js';
import { RetentionRepository } from './retention.repository.js';
import { RETENTION_SWEEP, RetentionService } from './retention.service.js';

@Module({
  imports: [SettingsModule],
  providers: [RetentionRepository, RetentionService],
})
export class RetentionModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly retention: RetentionService,
  ) {}

  onModuleInit(): void {
    this.runner.register(RETENTION_SWEEP, () => this.retention.run());
    this.runner.onStart(() => this.retention.schedule(new Date()));
  }
}
