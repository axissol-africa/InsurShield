import { Injectable, Logger } from '@nestjs/common';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { QuoteRequestDraftsRepository } from './quote-request-drafts.repository.js';

export const QUOTE_REQUEST_DRAFT_PURGE = 'quote-request-draft.purge';
export const DRAFT_PURGE_INTERVAL_MS = 60 * 60_000;
export const DRAFT_PURGE_BATCH = 5_000;

/** One durable fact per hour: a restart cannot enqueue duplicate retention work. */
export function quoteRequestDraftPurgeKey(at: Date): string {
  return at.toISOString().slice(0, 13);
}

@Injectable()
export class QuoteRequestDraftPurge {
  private readonly logger = new Logger(QuoteRequestDraftPurge.name);

  constructor(
    private readonly repository: QuoteRequestDraftsRepository,
    private readonly jobs: JobsRepository,
  ) {}

  async schedule(at: Date): Promise<void> {
    await this.jobs.transaction((tx) =>
      this.jobs.enqueue(tx, {
        kind: QUOTE_REQUEST_DRAFT_PURGE,
        key: quoteRequestDraftPurgeKey(at),
        payload: {},
        runAfter: at,
      }),
    );
  }

  async run(now = new Date()): Promise<void> {
    await this.schedule(new Date(now.getTime() + DRAFT_PURGE_INTERVAL_MS));
    const purged = await this.repository.purgeExpired(now, DRAFT_PURGE_BATCH);
    if (purged > 0) this.logger.log(`Purged ${purged} expired quote request drafts`);
    if (purged === DRAFT_PURGE_BATCH) await this.schedule(now);
  }
}
