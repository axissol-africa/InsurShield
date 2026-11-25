import type { INestApplication } from '@nestjs/common';
import { JobRunner } from './jobs/job-runner.service.js';

/**
 * Starts the background work of a served application: status checks,
 * refunds, emails and deliveries all run off the job queue. Called once the
 * provider gate has passed and the port is open, so a deployment that is
 * about to be refused never does any of it.
 */
export function startServing(app: INestApplication): void {
  app.get(JobRunner).start();
}
