import { Controller, Headers, Inject, Logger, Post } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { connect, createServer, type AddressInfo, type Socket } from 'node:net';
import type { Pool, PoolClient } from 'pg';
import { Public } from '../src/common/auth/auth.guard.js';
import { ApiException } from '../src/common/errors/api.exception.js';
import { testDatabase } from '../src/config/env.js';
import { createDatabase, DATABASE, type Database } from '../src/db/database.module.js';
import * as schema from '../src/db/schema.js';
import { customers } from '../src/db/schema.js';
import { buildCustomer, unique } from './builders.js';
import { openTestDatabase, productionPool, RecordingLogger, startApp, until, type TestApp } from './helpers.js';

// Carried only by a lost connection's message: it must never be logged.
const SENTINEL = 'lost-connection-sentinel-91b2';

@Public()
@Controller('transaction-probe')
class TransactionProbeController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Post('sleep')
  async sleep(@Headers('x-probe-marker') marker: string) {
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('application_name', ${marker}, true)`);
      await tx.execute(sql`select pg_sleep(9)`);
    });
  }

  @Post('quick')
  async quick() {
    await this.db.transaction((tx) => tx.execute(sql`select 1`));
  }

  @Post('marked-query')
  async markedQuery(@Headers('x-probe-marker') marker: string) {
    await this.db.execute(sql`select ${marker}`);
  }

  @Post('marked-transaction')
  async markedTransaction(@Headers('x-probe-marker') marker: string) {
    await this.db.transaction((tx) => tx.execute(sql`select ${marker}`));
  }
}

function counts(pool: Pool) {
  return { total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount };
}

// Forwards to the test database until a connection sends the marker, then holds that connection open in silence.
// The marker is looked for in plain bytes, so the test database must be local and spoken to without TLS.
async function stallingProxy(marker: string): Promise<{ url: string; close(): Promise<void> }> {
  const target = new URL(testDatabase().url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)) {
    throw new Error('The stall test needs a test database on this machine.');
  }
  const sslmode = target.searchParams.get('sslmode') ?? process.env.PGSSLMODE ?? 'disable';
  if (sslmode !== 'disable' || target.searchParams.has('ssl')) {
    throw new Error('The stall test needs a test database spoken to without TLS.');
  }
  const sockets = new Set<Socket>();
  const server = createServer((downstream) => {
    const upstream = connect(Number(target.port || 5432), target.hostname);
    sockets.add(downstream).add(upstream);
    let stalled = false;
    let tail = Buffer.alloc(0);
    downstream.on('data', (chunk: Buffer) => {
      const seen = Buffer.concat([tail, chunk]);
      stalled ||= seen.includes(marker);
      tail = seen.subarray(Math.max(0, seen.length - marker.length + 1));
      if (!stalled) upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      if (!stalled) downstream.write(chunk);
    });
    for (const socket of [downstream, upstream]) {
      socket.on('error', () => undefined);
      socket.on('close', () => {
        downstream.destroy();
        upstream.destroy();
      });
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = new URL(target);
  url.hostname = '127.0.0.1';
  url.port = String((server.address() as AddressInfo).port);
  return {
    url: url.toString(),
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function lostConnection(): Error {
  return Object.assign(new Error(`connection lost ${SENTINEL}`), { code: 'ECONNRESET' });
}

function expectSanitised(text: string) {
  expect(text).not.toContain(SENTINEL);
  expect(text).not.toContain('Failed query');
  expect(text).not.toContain('params:');
  expect(text).not.toContain('    at ');
}

describe('a transaction whose backend is terminated mid-statement', () => {
  let testApp: TestApp;
  let logger: RecordingLogger;
  let pool: Pool;
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(async () => {
    pool = productionPool(testDatabase().url, 2);
    side = openTestDatabase();
    logger = new RecordingLogger();
    testApp = await startApp({
      controllers: [TransactionProbeController],
      logger,
      override: (builder) => builder.overrideProvider(DATABASE).useValue(createDatabase(pool, { schema })),
    });
  });

  afterAll(async () => {
    await testApp.close();
    await pool.end();
    await side.close();
  });

  it('answers 500, keeps the process up, leaks no client and logs no statement, parameter or stack', async () => {
    await testApp.http.post('/api/v1/transaction-probe/quick').expect(201);
    const start = counts(pool);
    logger.lines.length = 0;
    const marker = unique('terminated-marker');

    const pending = testApp.http.post('/api/v1/transaction-probe/sleep').set('x-probe-marker', marker).then((response) => response);
    const settled = Promise.allSettled([pending]);
    let pid: number | undefined;
    try {
      await until(async () => {
        const { rows } = await side.pool.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND wait_event = 'PgSleep'`,
          [marker],
        );
        pid = rows[0]?.pid;
        return pid !== undefined;
      }, 'the probe to sleep in the database');
      await side.pool.query('SELECT pg_terminate_backend($1)', [pid]);
    } finally {
      await settled;
    }
    const response = await pending;

    expect(response.status).toBe(500);
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String), details: null });
    await testApp.http.post('/api/v1/transaction-probe/quick').expect(201);
    expect(counts(pool)).toEqual(start);
    expect(logger.text).toContain('POST /api/v1/transaction-probe/sleep -> 500 INTERNAL_ERROR');
    expect(logger.text).toContain('connectionLost');
    expect(logger.text).not.toContain(marker);
    expect(logger.text).not.toContain('pg_sleep');
    expect(logger.text).not.toContain('set_config');
    expectSanitised(logger.text);
  });
});

