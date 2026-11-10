import { randomUUID } from 'node:crypto';
import { and, eq, lte } from 'drizzle-orm';
import { idempotencyRecords, jobs } from '../src/db/schema.js';
import {
  IDEMPOTENCY_PURGE,
  IdempotencyPurge,
  PURGE_INTERVAL_MS,
  purgeKey,
} from '../src/common/idempotency/idempotency-purge.js';
import { IdempotencyService } from '../src/common/idempotency/idempotency.service.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';

describe('the idempotency purge', () => {
  let testApp: TestApp;
  let side: ReturnType<typeof openTestDatabase>;
  let purge: IdempotencyPurge;

  beforeAll(async () => {
    testApp = await startApp();
    side = openTestDatabase();
    purge = testApp.app.get(IdempotencyPurge);
  });

  afterAll(async () => {
    await testApp.close();
    await side.close();
  });

  const record = async (expiresAt: Date) => {
    const key = `purge-${randomUUID()}`;
    await side.db.insert(idempotencyRecords).values({
      callerId: `caller-${randomUUID()}`,
      endpoint: 'POST /test',
      key,
      requestHash: 'hash',
      expiresAt,
    });
    return key;
  };

  const exists = async (key: string) =>
    (await side.db.select({ key: idempotencyRecords.key }).from(idempotencyRecords).where(eq(idempotencyRecords.key, key)))
      .length > 0;

  it('deletes a record whose window has passed and keeps one still inside it', async () => {
    const now = new Date();
    const expired = await record(new Date(now.getTime() - 60_000));
    const live = await record(new Date(now.getTime() + 60 * 60_000));

    await purge.run(now);

    expect(await exists(expired), 'the expired record is gone').toBe(false);
    expect(await exists(live), 'the unexpired one is untouched').toBe(true);
  });

  it('keeps a record expiring exactly now out of the live set, rather than leaving it forever', async () => {
    const now = new Date();
    const boundary = await record(now);

    await purge.run(now);

    expect(await exists(boundary)).toBe(false);
  });

  it('schedules the next hour, and twice in one hour is one job', async () => {
    // Far from any hour a run against the real clock would schedule: the other
    // cases here call run() with `new Date()`, which queues now + 1h, and a
    // suite running in that hour would otherwise collide with this key.
    const at = new Date('2031-03-04T05:00:00.000Z');

    await purge.schedule(at);
    await purge.schedule(at);

    const queued = await side.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, IDEMPOTENCY_PURGE), eq(jobs.key, purgeKey(at))));
    expect(queued, 'the hour is the key, so the second enqueue is a no-op').toHaveLength(1);
    expect(queued[0].runAfter.toISOString()).toBe(at.toISOString());
  });

  it('leaves its successor on the queue after a run, so the schedule survives', async () => {
    const now = new Date('2031-03-04T20:00:00.000Z');

    await purge.run(now);

    const next = purgeKey(new Date(now.getTime() + PURGE_INTERVAL_MS));
    const queued = await side.db
      .select()
      .from(jobs)
      .where(and(eq(jobs.kind, IDEMPOTENCY_PURGE), eq(jobs.key, next)));
    expect(queued, 'the work schedules its own successor; nothing else would').toHaveLength(1);
  });

  it('stops replaying a key whose window has passed, whether or not the purge has reached it', async () => {
    // `expiresAt` was written from the first release and never read, so a
    // day-old key still returned its stored answer. The window now means
    // something on read as well as to the purge: otherwise a key's behaviour
    // would depend on whether the purge happened to have run, which is a bug
    // report nobody can reproduce.
    const service = testApp.app.get(IdempotencyService);
    const callerId = `caller-${randomUUID()}`;
    const key = `replay-${randomUUID()}`;
    const request = { amount: 1 };
    let ran = 0;
    const run = () =>
      service.execute(callerId, 'POST /test', key, request, () => {
        ran += 1;
        return Promise.resolve({ attempt: ran });
      });

    const first = await run();
    const replay = await run();
    expect(replay.replayed, 'inside the window it replays').toBe(true);
    expect(replay.value).toEqual(first.value);
    expect(ran).toBe(1);

    // The record outlives its window without the purge having touched it.
    await side.db
      .update(idempotencyRecords)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(and(eq(idempotencyRecords.callerId, callerId), eq(idempotencyRecords.key, key)));

    const afterExpiry = await run();
    expect(afterExpiry.replayed, 'past it the work runs again').toBe(false);
    expect(ran).toBe(2);
    expect(afterExpiry.value).toEqual({ attempt: 2 });
  });

  it('leaves nothing expired behind when it has run', async () => {
    const now = new Date();
    await record(new Date(now.getTime() - 5_000));

    await purge.run(now);

    const remaining = await side.db
      .select({ key: idempotencyRecords.key })
      .from(idempotencyRecords)
      .where(lte(idempotencyRecords.expiresAt, now));
    expect(remaining).toEqual([]);
  });
});
