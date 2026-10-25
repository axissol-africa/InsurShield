import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';

// lock_not_available (lock_timeout), query_canceled (statement_timeout),
// deadlock_detected and serialization_failure: the transaction was rolled back.
const RETRYABLE_CODES = new Set(['55P03', '57014', '40P01', '40001']);
const UNIQUE_VIOLATION = '23505';
const SQLSTATE = /^[0-9A-Z]{5}$/;
export const DRIVER_CODE = /^[A-Z][A-Z0-9_]+$/;

/** The pool could not give a client, so no statement of the operation was sent. */
export class DatabaseConnectionError extends Error {
  constructor(cause: unknown) {
    super('Could not get a database connection.', { cause });
    this.name = 'DatabaseConnectionError';
  }
}

interface DatabaseErrorFields {
  code?: unknown;
  constraint?: unknown;
}

// The query builder wraps the driver's error in `cause`; a cycle must not loop forever.
export function* causes(error: unknown): Generator<Error & DatabaseErrorFields> {
  const seen = new Set<unknown>();
  for (let current = error; current instanceof Error && !seen.has(current); current = current.cause) {
    seen.add(current);
    yield current;
  }
}

export function serverError(error: unknown): DatabaseError | undefined {
  return [...causes(error)].find((current): current is DatabaseError => current instanceof DatabaseError);
}

// Only the server's errors carry a SQLSTATE; Node's codes such as EPIPE have the same shape.
function sqlState(error: Error & DatabaseErrorFields): string | undefined {
  return error instanceof DatabaseError && typeof error.code === 'string' && SQLSTATE.test(error.code)
    ? error.code
    : undefined;
}

/** True when the operation was rolled back or never started, so it may be tried again. */
export function isRetryableDatabaseError(error: unknown): boolean {
  for (const current of causes(error)) {
    if (current instanceof DatabaseConnectionError) return true;
    const code = sqlState(current);
    if (code && RETRYABLE_CODES.has(code)) return true;
  }
  return false;
}

/** True for any error from a query, the server or getting a connection, whose message and stack may carry the statement and its parameters. */
export function isDatabaseError(error: unknown): boolean {
  for (const current of causes(error)) {
    if (
      current instanceof DrizzleQueryError ||
      current instanceof DatabaseError ||
      current instanceof DatabaseConnectionError
    ) {
      return true;
    }
  }
  return false;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  for (const current of causes(error)) {
    if (sqlState(current) === UNIQUE_VIOLATION) {
      return constraint === undefined || current.constraint === constraint;
    }
  }
  return false;
}

/**
 * What may be logged about a database error: the SQLSTATE and constraint name, or else the innermost
 * driver code such as ECONNREFUSED. Never a message, detail, statement or parameter.
 */
export function describeDatabaseError(error: unknown): { code?: string; constraint?: string } {
  let driverCode: string | undefined;
  for (const current of causes(error)) {
    const code = sqlState(current);
    if (code) {
      return typeof current.constraint === 'string'
        ? { code, constraint: current.constraint }
        : { code };
    }
    if (typeof current.code === 'string' && DRIVER_CODE.test(current.code)) driverCode = current.code;
  }
  return driverCode ? { code: driverCode } : {};
}
