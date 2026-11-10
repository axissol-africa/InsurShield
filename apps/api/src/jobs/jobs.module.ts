import { Global, Module } from '@nestjs/common';
import { JobRunner } from './job-runner.service.js';
import { JobsRepository } from './jobs.repository.js';

/**
 * Global so any module can enqueue in its own transaction without importing a
 * chain of modules to reach the repository.
 */
@Global()
@Module({
  providers: [JobsRepository, JobRunner],
  exports: [JobsRepository, JobRunner],
})
export class JobsModule {}