describe('the production pool when the database stops answering mid-statement', () => {
  const marker = unique('stalled-marker');
  let proxy: Awaited<ReturnType<typeof stallingProxy>>;
  let pool: Pool;
  let poolEnded = false;
  let testApp: TestApp;
  let logger: RecordingLogger;

  beforeAll(async () => {
    proxy = await stallingProxy(marker);
    pool = productionPool(proxy.url, 2);
    logger = new RecordingLogger();
    testApp = await startApp({
      controllers: [TransactionProbeController],
      logger,
      override: (builder) => builder.overrideProvider(DATABASE).useValue(createDatabase(pool, { schema })),
    });
  });

  afterAll(async () => {
    await proxy.close();
    await testApp.close();
    if (!poolEnded) await pool.end();
  });

  it('answers a query and a transaction 500 after the read timeout, removes their clients and lets the pool end', async () => {
    const start = counts(pool);
    const began = Date.now();

    const responses = await Promise.all(
      ['marked-query', 'marked-transaction'].map((route) =>
        testApp.http.post(`/api/v1/transaction-probe/${route}`).set('x-probe-marker', marker).then((response) => response),
      ),
    );

    expect(Date.now() - began).toBeGreaterThan(10_000);
    for (const response of responses) {
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String), details: null });
      expect(response.headers['retry-after']).toBeUndefined();
    }
    expect(counts(pool)).toEqual(start);
    await pool.end();
    poolEnded = true;
    expect(logger.text).toContain('POST /api/v1/transaction-probe/marked-query -> 500 INTERNAL_ERROR');
    expect(logger.text).toContain('POST /api/v1/transaction-probe/marked-transaction -> 500 INTERNAL_ERROR');
    expect(logger.text).not.toContain(marker);
    expectSanitised(logger.text);
  });
});

