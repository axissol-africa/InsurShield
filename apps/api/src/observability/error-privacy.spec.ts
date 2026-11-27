import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import { DatabaseError } from 'pg';
import { DatabaseConnectionError } from '../db/errors.js';
import { createRequestContext, withRequestContext } from './request-context.js';
import type { Request, Response } from 'express';
import { answerFailure } from '../common/filters/api-exception.filter.js';

describe('error log privacy', () => {
  it('does not log request paths or arbitrary exception messages and stacks', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    try {
      answerFailure(new Error('secret-record-and-password'), { method: 'GET', path: '/records/private-person' } as Request, response as unknown as Response);
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private-person|secret-record-and-password/);
      expect(response.status).toHaveBeenCalledWith(500);
      expect(response.json).toHaveBeenCalledWith({ code: 'INTERNAL_ERROR', message: expect.any(String), details: null });
    } finally { log.mockRestore(); }
  });
});


describe('structured error fields used by the HTTP assertions', () => {
  it.each([
    ['55P03', 503, 'TRY_AGAIN'],
    ['23505', 409, 'CONFLICT'],
    ['23514', 500, 'INTERNAL_ERROR'],
    [null, 503, 'TRY_AGAIN'],
  ] as const)('records safe structured metadata for database code %s', (databaseCode, statusCode, code) => {
    const databaseError = new DatabaseError('private statement and parameters', 0, 'error');
    databaseError.code = databaseCode ?? undefined;
    databaseError.constraint = 'private_constraint';
    const failure = databaseCode === null
      ? new DatabaseConnectionError(Object.assign(new Error('private address and stack'), { code: 'ECONNREFUSED' }))
      : databaseError;
    const level = statusCode === 500 ? 'error' : 'warn';
    const log = vi.spyOn(Logger.prototype, level).mockImplementation(() => {});
    const response = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() };
    const context = createRequestContext();
    try {
      withRequestContext(context, () => answerFailure(failure, {
        method: 'POST', path: '/records/private-person', route: { path: '/records/:id' },
      } as Request, response as unknown as Response));
      expect(log).toHaveBeenCalledTimes(1);
      const record: unknown = JSON.parse(String(log.mock.calls[0][0]));
      expect(record).toEqual({
        event: 'http.request.failed', schemaVersion: 1, ...context,
        method: 'POST', route: '/records/:id', statusCode, code, databaseCode,
      });
      expect(response.status).toHaveBeenCalledWith(statusCode);
      expect(response.json).toHaveBeenCalledWith({ code, message: expect.any(String), details: null });
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|ECONNREFUSED/);
    } finally { log.mockRestore(); }
  });
});
