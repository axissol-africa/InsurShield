import { HttpStatus, Logger, type ArgumentsHost } from '@nestjs/common';
import { DrizzleQueryError } from 'drizzle-orm';
import { DatabaseError } from 'pg';
import { DatabaseConnectionError } from '../../db/errors.js';
import { ApiException, errorBody } from '../errors/api.exception.js';
import { ApiExceptionFilter } from './api-exception.filter.js';

function respond(exception: unknown) {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'POST', path: '/api/v1/payments' }),
    }),
  } as unknown as ArgumentsHost;
  new ApiExceptionFilter().catch(exception, host);
  return response;
}

function wrapped(cause?: Error): Error {
  return new DrizzleQueryError('update "payments" set "status" = $1', ['SECRET'], cause);
}

function fromServer(code: string, fields: Record<string, unknown> = {}) {
  return Object.assign(new DatabaseError('canceling statement', 0, 'error'), { code, ...fields });
}

const withCode = (code: string) => Object.assign(new Error(`connect ${code} SECRET`), { code });

const notConnected = (cause: Error) => new DatabaseConnectionError(cause);

describe('ApiExceptionFilter', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function expectNothingOfTheQueryLogged() {
    const logged = JSON.stringify([warn.mock.calls, error.mock.calls]);
    expect(logged).not.toContain('SECRET');
    expect(logged).not.toContain('Failed query');
    expect(logged).not.toContain('params:');
    expect(logged).not.toContain('update');
  }

  it.each([
    ['a deadlock wrapped by the query builder', wrapped(fromServer('40P01')), { code: '40P01' }],
    ['a statement timeout', fromServer('57014'), { code: '57014' }],
    [
      'a pool that gave no client in time for a query',
      wrapped(notConnected(new Error('timeout exceeded when trying to connect'))),
      {},
    ],
    [
      'a refused connection while getting a client for a query',
      wrapped(notConnected(withCode('ECONNREFUSED'))),
      { code: 'ECONNREFUSED' },
    ],
    ['a refused connection while getting a client for a transaction', notConnected(withCode('ECONNREFUSED')), { code: 'ECONNREFUSED' }],
    [
      'a connection that timed out while connecting',
      notConnected(
        new Error('Connection terminated due to connection timeout', { cause: new Error('Connection terminated unexpectedly') }),
      ),
      {},
    ],
    ['a server not yet accepting connections', notConnected(fromServer('57P03')), { code: '57P03' }],
  ])('answers %s with 503 TRY_AGAIN and Retry-After: 1', (_case, exception, logged) => {
    const response = respond(exception);

    expect(response.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.headers).toEqual({ 'Retry-After': '1' });
    expect(response.body).toEqual({ code: 'TRY_AGAIN', message: expect.any(String), details: null });
    expect(warn).toHaveBeenCalledWith('POST /api/v1/payments -> 503 TRY_AGAIN', logged);
    expect(error).not.toHaveBeenCalled();
    expectNothingOfTheQueryLogged();
  });

  it.each([
    ['a failed query with no SQLSTATE or code', wrapped(new TypeError('SECRET')), {}],
    ['a failed query with no cause', wrapped(), {}],
    ['a failed query with a code that is not a lost connection', wrapped(withCode('ENOENT')), { code: 'ENOENT' }],
    ['a statement the server refused', wrapped(fromServer('42501')), { code: '42501' }],
    ['a reset connection during the query', wrapped(withCode('ECONNRESET')), { code: 'ECONNRESET' }],
    ['a connection that timed out during the query', wrapped(withCode('ETIMEDOUT')), { code: 'ETIMEDOUT' }],
    ['a broken pipe during the query', wrapped(withCode('EPIPE')), { code: 'EPIPE' }],
    ['a connection lost during the query', wrapped(new Error('Connection terminated unexpectedly')), {}],
    ['a server shutting down during the query', wrapped(fromServer('57P01')), { code: '57P01' }],
    ['a connection failure the server reported', wrapped(fromServer('08006')), { code: '08006' }],
  ])('answers %s with 500 INTERNAL_ERROR, logging neither the statement nor its parameters', (_case, exception, logged) => {
    const response = respond(exception);

    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.headers).toEqual({});
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String), details: null });
    expect(error).toHaveBeenCalledWith('POST /api/v1/payments -> 500 INTERNAL_ERROR', logged);
    expectNothingOfTheQueryLogged();
  });

  it('answers a unique violation with 409 CONFLICT, logging only its SQLSTATE and constraint', () => {
    const violation = fromServer('23505', {
      constraint: 'payments_idempotencyKey_key',
      detail: 'Key ("idempotencyKey")=(SECRET) already exists.',
    });

    const response = respond(wrapped(violation));

    expect(response.statusCode).toBe(HttpStatus.CONFLICT);
    expect(response.headers).toEqual({});
    expect(response.body).toEqual({ code: 'CONFLICT', message: expect.any(String), details: null });
    expect(JSON.stringify(response.body)).not.toContain('payments_idempotencyKey_key');
    expect(warn).toHaveBeenCalledWith('POST /api/v1/payments -> 409 CONFLICT', {
      code: '23505',
      constraint: 'payments_idempotencyKey_key',
    });
    expectNothingOfTheQueryLogged();
  });

  it.each([
    ['an unknown error', new Error('boom')],
    ['a reset connection to storage', withCode('ECONNRESET')],
  ])('answers %s with 500 INTERNAL_ERROR and logs its stack, as it did not come from the database', (_case, unknown) => {
    const response = respond(unknown);

    expect(response.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(response.headers).toEqual({});
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String), details: null });
    expect(error).toHaveBeenCalledWith('POST /api/v1/payments -> 500 INTERNAL_ERROR', unknown.stack);
    expect(warn).not.toHaveBeenCalled();
  });

  it('leaves a translated clash to the service: an ApiException keeps its own code and status', () => {
    const response = respond(ApiException.conflict('IDEMPOTENCY_KEY_REUSED', 'Used.'));

    expect(response.statusCode).toBe(HttpStatus.CONFLICT);
    expect(response.body).toEqual({ code: 'IDEMPOTENCY_KEY_REUSED', message: 'Used.', details: null });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('writes exactly the body errorBody builds, which the middleware in front of Nest sends too', () => {
    const response = respond(new ApiException('NOT_FOUND', 'Not found.', HttpStatus.NOT_FOUND));

    expect(JSON.stringify(response.body)).toBe(JSON.stringify(errorBody('NOT_FOUND', 'Not found.')));
    expect(JSON.stringify(errorBody('NOT_FOUND', 'Not found.'))).toBe('{"code":"NOT_FOUND","message":"Not found.","details":null}');
  });
});
