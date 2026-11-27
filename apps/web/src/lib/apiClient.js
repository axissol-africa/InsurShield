import axios from 'axios';
import { env } from '@/config/env';
import { getIdentityBinding, requestIdentityTransition } from '@/app/identity';
import { ApiError, networkError, responseError } from './ApiError';

export { ApiError };

/**
 * Shared HTTP client for the backend REST API.
 * - JSON in and out, credentials sent for cookie sessions.
 * - HTTP mode adds the tab's identity binding; it never sends bearer tokens.
 * - Backend errors surface as `ApiError` with the server's `code` and `message`.
 */
function createApiClient() {
  const client = axios.create({
    baseURL: env.apiBaseUrl,
    timeout: 20_000,
    withCredentials: true,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
  });

  client.interceptors.request.use((config) => {
    if (env.apiMode === 'http' && config.identity !== 'omit') {
      config.headers['X-InsurShield-User'] = getIdentityBinding() || 'anonymous';
    }
    return config;
  });

  client.interceptors.response.use(
    (response) => response.data,
    (error) => {
      const { response } = error;
      if (!response) throw networkError();
      const apiError = responseError(response.status, response.data);
      if (env.apiMode === 'http' && apiError.status === 409 && apiError.code === 'IDENTITY_CHANGED') requestIdentityTransition();
      throw apiError;
    },
  );
  return client;
}

// The demo build uses neither this client nor its instance-local interceptors.
export const apiClient = /* @__PURE__ */ createApiClient();
