import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../../db/database.module.js';
import { JobsRepository } from '../../jobs/jobs.repository.js';
import { idempotencyRecords } from '../../db/schema.js';

export const IDEMPOTENCY_PURGE = 'idempotency.purge';

/** Hourly. The records live a day, so this is frequent enough to keep the table small. */
export const PURGE_INTERVAL_MS = 60 * 60_000;

/** Bounded, so a long-neglected table is cleared over several runs rather than in one long lock. */
export const PURGE_BATCH = 5_000;

/** The hour a run belongs to, which is what makes the job unique for that hour. */
export function purgeKey(at: Date): string {
  return at.toISOString().slice(0, 13);
}

@Injectable()
export class IdempotencyPurge {
  private readonly logger = new Logger(IdempotencyPurge.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobsRepository,
  ) {}

  /**
   * Schedules the run for an hour. The key is that hour, so enqueueing twice —
   * at start-up and again from the previous run — is one job rather than two.
   * There is no scheduler: the work schedules its own successor, and start-up
   * covers a deployment that was down when the last one should have run.
   */
  async schedule(at: Date): Promise<void> {
    await this.jobs.transaction((tx) =>
      this.jobs.enqueue(tx, {
        kind: IDEMPOTENCY_PURGE,
        key: purgeKey(at),
        payload: {},
        runAfter: at,
      }),
    );
  }

  /**
   * Deletes records whose window has passed, then schedules the next hour.
   *
   * The next run is scheduled first: if the delete fails the job is retried,
   * and a retry must not be the only thing keeping the schedule alive.
   */
  async run(now = new Date()): Promise<void> {
    await this.schedule(new Date(now.getTime() + PURGE_INTERVAL_MS));

    // Bounded by ctid, because the table's key is composite and a LIMIT needs
    // something single to match on. An unbounded delete on a table nobody has
    // purged for months would hold its locks for as long as it took.
    const { rowCount } = await this.db.execute(sql`
      DELETE FROM ${idempotencyRecords} WHERE ctid IN (
        SELECT ctid FROM ${idempotencyRecords}
        WHERE ${idempotencyRecords.expiresAt} <= ${now}
        LIMIT ${PURGE_BATCH}
      )
    `);

    const purged = rowCount ?? 0;
    if (purged > 0) this.logger.log(`Purged ${purged} expired idempotency records`);
    // A full batch means there is more waiting. Draining it on the next tick
    // beats leaving a backlog to the hour.
    if (purged === PURGE_BATCH) await this.schedule(now);
  }
}
