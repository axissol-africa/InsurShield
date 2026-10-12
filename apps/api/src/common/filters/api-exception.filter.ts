import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface ErrorBody {
  code: string;
  message: string;
  details: unknown;
}

/**
 * Normalises every failure into the one shape the client understands:
 * `{ code, message, details }` with an HTTP status. Nothing else may leave the
 * API — an unhandled error must not leak a stack trace or a Prisma message to
 * the browser.
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Api');

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();

    const { status, body } = this.describe(exception);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status} ${body.code}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(body);
  }

  private describe(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();

      if (typeof payload === 'object' && payload !== null && 'code' in payload) {
        const { code, message, details } = payload as Partial<ErrorBody>;
        return {
          status,
          body: {
            code: code ?? 'HTTP_ERROR',
            message: message ?? exception.message,
            details: details ?? null,
          },
        };
      }

      // Nest's own exceptions (including ValidationPipe) land here.
      const message =
        typeof payload === 'object' && payload !== null && 'message' in payload
          ? (payload as { message: string | string[] }).message
          : exception.message;

      const isValidation = Array.isArray(message);
      return {
        status,
        body: {
          code: isValidation ? 'VALIDATION_FAILED' : this.codeForStatus(status),
          message: isValidation
            ? 'Some of the details you entered need attention.'
            : String(message),
          details: isValidation ? { fields: message } : null,
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Something went wrong on our side. Please try again.',
        details: null,
      },
    };
  }

  private codeForStatus(status: number): string {
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
}
