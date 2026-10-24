import { describe, expect, it } from 'vitest';
import { describeDatabaseError, isRetryableDatabaseError, isUniqueViolation } from './errors.js';

function pgError(code: string, fields: Record<string, unknown> = {}) {
  return Object.assign(new Error('canceling statement'), { code, ...fields });
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

describe('isRetryableDatabaseError', () => {
  it.each([
    ['a lock timeout', pgError('55P03')],
    ['a statement timeout', pgError('57014')],
    ['a deadlock', pgError('40P01')],
    ['a serialization failure', pgError('40001')],
    ['a pool timeout', new Error('timeout exceeded when trying to connect')],
    ['a timeout wrapped by the query builder', new Error('Failed query', { cause: pgError('55P03') })],
  ])('recognises %s', (_case, error) => {
    expect(isRetryableDatabaseError(error)).toBe(true);
  });

  it.each([
    ['a unique violation', pgError('23505')],
    ['a plain error', new Error('boom')],
    ['a thrown string', 'boom'],
    ['an error that is its own cause', selfCaused()],
    ['two errors that cause each other', mutuallyCaused()],
  ])('does not treat %s as retryable', (_case, error) => {
    expect(isRetryableDatabaseError(error)).toBe(false);
  });
});

describe('isUniqueViolation', () => {
  const clash = new Error('Failed query', {
    cause: pgError('23505', { constraint: 'payments_idempotencyKey_key' }),
  });

  it('recognises a unique violation through the query builder', () => {
    expect(isUniqueViolation(clash)).toBe(true);
  });

  it('matches the constraint when one is named', () => {
    expect(isUniqueViolation(clash, 'payments_idempotencyKey_key')).toBe(true);
    expect(isUniqueViolation(clash, 'customers_email_key')).toBe(false);
  });

  it.each([
    ['another constraint violation', pgError('23503', { constraint: 'payments_idempotencyKey_key' })],
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
    const error = new Error('Failed query: insert into "customers" params: 0977123456,ann@example.zm', {
      cause: pgError('23505', {
        constraint: 'customers_email_key',
        detail: 'Key (email)=(ann@example.zm) already exists.',
        table: 'customers',
      }),
    });

    const described = describeDatabaseError(error);

    expect(described).toEqual({ code: '23505', constraint: 'customers_email_key' });
    expect(JSON.stringify(described)).not.toContain('ann@example.zm');
  });

  it('gives the SQLSTATE alone when no constraint is involved', () => {
    expect(describeDatabaseError(new Error('wrapped', { cause: pgError('57014') }))).toEqual({
      code: '57014',
    });
  });

  it.each([
    ['a plain error', new Error('boom')],
    ['a thrown string', 'boom'],
    ['an error that is its own cause', selfCaused()],
    ['a code that is not a SQLSTATE', pgError('ann@example.zm')],
  ])('describes %s as having no SQLSTATE', (_case, error) => {
    expect(describeDatabaseError(error)).toEqual({});
  });
});
