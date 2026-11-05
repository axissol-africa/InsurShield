import axios from 'axios';
import { env } from '@/config/env';
import { getIdentityBinding, requestIdentityTransition } from '@/app/identity';

/** Normalised error thrown by every backend call. */
export class ApiError extends Error {
  constructor(message, { status = 0, code = 'UNKNOWN', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * Shared HTTP client for the backend REST API.
 * - JSON in and out, credentials sent for cookie sessions.
 * - HTTP mode adds the tab's identity binding; it never sends bearer tokens.
 * - Backend errors surface as `ApiError` with the server's `code` and `message`.
 */
export const apiClient = axios.create({
  baseURL: env.apiBaseUrl,
  timeout: 20_000,
  withCredentials: true,
  headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
});

apiClient.interceptors.request.use((config) => {
  if (env.apiMode === 'http' && config.identity !== 'omit') {
    config.headers['X-InsurShield-User'] = getIdentityBinding() || 'anonymous';
  }
  return config;
});

apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const { response } = error;
    if (!response) throw new ApiError('The server could not be reached. Check your connection and try again.', { code: 'NETWORK' });
    const body = response.data || {};
    const apiError = new ApiError(body.message || `Request failed (${response.status})`, { status: response.status, code: body.code || 'HTTP_ERROR', details: body.details ?? null });
    if (env.apiMode === 'http' && apiError.status === 409 && apiError.code === 'IDENTITY_CHANGED') requestIdentityTransition();
    throw apiError;
  },
);
