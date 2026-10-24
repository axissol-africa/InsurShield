import { DrizzleQueryError, sql } from 'drizzle-orm';
import type { ConfigService } from '@nestjs/config';
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.js';
import { createDatabase, createPool } from './database.module.js';
import { DatabaseConnectionError } from './errors.js';
import * as schema from './schema.js';

type Statement = 'begin' | 'commit' | 'rollback';

const BEGIN = 'begin isolation level read committed';

function fakePool(fail: Partial<Record<Statement, Error>> = {}) {
  const statements: string[] = [];
  const release = vi.fn();
  const client = {
    query: vi.fn(async (query: { text: string }) => {
      statements.push(query.text);
      const failure = fail[query.text.split(' ')[0] as Statement];
      if (failure) throw failure;
      return { rows: [], rowCount: 0, command: '', fields: [] };
    }),
    release,
  };
  const connect = vi.fn(async () => client as unknown as PoolClient);
  return { pool: new FakePool(connect) as unknown as Pool, connect, statements, release };
}

// Named like a pool, so Drizzle's own transaction would take a client from it too.
class FakePool {
  constructor(readonly connect: () => Promise<PoolClient>) {}
}

function released(release: ReturnType<typeof vi.fn>) {
  expect(release).toHaveBeenCalledTimes(1);
  return release.mock.calls[0][0] as unknown;
}

describe('createDatabase', () => {
  it('commits a transaction on one client and releases it once, without an error', async () => {
    const { pool, statements, release } = fakePool();
    const db = createDatabase(pool, { schema });

    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`select 1`);
      return 'done';
    });

    expect(result).toBe('done');
    expect(statements).toEqual([BEGIN, 'select 1', 'commit']);
    expect(released(release)).toBeUndefined();
  });

  it('releases the client once, with the error, when BEGIN fails', async () => {
    const { pool, statements, release } = fakePool({ begin: new Error('begin refused') });
    const work = vi.fn();

    const error: unknown = await createDatabase(pool, { schema }).transaction(work).catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(DrizzleQueryError);
    expect(work).not.toHaveBeenCalled();
    expect(statements).toEqual([BEGIN]);
    expect(released(release)).toBe(error);
  });

  it('rolls back an ApiException and releases the client once, without an error', async () => {
    const { pool, statements, release } = fakePool();
    const refusal = ApiException.conflict('TAKEN', 'Already taken.');

    const error: unknown = await createDatabase(pool, { schema })
      .transaction(async () => {
        throw refusal;
      })
      .catch((rejection: unknown) => rejection);

    expect(error).toBe(refusal);
    expect(statements).toEqual([BEGIN, 'rollback']);
    expect(released(release)).toBeUndefined();
  });

  it('releases the client once, with the error, when COMMIT fails', async () => {
    const { pool, statements, release } = fakePool({ commit: new Error('commit refused') });

    const error: unknown = await createDatabase(pool, { schema })
      .transaction(async () => 'done')
      .catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(DrizzleQueryError);
    expect(statements).toEqual([BEGIN, 'commit', 'rollback']);
    expect(released(release)).toBe(error);
  });

  it('releases the client once, with the ROLLBACK error that replaces the original, when ROLLBACK fails', async () => {
    const { pool, statements, release } = fakePool({ rollback: new Error('rollback refused') });

    const error: unknown = await createDatabase(pool, { schema })
      .transaction(async () => {
        throw ApiException.conflict('TAKEN', 'Already taken.');
      })
      .catch((rejection: unknown) => rejection);

    expect(error).toBeInstanceOf(DrizzleQueryError);
    expect((error as Error).cause).toMatchObject({ message: 'rollback refused' });
    expect(statements).toEqual([BEGIN, 'rollback']);
    expect(released(release)).toBe(error);
  });

  it('releases nothing when no client can be had', async () => {
    const { pool, connect, release } = fakePool();
    const unavailable = new DatabaseConnectionError(new Error('refused'));
    connect.mockRejectedValueOnce(unavailable);

    await expect(createDatabase(pool, { schema }).transaction(async () => 'done')).rejects.toBe(unavailable);
    expect(release).not.toHaveBeenCalled();
  });

  it('passes the transaction settings to BEGIN, and an isolation level named there wins', async () => {
    const { pool, statements } = fakePool();

    await createDatabase(pool, { schema }).transaction(async () => undefined, {
      isolationLevel: 'serializable',
      accessMode: 'read only',
    });

    expect(statements[0]).toBe('begin isolation level serializable read only');
  });

  it('opens a transaction at READ COMMITTED whatever the server defaults to, unless its settings name a level', async () => {
    const { pool, statements } = fakePool();
    const db = createDatabase(pool, { schema });

    await db.transaction(async () => undefined);
    await db.transaction(async () => undefined, { accessMode: 'read only' });

    expect(statements).toEqual([BEGIN, 'commit', `${BEGIN} read only`, 'commit']);
  });

  it("gives the transaction's own handle the same options as the database", async () => {
    const { pool } = fakePool();
    const logQuery = vi.fn();

    await createDatabase(pool, { schema, logger: { logQuery } }).transaction(async () => undefined);

    expect(logQuery.mock.calls.map(([query]) => query as string)).toEqual([BEGIN, 'commit']);
  });

  it('keeps savepoints for nested transactions on the same client', async () => {
    const { pool, connect, statements, release } = fakePool();

    await createDatabase(pool, { schema }).transaction(async (tx) => {
      await tx.transaction(async (inner) => {
        await inner.execute(sql`select 1`);
      });
    });

    expect(connect).toHaveBeenCalledTimes(1);
    expect(statements).toEqual([BEGIN, 'savepoint sp1', 'select 1', 'release savepoint sp1', 'commit']);
    expect(released(release)).toBeUndefined();
  });
});

describe('createPool', () => {
  it('gives up on a reply after the server would have cancelled the statement, and keeps the connection probed', async () => {
    const settings = { DATABASE_URL: 'postgresql://nobody@127.0.0.1:1/unused', DATABASE_POOL_SIZE: 1 };
    const pool = createPool({ get: (key: keyof typeof settings) => settings[key] } as unknown as ConfigService<Env, true>);
    const options = (
      pool as Pool & {
        options: { query_timeout?: number; keepAlive?: boolean; keepAliveInitialDelayMillis?: number; options: string };
      }
    ).options;

    const statementTimeout = Number(/-c statement_timeout=(\d+)/.exec(options.options)?.[1]);
    expect(statementTimeout).toBeGreaterThan(0);
    expect(options.query_timeout).toBeGreaterThan(statementTimeout);
    expect(options.keepAlive).toBe(true);
    expect(options.keepAliveInitialDelayMillis).toBeGreaterThan(0);
    expect(options.keepAliveInitialDelayMillis).toBeLessThanOrEqual(60_000);
    await pool.end();
  });
});
