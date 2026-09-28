import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Every error the API returns has a stable machine-readable `code` alongside
 * the human message, because the client raises `ApiError` from it and branches
 * on the code rather than on wording (see frontend/src/lib/apiClient.js).
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    readonly details: unknown = null,
  ) {
    super({ code, message, details }, status);
  }

  static notFound(resource: string, reference?: string): ApiException {
    return new ApiException(
      'NOT_FOUND',
      reference ? `${resource} ${reference} was not found.` : `${resource} was not found.`,
      HttpStatus.NOT_FOUND,
    );
  }

  static conflict(code: string, message: string, details: unknown = null): ApiException {
    return new ApiException(code, message, HttpStatus.CONFLICT, details);
  }

  static unauthorized(message = 'Sign in to continue.'): ApiException {
    return new ApiException('UNAUTHORIZED', message, HttpStatus.UNAUTHORIZED);
  }

  static forbidden(message = 'You do not have access to this resource.'): ApiException {
    return new ApiException('FORBIDDEN', message, HttpStatus.FORBIDDEN);
  }
}
