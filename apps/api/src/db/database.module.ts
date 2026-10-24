import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DrizzleConfig } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import { Client, Pool, type ClientConfig, type PoolClient } from 'pg';
import type { Env } from '../config/env.js';
import { DatabaseConnectionError, describeDatabaseError, isDatabaseError } from './errors.js';
import * as schema from './schema.js';

export const DATABASE = Symbol('DATABASE');
const POOL = Symbol('POOL');

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

type DatabaseOptions = DrizzleConfig<typeof schema>;

type ConnectCallback = (error: Error | undefined, client: PoolClient | undefined, done: (release?: unknown) => void) => void;

// Drizzle takes a transaction's client outside its query wrapper, so a failure to get one is marked here.
class ConnectionMarkingPool extends Pool {
  connect(): Promise<PoolClient>;
  connect(callback: ConnectCallback): void;
  connect(callback?: ConnectCallback): Promise<PoolClient> | void {
    if (!callback) {
      return super.connect().catch((error: unknown) => {
        throw new DatabaseConnectionError(error);
      });
    }
    super.connect((error, client, done) =>
      callback(error ? new DatabaseConnectionError(error) : error, client, done),
    );
  }
}

const logger = new Logger('Database');

// A lost connection emits 'error' on its client at any moment of its life, which would end the process with no listener.
class GuardedClient extends Client {
  constructor(config?: ClientConfig) {
    super(config);
    this.on('error', (error) => logger.warn({ connectionLost: describeDatabaseError(error) }));
  }
}

const STATEMENT_TIMEOUT_MS = 10_000;
// Later than the server's own cancellation, so it fires only when a connection has stopped answering.
const QUERY_TIMEOUT_MS = STATEMENT_TIMEOUT_MS + 5_000;

export function createPool(config: ConfigService<Env, true>): Pool {
  const pool = new ConnectionMarkingPool({
    Client: GuardedClient,
    connectionString: config.get('DATABASE_URL', { infer: true }),
    max: config.get('DATABASE_POOL_SIZE', { infer: true }),
    connectionTimeoutMillis: 5_000,
    query_timeout: QUERY_TIMEOUT_MS,
    keepAlive: true,
    // The operating system's default waits about two hours before the first probe.
    keepAliveInitialDelayMillis: 10_000,
    // Timestamps and dates are read and written in UTC whatever the server's
    // settings; the timeouts stop a stuck transaction from holding its locks.
    options: `-c DateStyle=ISO -c TimeZone=UTC -c statement_timeout=${STATEMENT_TIMEOUT_MS} -c lock_timeout=5000`,
  });
  pool.on('error', (error) => logger.error({ idleClient: describeDatabaseError(error) }));
  return pool;
}

// Drizzle's own pool transaction sends BEGIN before the code that releases its client.
async function runTransaction<T>(
  pool: Pool,
  options: DatabaseOptions,
  work: (tx: Transaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    return await drizzle(client, options).transaction(work, config);
  } catch (error) {
    // The client may be broken or still in the failed transaction, so the pool discards it.
    if (isDatabaseError(error)) failure = error as Error;
    throw error;
  } finally {
    client.release(failure);
  }
}

export function createDatabase(pool: Pool, options: DatabaseOptions): Database {
  const db = drizzle(pool, options);
  db.transaction = (work, config) => runTransaction(pool, options, work, config);
  return db;
}

@Global()
@Module({
  providers: [
    { provide: POOL, inject: [ConfigService], useFactory: createPool },
    {
      provide: DATABASE,
      inject: [POOL],
      useFactory: (pool: Pool) => createDatabase(pool, { schema }),
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
