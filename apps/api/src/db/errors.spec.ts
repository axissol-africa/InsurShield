import { DrizzleQueryError, TransactionRollbackError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import {
  DatabaseConnectionError,
  describeDatabaseError,
  isDatabaseError,
  isRetryableDatabaseError,
  isUniqueViolation,
  serverError,
} from './errors.js';

const SENTINEL = 'sentinel-param-5c1e';

function pgError(code: string, fields: Record<string, unknown> = {}) {
  return Object.assign(new DatabaseError(`canceling statement ${SENTINEL}`, 0, 'error'), { code, ...fields });
}

function withCode(code: unknown, cause?: Error) {
  return Object.assign(new Error(`connect failed ${SENTINEL}`, { cause }), { code });
}

function failedQuery(cause?: Error) {
  return new DrizzleQueryError('update "customers" set "fullName" = $1', [SENTINEL], cause);
}

function notConnected(cause: Error) {
  return new DatabaseConnectionError(cause);
}

function poolConnectionTimeout() {
  return new Error('Connection terminated due to connection timeout', {
    cause: new Error('Connection terminated unexpectedly'),
  });
}

function selfCaused() {
  const error = new Error('loop');
  error.cause = error;
  return error;
}

function mutuallyCaused() {
  const first = new Error('first');
  first.cause = new Error('second', { cause: first });
  return first;
}

interface Row {
  error: unknown;
  database: boolean;
  retryable: boolean;
  described: { code?: string; constraint?: string };
}

const classified: [string, Row][] = [
  ['a lock timeout', { error: pgError('55P03'), database: true, retryable: true, described: { code: '55P03' } }],
  ['a statement timeout', { error: pgError('57014'), database: true, retryable: true, described: { code: '57014' } }],
  ['a deadlock', { error: failedQuery(pgError('40P01')), database: true, retryable: true, described: { code: '40P01' } }],
  [
    'a serialization failure',
    { error: failedQuery(pgError('40001')), database: true, retryable: true, described: { code: '40001' } },
  ],
  [
    'a refused connection while getting a client',
    { error: notConnected(withCode('ECONNREFUSED')), database: true, retryable: true, described: { code: 'ECONNREFUSED' } },
  ],
  [
    'a refused connection while getting a client for a query',
    {
      error: failedQuery(notConnected(withCode('ECONNREFUSED'))),
      database: true,
      retryable: true,
      described: { code: 'ECONNREFUSED' },
    },
  ],
  [
    'a server not yet accepting connections while getting a client',
    { error: notConnected(pgError('57P03')), database: true, retryable: true, described: { code: '57P03' } },
  ],
  [
    'a pool that gave no client in time',
    {
      error: notConnected(new Error('timeout exceeded when trying to connect')),
      database: true,
      retryable: true,
      described: {},
    },
  ],
  [
    'a connection that timed out while connecting',
    { error: notConnected(poolConnectionTimeout()), database: true, retryable: true, described: {} },
  ],
  [
    'a connection ended while connecting',
    {
      error: notConnected(new Error('Connection terminated unexpectedly')),
      database: true,
      retryable: true,
      described: {},
    },
  ],
  [
    'a reset connection during a query',
    { error: failedQuery(withCode('ECONNRESET')), database: true, retryable: false, described: { code: 'ECONNRESET' } },
  ],
  [
    'a broken pipe during a query',
    { error: failedQuery(withCode('EPIPE')), database: true, retryable: false, described: { code: 'EPIPE' } },
  ],
  [
    'a connection lost during a query',
    { error: failedQuery(new Error('Connection terminated unexpectedly')), database: true, retryable: false, described: {} },
  ],
  [
    'an administrator shutdown during a query',
    { error: failedQuery(pgError('57P01')), database: true, retryable: false, described: { code: '57P01' } },
  ],
  [
    'a crash shutdown during a query',
    { error: failedQuery(pgError('57P02')), database: true, retryable: false, described: { code: '57P02' } },
  ],
  [
    'a server not yet accepting connections, outside connecting',
    { error: pgError('57P03'), database: true, retryable: false, described: { code: '57P03' } },
  ],
  [
    'a connection failure the server reported',
    { error: failedQuery(pgError('08006')), database: true, retryable: false, described: { code: '08006' } },
  ],
  [
    'a unique violation',
    {
      error: failedQuery(pgError('23505', { constraint: 'customers_email_key' })),
      database: true,
      retryable: false,
      described: { code: '23505', constraint: 'customers_email_key' },
    },
  ],
  ['a failed query with no cause', { error: failedQuery(), database: true, retryable: false, described: {} }],
  [
    'a failed query with no SQLSTATE or code',
    { error: failedQuery(new TypeError(SENTINEL)), database: true, retryable: false, described: {} },
  ],
  [
    'a server error under another wrapper',
    { error: new Error(SENTINEL, { cause: pgError('42501') }), database: true, retryable: false, described: { code: '42501' } },
  ],
  [
    'a reset connection to storage',
    { error: withCode('ECONNRESET'), database: false, retryable: false, described: { code: 'ECONNRESET' } },
  ],
  [
    'a refused connection outside the database',
    { error: withCode('ECONNREFUSED'), database: false, retryable: false, described: { code: 'ECONNREFUSED' } },
  ],
  [
    "the pool's timeout message outside the pool",
    { error: new Error('timeout exceeded when trying to connect'), database: false, retryable: false, described: {} },
  ],
  [
    'a SQLSTATE on an error the server did not send',
    { error: withCode('55P03'), database: false, retryable: false, described: {} },
  ],
  ['a rolled-back transaction', { error: new TransactionRollbackError(), database: false, retryable: false, described: {} }],
  ['a plain error', { error: new Error('boom'), database: false, retryable: false, described: {} }],
  ['a thrown string', { error: 'Failed query', database: false, retryable: false, described: {} }],
  ['an error that is its own cause', { error: selfCaused(), database: false, retryable: false, described: {} }],
  ['two errors that cause each other', { error: mutuallyCaused(), database: false, retryable: false, described: {} }],
];

describe('database error classification', () => {
  it.each(classified)('classifies %s', (_case, { error, database, retryable, described }) => {
    expect(isDatabaseError(error)).toBe(database);
    expect(isRetryableDatabaseError(error)).toBe(retryable);
    expect(describeDatabaseError(error)).toEqual(described);
    expect(JSON.stringify(describeDatabaseError(error))).not.toContain(SENTINEL);
  });
});

describe('DatabaseConnectionError', () => {
  it('carries a fixed message and keeps the original error as its cause', () => {
    const original = withCode('ECONNREFUSED');

    const error = new DatabaseConnectionError(original);

    expect(error.message).toBe('Could not get a database connection.');
    expect(error.cause).toBe(original);
  });
});

describe('isUniqueViolation', () => {
  const clash = failedQuery(pgError('23505', { constraint: 'payments_idempotencyKey_key' }));

  it('recognises a unique violation through the query builder', () => {
    expect(isUniqueViolation(clash)).toBe(true);
  });

  it('matches the constraint when one is named', () => {
    expect(isUniqueViolation(clash, 'payments_idempotencyKey_key')).toBe(true);
    expect(isUniqueViolation(clash, 'customers_email_key')).toBe(false);
  });

  it.each([
    ['another constraint violation', pgError('23503', { constraint: 'payments_idempotencyKey_key' })],
    ['a SQLSTATE on an error the server did not send', withCode('23505')],
    ['a plain error', new Error('duplicate key value violates unique constraint')],
    ['a thrown string', '23505'],
    ['an error that is its own cause', selfCaused()],
    ['two errors that cause each other', mutuallyCaused()],
  ])('does not treat %s as a unique violation', (_case, error) => {
    expect(isUniqueViolation(error)).toBe(false);
  });
});

describe('describeDatabaseError', () => {
  it('keeps only the SQLSTATE and the constraint name', () => {
    const error = failedQuery(
      pgError('23505', {
        constraint: 'customers_email_key',
        detail: `Key (email)=(${SENTINEL}) already exists.`,
        table: 'customers',
      }),
    );

    const described = describeDatabaseError(error);

    expect(described).toEqual({ code: '23505', constraint: 'customers_email_key' });
    expect(JSON.stringify(described)).not.toContain(SENTINEL);
  });

  it.each([
    ['the innermost of two codes', failedQuery(withCode('ECONNRESET', withCode('EPIPE'))), { code: 'EPIPE' }],
    ['a code that is not a plain name', failedQuery(withCode(`E ${SENTINEL}`)), {}],
    ['a code that is not text', failedQuery(withCode(42)), {}],
  ])('gives only a plain driver code for %s', (_case, error, described) => {
    expect(describeDatabaseError(error)).toEqual(described);
  });
});

describe('serverError', () => {
  it('finds the error the server sent anywhere in the chain', () => {
    const fromServer = pgError('28P01');

    expect(serverError(notConnected(fromServer))).toBe(fromServer);
  });

  it.each([
    ['a Node error', withCode('ECONNREFUSED')],
    ['a thrown string', '28P01'],
    ['an error that is its own cause', selfCaused()],
  ])('finds none in %s', (_case, error) => {
    expect(serverError(error)).toBeUndefined();
  });
});
