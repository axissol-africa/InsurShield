import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { Env } from '../config/env.js';
import { describeDatabaseError } from './errors.js';
import * as schema from './schema.js';

export const DATABASE = Symbol('DATABASE');
const POOL = Symbol('POOL');

export type Database = NodePgDatabase<typeof schema>;
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function createPool(config: ConfigService<Env, true>) {
  const pool = new Pool({
    connectionString: config.get('DATABASE_URL', { infer: true }),
    max: config.get('DATABASE_POOL_SIZE', { infer: true }),
    connectionTimeoutMillis: 5_000,
    // Timestamps and dates are read and written in UTC whatever the server's
    // settings; the timeouts stop a stuck transaction from holding its locks.
    options: '-c DateStyle=ISO -c TimeZone=UTC -c statement_timeout=10000 -c lock_timeout=5000',
  });
  const logger = new Logger('Database');
  pool.on('error', (error) => logger.error({ idleClient: describeDatabaseError(error) }));
  return pool;
}

@Global()
@Module({
  providers: [
    { provide: POOL, inject: [ConfigService], useFactory: createPool },
    {
      provide: DATABASE,
      inject: [POOL],
      useFactory: (pool: Pool): Database => drizzle(pool, { schema }),
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
