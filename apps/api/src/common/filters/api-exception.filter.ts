import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  describeDatabaseError,
  isDatabaseError,
  isRetryableDatabaseError,
  isUniqueViolation,
} from '../../db/errors.js';
import { errorBody, type ErrorBody } from '../errors/api.exception.js';

const RETRY_AFTER_SECONDS = 1;

const logger = new Logger('Api');

/**
 * Normalises every failure into the one shape the client understands:
 * `{ code, message, details }` with an HTTP status, and logs it. Nothing else may leave the
 * API — an unhandled error must not leak a stack trace or a database message to
 * the browser. The identity routes in front of Nest answer their failures through it too.
 */
export function answerFailure(exception: unknown, request: Request, response: Response): void {
  const { status, body } = describe(exception);
  // The query string can carry personal data, so only the path is logged.
  const summary = `${request.method} ${request.path} -> ${status} ${body.code}`;

  if (isDatabaseError(exception)) {
    const unexpected = status >= HttpStatus.INTERNAL_SERVER_ERROR && status !== HttpStatus.SERVICE_UNAVAILABLE;
    logger[unexpected ? 'error' : 'warn'](summary, describeDatabaseError(exception));
  } else if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
    logger.error(summary, exception instanceof Error ? exception.stack : String(exception));
  }

  if (body.code === 'TRY_AGAIN') {
    response.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
  }
  response.status(status).json(body);
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    answerFailure(exception, context.getRequest<Request>(), context.getResponse<Response>());
  }
}

function describe(exception: unknown): { status: number; body: ErrorBody } {
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'object' && payload !== null && 'code' in payload) {
      const { code, message, details } = payload as Partial<ErrorBody>;
      return { status, body: errorBody(code ?? 'HTTP_ERROR', message ?? exception.message, details ?? null) };
    }

    // Nest's own exceptions (including ValidationPipe) land here.
    const message =
      typeof payload === 'object' && payload !== null && 'message' in payload
        ? (payload as { message: string | string[] }).message
        : exception.message;

    const isValidation = Array.isArray(message);
    return {
      status,
      body: isValidation
        ? errorBody('VALIDATION_FAILED', 'Some of the details you entered need attention.', { fields: message })
        : errorBody(codeForStatus(status), String(message)),
    };
  }

  if (isRetryableDatabaseError(exception)) {
    return {
      status: HttpStatus.SERVICE_UNAVAILABLE,
      body: errorBody('TRY_AGAIN', 'The service is busy right now. Please try again in a moment.'),
    };
  }

  // A clash a service did not translate into its own error. The constraint names the data, so it stays in the log.
  if (isUniqueViolation(exception)) {
    return {
      status: HttpStatus.CONFLICT,
      body: errorBody('CONFLICT', 'This conflicts with a record that already exists. Refresh and try again.'),
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: errorBody('INTERNAL_ERROR', 'Something went wrong on our side. Please try again.'),
  };
}

function codeForStatus(status: number): string {
  const codes: Record<number, string> = {
    [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
    [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
    [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
    [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
    [HttpStatus.CONFLICT]: 'CONFLICT',
    [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
    [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
  };
  return codes[status] ?? 'HTTP_ERROR';
}
