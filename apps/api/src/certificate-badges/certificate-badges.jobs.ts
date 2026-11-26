import { Injectable } from '@nestjs/common';
import { lusakaDay } from '../common/domain/lusaka.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { CertificateBadgesService } from './certificate-badges.service.js';

export const CERTIFICATE_BADGES_CALCULATE = 'certificate-badges.calculate';

@Injectable()
export class CertificateBadgesJobs {
  constructor(private readonly jobs: JobsRepository, private readonly badges: CertificateBadgesService) {}

  async schedule(now: Date): Promise<void> {
    await this.jobs.transaction((tx) => this.jobs.enqueue(tx, {
      kind: CERTIFICATE_BADGES_CALCULATE, key: lusakaDay(now), payload: {}, runAfter: now,
    }));
  }

  async run(now = new Date()): Promise<void> {
    // Queue tomorrow before calculation so exhausted retries cannot stop the daily chain.
    const next = new Date(`${lusakaDay(now)}T00:00:00+02:00`);
    next.setTime(next.getTime() + 86_400_000);
    await this.schedule(next);
    await this.badges.calculate(now);
  }
}
