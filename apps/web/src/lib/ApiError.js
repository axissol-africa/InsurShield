export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function networkError() {
  return new ApiError('The server could not be reached. Check your connection and try again.', { code: 'NETWORK' });
}

export function responseError(status, body) {
  return new ApiError(body?.message || `Request failed (${status})`, {
    status, code: body?.code || 'HTTP_ERROR', details: body?.details ?? null,
  });
}
