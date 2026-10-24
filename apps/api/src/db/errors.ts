// lock_not_available (lock_timeout), query_canceled (statement_timeout),
// deadlock_detected and serialization_failure: the transaction was rolled back.
const RETRYABLE_CODES = new Set(['55P03', '57014', '40P01', '40001']);
const UNIQUE_VIOLATION = '23505';
const POOL_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';
const SQLSTATE = /^[0-9A-Z]{5}$/;

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

function sqlState(error: DatabaseErrorFields): string | undefined {
  return typeof error.code === 'string' && SQLSTATE.test(error.code) ? error.code : undefined;
}

/** True when the database gave up waiting or aborted the transaction, so the same request is safe to retry. */
export function isRetryableDatabaseError(error: unknown): boolean {
  for (const current of causes(error)) {
    const code = sqlState(current);
    if (code && RETRYABLE_CODES.has(code)) return true;
    if (current.message === POOL_TIMEOUT_MESSAGE) return true;
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

/** What may be logged about a database error: never its message, detail or query parameters. */
export function describeDatabaseError(error: unknown): { code?: string; constraint?: string } {
  for (const current of causes(error)) {
    const code = sqlState(current);
    if (code) {
      return typeof current.constraint === 'string'
        ? { code, constraint: current.constraint }
        : { code };
    }
  }
  return {};
}