describe('transactions on the API database', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await startApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('commits and rolls back savepoints inside a transaction', async () => {
    const customer = await buildCustomer(testApp.db);

    await testApp.db.transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.update(customers).set({ fullName: 'Kept Name' }).where(eq(customers.id, customer.id));
      });
      await tx
        .transaction(async (inner) => {
          await inner.update(customers).set({ fullName: 'Undone Name' }).where(eq(customers.id, customer.id));
          throw ApiException.conflict('UNDONE', 'Undone.');
        })
        .catch(() => undefined);
    });

    const [row] = await testApp.db.select().from(customers).where(eq(customers.id, customer.id));
    expect(row.fullName).toBe('Kept Name');
  });

  it('releases the client of a transaction whose BEGIN fails, so DATABASE.transaction is the module override', async () => {
    const pool = (testApp.db as Database & { $client: Pool }).$client;
    const bogus = { isolationLevel: 'bogus' } as unknown as Parameters<Database['transaction']>[1];

    await expect(testApp.db.transaction(async () => undefined, bogus)).rejects.toMatchObject({ cause: { code: '42601' } });

    expect(pool.waitingCount).toBe(0);
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});

describe("the production pool's clients when the connection is lost", () => {
  let pool: Pool;
  let side: ReturnType<typeof openTestDatabase>;
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeAll(() => {
    side = openTestDatabase();
  });

  afterAll(async () => {
    await side.close();
  });

  beforeEach(() => {
    pool = productionPool(testDatabase().url, 1);
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await pool.end();
  });

  function logged() {
    return JSON.stringify([...warn.mock.calls, ...error.mock.calls]);
  }

  it('logs only the code of an error with no query active', async () => {
    const client = await pool.connect();

    expect(() => client.emit('error', lostConnection())).not.toThrow();
    client.release();

    expect(warn).toHaveBeenCalledWith({ connectionLost: { code: 'ECONNRESET' } });
    expectSanitised(logged());
  });

  it('logs an error that comes before its checkout completes', async () => {
    const thrown = await new Promise<unknown>((resolve) =>
      pool.connect((failure, client, done) => {
        try {
          client!.emit('error', lostConnection());
          resolve(failure);
        } catch (emitted) {
          resolve(emitted);
        } finally {
          done();
        }
      }),
    );

    expect(thrown).toBeUndefined();
    expect(warn).toHaveBeenCalledWith({ connectionLost: { code: 'ECONNRESET' } });
    expectSanitised(logged());
  });

  it('logs a lost socket that errors before the running query is rejected, and rejects the query', async () => {
    const client: PoolClient = await pool.connect();
    const query = client.query('SELECT pg_sleep(5)');
    const socket = (client as unknown as { connection: { stream: { destroy(error: Error): void } } }).connection.stream;

    socket.destroy(lostConnection());
    const rejection: unknown = await query.catch((failure: unknown) => failure);
    client.release(rejection as Error);

    expect(rejection).toMatchObject({ code: 'ECONNRESET' });
    expect(warn).toHaveBeenCalledWith({ connectionLost: { code: 'ECONNRESET' } });
    expect(pool.totalCount).toBe(0);
    expectSanitised(logged());
  });

  it('logs an error after release and removes the client', async () => {
    const client = await pool.connect();
    client.release();

    expect(() => client.emit('error', lostConnection())).not.toThrow();

    expect(pool.totalCount).toBe(0);
    expect(warn).toHaveBeenCalledWith({ connectionLost: { code: 'ECONNRESET' } });
    expect(error).toHaveBeenCalledWith({ idleClient: { code: 'ECONNRESET' } });
    expectSanitised(logged());
  });

  it('removes a client whose backend is terminated while idle in the pool', async () => {
    const { rows } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
    expect(pool.idleCount).toBe(1);

    await side.pool.query('SELECT pg_terminate_backend($1)', [rows[0].pid]);
    await until(() => pool.totalCount === 0, 'the pool to drop the terminated client');

    expect(warn).toHaveBeenCalledWith({ connectionLost: { code: '57P01' } });
    expect(error).toHaveBeenCalledWith({ idleClient: { code: '57P01' } });
    const { rows: after } = await pool.query<{ one: number }>('SELECT 1 AS one');
    expect(after).toEqual([{ one: 1 }]);
    expectSanitised(logged());
  });
});
