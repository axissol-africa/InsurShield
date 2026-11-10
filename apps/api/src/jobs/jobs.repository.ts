import { Inject, Injectable } from '@nestjs/common';
import { and, eq, lte, or, sql } from 'drizzle-orm';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { jobs } from '../db/schema.js';

export type JobRow = typeof jobs.$inferSelect;

export interface NewJob {
  kind: string;
  /** Stable for the fact this job is about: the same fact twice is one row. */
  key: string;
  payload: Record<string, unknown>;
  runAfter?: Date;
  maxAttempts?: number;
}

@Injectable()
export class JobsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /**
   * Takes the caller's transaction, so a job commits with the change it follows
   * or not at all. A fact already enqueued is left as it is rather than
   * duplicated or reset — re-enqueueing must not restart a job mid-flight.
   */
  async enqueue(tx: Transaction, job: NewJob): Promise<void> {
    await tx.insert(jobs).values(job).onConflictDoNothing({ target: [jobs.kind, jobs.key] });
  }

  /**
   * Claims up to `limit` jobs that are due, leasing each for `leaseMs`.
   *
   * `SKIP LOCKED` is what lets a second runner take different rows instead of
   * waiting behind this one. A row whose lease has passed is claimable again
   * even though it reads as RUNNING, which is how a runner that died without
   * releasing its work does not strand it.
   *
   * Runs in the caller's transaction, so the select and the update see one
   * snapshot and share the connection that holds the runner's lock. Taking a
   * second connection here would mean the lock guarded a different session
   * than the claim, and would hold two of the pool per tick.
   */
  async claim(tx: Transaction, limit: number, leaseMs: number, now: Date): Promise<JobRow[]> {
    const due = tx
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        or(
          and(eq(jobs.status, 'PENDING'), lte(jobs.runAfter, now)),
          and(eq(jobs.status, 'RUNNING'), lte(jobs.leaseUntil, now)),
        ),
      )
      .orderBy(jobs.runAfter)
      .limit(limit)
      .for('update', { skipLocked: true });

    const claimed = await tx
      .update(jobs)
      .set({
        status: 'RUNNING',
        leaseUntil: new Date(now.getTime() + leaseMs),
        attempt: sql`${jobs.attempt} + 1`,
      })
      .where(sql`${jobs.id} IN ${due}`)
      .returning();
    return claimed;
  }

  /** The job is finished. `completedAt` records when, for a later purge. */
  async succeed(id: string, now: Date): Promise<void> {
    await this.db
      .update(jobs)
      .set({ status: 'DONE', leaseUntil: null, lastError: null, completedAt: now })
      .where(eq(jobs.id, id));
  }

  /** Back to PENDING for another attempt, or FAILED and visible in the table. */
  async fail(id: string, { retryAt, error }: { retryAt: Date | null; error: string }): Promise<void> {
    await this.db
      .update(jobs)
      .set(
        retryAt
          ? { status: 'PENDING', runAfter: retryAt, leaseUntil: null, lastError: error }
          : { status: 'FAILED', leaseUntil: null, lastError: error },
      )
      .where(eq(jobs.id, id));
  }
}
