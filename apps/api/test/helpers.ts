import type { INestApplication, LoggerService, Provider, Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool, type PoolClient } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { appSettings, configureApp, type AppSettings } from '../src/app.setup.js';
import type { Env } from '../src/config/env.js';
import { testDatabase } from '../src/config/env.js';
import { createDatabase, createPool, DATABASE, type Database } from '../src/db/database.module.js';
import * as schema from '../src/db/schema.js';
import { StorageService } from '../src/storage/storage.service.js';
import { StorageFake } from './storage-fake.js';

export type Http = ReturnType<typeof request>;

export interface StartOptions {
  /** Replaces the settings `configureApp` reads from the environment. */
  settings?: Partial<AppSettings>;
  /** Test-only controllers and their providers, registered in the testing module. */
  controllers?: Type<unknown>[];
  providers?: Provider[];
  logger?: LoggerService;
  /** Further `overrideProvider` calls on the testing module. */
  override?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
}

export interface TestApp {
  app: INestApplication;
  http: Http;
  /** The app's own Drizzle handle, on the test database. */
  db: Database;
  storage: StorageFake;
  close(): Promise<void>;
}

/** The API as `main.ts` configures it, on a random local port, with storage in memory. */
export async function startApp(options: StartOptions = {}): Promise<TestApp> {
  const storage = new StorageFake();
  let builder = Test.createTestingModule({
    imports: [AppModule],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
  })
    .overrideProvider(StorageService)
    .useValue(storage);
  if (options.override) builder = options.override(builder);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  if (options.logger) app.useLogger(options.logger);
  configureApp(app, { ...appSettings(app.get(ConfigService<Env, true>)), ...options.settings });
  await app.listen(0, '127.0.0.1');

  return {
    app,
    http: request(app.getHttpServer()),
    db: app.get<Database>(DATABASE),
    storage,
    close: () => app.close(),
  };
}

/** A Drizzle handle on the test database for specs that need no app. */
export function openTestDatabase(): { db: Database; pool: Pool; close(): Promise<void> } {
  const pool = new Pool({ connectionString: testDatabase().url, max: 4 });
  return { db: createDatabase(pool, { schema }), pool, close: () => pool.end() };
}

/** A pool made by the API's own factory, on any database and of any size. */
export function productionPool(connectionString: string, poolSize: number): Pool {
  const settings: Pick<Env, 'DATABASE_URL' | 'DATABASE_POOL_SIZE'> = {
    DATABASE_URL: connectionString,
    DATABASE_POOL_SIZE: poolSize,
  };
  const config = { get: (key: keyof typeof settings) => settings[key] };
  return createPool(config as unknown as ConfigService<Env, true>);
}

/** The app on its own production pool whose sessions default to REPEATABLE READ, as a server or role set so would. */
export async function startRepeatableReadApp(poolSize: number): Promise<TestApp> {
  const pool = productionPool(testDatabase().url, poolSize);
  (pool as Pool & { options: { options: string } }).options.options +=
    String.raw` -c default_transaction_isolation=repeatable\ read`;
  const { rows } = await pool.query<{ level: string }>(`SELECT current_setting('default_transaction_isolation') AS level`);
  if (rows[0].level !== 'repeatable read') throw new Error(`The pool's sessions default to ${rows[0].level}`);
  const testApp = await startApp({
    override: (builder) => builder.overrideProvider(DATABASE).useValue(createDatabase(pool, { schema })),
  });
  return {
    ...testApp,
    async close() {
      try {
        await testApp.close();
      } finally {
        await pool.end();
      }
    },
  };
}

/** Polls `condition` every 50 ms until it holds, failing after 15 s with what was awaited. */
export async function until(condition: () => Promise<boolean> | boolean, what: string): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export interface HeldLocks {
  /** Backends queued behind the holder, directly or behind another waiter, in a statement like `statement`. */
  waiters(statement: string): Promise<number>;
  /** Runs another statement inside the holding transaction. */
  run(statement: string, values?: unknown[]): Promise<unknown>;
  release(): Promise<void>;
}

/**
 * A side transaction on its own connection from `pool` that keeps the locks `work` takes until `release`. Waiters
 * are counted by statement, so a leftover from another test is not counted.
 */
export async function holdLocks(
  pool: Pool,
  work: (db: Database, client: PoolClient) => Promise<unknown>,
): Promise<HeldLocks> {
  const client = await pool.connect();
  let holder: number;
  try {
    await client.query('BEGIN');
    holder = (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await work(drizzle(client, { schema }), client);
  } catch (error) {
    client.release(error as Error);
    throw error;
  }
  return {
    async waiters(statement) {
      const result = await pool.query<{ count: string }>(
        `WITH RECURSIVE queued AS (
           SELECT pid FROM pg_stat_activity WHERE $1::int = ANY (pg_blocking_pids(pid))
           UNION
           SELECT a.pid FROM pg_stat_activity a JOIN queued q ON q.pid = ANY (pg_blocking_pids(a.pid))
         )
         SELECT count(*) FROM queued JOIN pg_stat_activity a USING (pid)
          WHERE a.wait_event_type = 'Lock' AND a.query ILIKE $2`,
        [holder, statement],
      );
      return Number(result.rows[0].count);
    },
    run: (statement, values) => client.query(statement, values),
    async release() {
      try {
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    },
  };
}

/** Starts `calls` behind `held`, commits it once `queued` of them wait in `statement`, and answers every response. */
export async function queueBehind<T>(
  held: HeldLocks,
  statement: string,
  queued: number,
  calls: (() => Promise<T>)[],
): Promise<T[]> {
  const requests = calls.map((call) => call());
  const settled = Promise.allSettled(requests);
  try {
    await until(async () => (await held.waiters(statement)) === queued, `${queued} requests to wait in ${statement}`);
  } finally {
    try {
      await held.release();
    } finally {
      await settled;
    }
  }
  return Promise.all(requests);
}

/** Records every log line so a spec can check what the server wrote. */
export class RecordingLogger implements LoggerService {
  readonly lines: string[] = [];

  log(...parts: unknown[]) {
    this.record('log', parts);
  }
  error(...parts: unknown[]) {
    this.record('error', parts);
  }
  warn(...parts: unknown[]) {
    this.record('warn', parts);
  }
  debug(...parts: unknown[]) {
    this.record('debug', parts);
  }
  verbose(...parts: unknown[]) {
    this.record('verbose', parts);
  }
  fatal(...parts: unknown[]) {
    this.record('fatal', parts);
  }

  get text(): string {
    return this.lines.join('\n');
  }

  private record(level: string, parts: unknown[]) {
    const text = parts.map((part) =>
      part instanceof Error ? `${part.message}\n${part.stack ?? ''}` : typeof part === 'string' ? part : JSON.stringify(part),
    );
    this.lines.push(`${level} ${text.join(' ')}`);
  }
}
