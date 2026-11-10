import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { JobRunner } from '../../jobs/job-runner.service.js';
import { IDEMPOTENCY_PURGE, IdempotencyPurge } from './idempotency-purge.js';
import { IdempotencyService } from './idempotency.service.js';

@Global()
@Module({
  providers: [IdempotencyService, IdempotencyPurge],
  exports: [IdempotencyService, IdempotencyPurge],
})
export class IdempotencyModule implements OnModuleInit {
  constructor(
    private readonly runner: JobRunner,
    private readonly purge: IdempotencyPurge,
  ) {}

  /**
   * Registers the handler and puts the first run on the queue. The job's key is
   * its hour, so a deployment that restarts twice in one hour schedules one run,
   * and one that was down when an hour passed picks it up on the way back.
   */
  onModuleInit(): void {
    this.runner.register(IDEMPOTENCY_PURGE, () => this.purge.run());
    // Queued when the runner starts, not here: module init does no database work.
    this.runner.onStart(() => this.purge.schedule(new Date()));
  }
}
