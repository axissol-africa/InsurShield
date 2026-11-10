import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { JobRunner, LEASE_MS } from '../src/jobs/job-runner.service.js';
import { JobsRepository } from '../src/jobs/jobs.repository.js';
import { BASE_BACKOFF_MS } from '../src/jobs/domain/backoff.js';
import { jobs } from '../src/db/schema.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';

/**
 * The runner's guarantees against real Postgres: the lease, the unique key and
 * `SKIP LOCKED` are database behaviour, and a fake transaction cannot show that
 * two runners do not take the same row.
 */
describe('the job runner', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let repository: JobsRepository;
  let runner: JobRunner;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    repository = testApp.app.get(JobsRepository);
    runner = testApp.app.get(JobRunner);
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  // `runOnce` claims whatever is due, up to its batch size, so rows left by an
  // earlier test can crowd out this one's. Every kind here is prefixed, so the
  // sweep cannot touch jobs a later spec enqueues through the real services.
  beforeEach(async () => {
    await side.db.delete(jobs).where(like(jobs.kind, 'test:%'));
  });

  const unique = () => `k-${randomUUID()}`;
  /** Claim runs in the caller's transaction, as the runner does. */
  /**
   * A limit far above anything a test creates. Other work is real now — a
   * notification and the idempotency purge both enqueue — so claiming a batch
   * of ten could fill with jobs this spec did not write and never reach its own.
   */
  const claim = (now: Date) => repository.transaction((tx) => repository.claim(tx, 500, LEASE_MS, now));
  const row = async (kind: string) => {
    const [found] = await side.db.select().from(jobs).where(eq(jobs.kind, kind));
    return found;
  };
  /** A kind nothing else claims, so parallel specs cannot steal this test's row. */
  const kindFor = (name: string) => `test:${name}:${randomUUID()}`;

  const enqueue = (kind: string, key = unique(), extra: Record<string, unknown> = {}) =>
    repository.transaction((tx) => repository.enqueue(tx, { kind, key, payload: { id: 'x' }, ...extra }));

  it('commits the job with the work it follows, and leaves none when that work fails', async () => {
    const kind = kindFor('atomic');
    const boom = new Error('the business write failed');

    await expect(
      repository.transaction(async (tx) => {
        await repository.enqueue(tx, { kind, key: unique(), payload: {} });
        throw boom;
      }),
    ).rejects.toBe(boom);

    expect(await row(kind)).toBeUndefined();
  });

  it('makes the same fact enqueued twice one row, without restarting the one in flight', async () => {
    const kind = kindFor('once');
    const key = unique();
    await enqueue(kind, key);
    const first = await row(kind);

    await enqueue(kind, key, { payload: { id: 'different' } });

    const after = await side.db.select().from(jobs).where(eq(jobs.kind, kind));
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.id);
    // The row in flight keeps its own payload: re-enqueueing is not an edit.
    expect(after[0].payload).toEqual({ id: 'x' });
  });

  it('leases what it claims and counts the attempt', async () => {
    const kind = kindFor('lease');
    await enqueue(kind);
    const now = new Date();

    const claimed = await claim(now);

    const mine = claimed.find((job) => job.kind === kind);
    expect(mine).toBeDefined();
    expect(mine?.status).toBe('RUNNING');
    expect(mine?.attempt).toBe(1);
    expect(mine?.leaseUntil?.getTime()).toBe(now.getTime() + LEASE_MS);
  });

  it('does not hand the same row to a second claim while the lease holds', async () => {
    const kind = kindFor('exclusive');
    await enqueue(kind);
    const now = new Date();

    const [first, second] = await Promise.all([
      claim(now),
      claim(now),
    ]);

    const taken = [...first, ...second].filter((job) => job.kind === kind);
    expect(taken).toHaveLength(1);
  });

  it('lets another runner claim work whose lease has passed, rather than stranding it', async () => {
    const kind = kindFor('expired');
    await enqueue(kind);
    const first = new Date();
    await claim(first);

    // The runner that held it died without releasing it.
    const afterLease = new Date(first.getTime() + LEASE_MS + 1_000);
    const retaken = await claim(afterLease);

    const mine = retaken.find((job) => job.kind === kind);
    expect(mine, 'the expired lease is claimable again').toBeDefined();
    // The earlier attempt is not forgotten, so a job that kills runners still gives up.
    expect(mine?.attempt).toBe(2);
  });

  it('retries a failing job with backoff, then gives up visibly', async () => {
    const kind = kindFor('failing');
    await enqueue(kind, unique(), { maxAttempts: 2 });
    runner.register(kind, () => Promise.reject(new Error('handler blew up')));
    const now = new Date();

    await runner.runOnce(now);
    const afterFirst = await row(kind);
    expect(afterFirst.status).toBe('PENDING');
    expect(afterFirst.runAfter.getTime()).toBe(now.getTime() + BASE_BACKOFF_MS);
    expect(afterFirst.lastError).toContain('handler blew up');

    const later = new Date(now.getTime() + BASE_BACKOFF_MS + 1_000);
    await runner.runOnce(later);
    const afterSecond = await row(kind);
    expect(afterSecond.status, 'the last allowed attempt ends FAILED, not PENDING').toBe('FAILED');
    expect(afterSecond.attempt).toBe(2);
  });

  it('marks a handled job done and stops claiming it', async () => {
    const kind = kindFor('done');
    await enqueue(kind);
    const handled: string[] = [];
    runner.register(kind, (job) => {
      handled.push(job.id);
      return Promise.resolve();
    });

    await runner.runOnce();
    const first = await row(kind);
    expect(first.status).toBe('DONE');
    expect(first.completedAt).not.toBeNull();

    await runner.runOnce(new Date(Date.now() + LEASE_MS + 1_000));
    expect(handled, 'a finished job is never handled twice').toHaveLength(1);
  });

  it('hands each job to one runner only, when two run at the same moment', async () => {
    // The guarantee lives in runOnce's lock, not in claim: claim alone was
    // green while the lock guarded a different connection than the claim it
    // was meant to protect, so this drives the path that carries the promise.
    const kind = kindFor('concurrent');
    const handled: string[] = [];
    runner.register(kind, (job) => {
      handled.push(job.id);
      return Promise.resolve();
    });
    for (let i = 0; i < 5; i += 1) await enqueue(kind);

    await Promise.all([runner.runOnce(), runner.runOnce(), runner.runOnce()]);

    expect(handled).toHaveLength(new Set(handled).size);
    const rows = await side.db.select().from(jobs).where(eq(jobs.kind, kind));
    expect(rows.every((job) => job.status === 'DONE'), 'every job ran exactly once').toBe(true);
    expect(rows.every((job) => job.attempt === 1), 'and none was claimed twice').toBe(true);
  });

  it('leaves a kind it has no handler for to another deployment, without burning it', async () => {
    const kind = kindFor('unowned');
    await enqueue(kind, unique(), { maxAttempts: 1 });

    await runner.runOnce();

    const after = await row(kind);
    // PENDING rather than FAILED: this runner cannot do it, but another may.
    expect(after.status).toBe('PENDING');
    expect(after.lastError).toContain('No handler');
  });
});
