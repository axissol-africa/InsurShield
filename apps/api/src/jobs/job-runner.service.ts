import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DATABASE, type Database } from '../db/database.module.js';
import { isExhausted, nextRunAfter } from './domain/backoff.js';
import { JobsRepository, type JobRow } from './jobs.repository.js';

/** What a kind of job does. Registered by the module that owns that kind. */
export type JobHandler = (job: JobRow) => Promise<void>;

/** Only one instance polls; the number is arbitrary but must not change. */
const RUNNER_LOCK = 8_314_027_551_120_443n;

export const JOB_BATCH = 10;
export const LEASE_MS = 2 * 60_000;
const IDLE_MS = 5_000;

@Injectable()
export class JobRunner {
  private readonly logger = new Logger(JobRunner.name);
  private readonly handlers = new Map<string, JobHandler>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private draining: Promise<void> = Promise.resolve();
  private readonly starting: Array<() => Promise<void>> = [];

  constructor(
    private readonly jobs: JobsRepository,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** A kind with no handler is left alone rather than failed: its module may not be loaded. */
  register(kind: string, handler: JobHandler): void {
    this.handlers.set(kind, handler);
  }

  /**
   * Work to do once, when the runner starts.
   *
   * Recurring jobs put their first occurrence on the queue here rather than at
   * module init: initialising a module should not touch the database. Doing so
   * opens a connection at an unpredictable moment, which is visible to anything
   * watching the pool and is a database write on a deployment the provider gate
   * may be about to refuse.
   */
  onStart(work: () => Promise<void>): void {
    this.starting.push(work);
  }

  /**
   * Started after the provider gate has passed and the port is open, never at
   * module init: `main.ts` runs the gate after `app.init()` and closes the app
   * when it trips, so a runner started earlier would be doing work on a
   * deployment that is about to be refused.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const work of this.starting) {
      void work().catch((error: unknown) => this.logger.error(`Start-up job failed: ${String(error)}`));
    }
    const tick = async () => {
      if (!this.running) return;
      this.draining = this.runOnce()
        .then(() => undefined)
        .catch((error: unknown) => this.logger.error(`Job tick failed: ${String(error)}`))
        .finally(() => {
          if (this.running) this.timer = setTimeout(() => void tick(), IDLE_MS);
        });
    };
    void tick();
  }

  /** Lets the batch in hand finish, so a shutdown does not abandon leased work. */
  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    await this.draining;
  }

  /**
   * One pass. Returns how many jobs were handled, so a test can drive the
   * runner directly instead of waiting on the timer.
   */
  async runOnce(now = new Date()): Promise<number> {
    const claimed = await this.claimUnderLock(now);
    for (const job of claimed) await this.handle(job, now);
    return claimed.length;
  }

  /**
   * The lock is transaction-scoped, so it is released when this statement's
   * transaction ends and a runner that dies cannot hold it. A session-level
   * lock would outlive the work and `AGENTS.md` forbids managing the
   * connection it would need.
   */
  private async claimUnderLock(now: Date): Promise<JobRow[]> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.execute<{ taken: boolean }>(
        sql`SELECT pg_catalog.pg_try_advisory_xact_lock(${RUNNER_LOCK}) AS taken`,
      );
      if (!rows[0]?.taken) return [];
      return this.jobs.claim(tx, JOB_BATCH, LEASE_MS, now);
    });
  }

  private async handle(job: JobRow, now: Date): Promise<void> {
    const handler = this.handlers.get(job.kind);
    if (!handler) {
      // Not a failure: another deployment may own this kind. Left for it to
      // claim rather than burning an attempt on a runner that cannot do it.
      await this.jobs.fail(job.id, { retryAt: nextRunAfter(job.attempt, now), error: `No handler for ${job.kind}` });
      return;
    }
    try {
      await handler(job);
      await this.jobs.succeed(job.id, now);
    } catch (error: unknown) {
      const exhausted = isExhausted(job.attempt, job.maxAttempts);
      await this.jobs.fail(job.id, {
        retryAt: exhausted ? null : nextRunAfter(job.attempt, now),
        error: String(error),
      });
      if (exhausted) this.logger.error(`Job ${job.kind} gave up after ${job.attempt} attempts: ${String(error)}`);
    }
  }
}
