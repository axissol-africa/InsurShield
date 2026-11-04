import { describe, expect, it, vi } from 'vitest';

const identity = vi.hoisted(() => ({
  getIdentityBinding: vi.fn(() => 'user-123'),
  requestIdentityTransition: vi.fn(),
}));

vi.mock('@/config/env', () => ({ env: { apiMode: 'http', apiBaseUrl: '/api/v1' } }));
vi.mock('@/app/identity', () => identity);

import { ApiError, apiClient } from './apiClient';

describe('HTTP API client', () => {
  it('sends the per-tab identity header and never a bearer token', async () => {
    let observedConfig;
    await apiClient.get('/auth/me', {
      adapter: async (config) => {
        observedConfig = config;
        return { data: { userId: 'user-123' }, status: 200, statusText: 'OK', headers: {}, config };
      },
    });

    expect(observedConfig.withCredentials).toBe(true);
    expect(observedConfig.headers['X-InsurShield-User']).toBe('user-123');
    expect(observedConfig.headers.Authorization).toBeUndefined();
  });

  it('omits the identity header only for the unbound session restore', async () => {
    let observedConfig;
    await apiClient.get('/auth/me', {
      identity: 'omit',
      adapter: async (config) => {
        observedConfig = config;
        return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
      },
    });

    expect(observedConfig.headers['X-InsurShield-User']).toBeUndefined();
  });

  it('hands off when the API detects an identity change', async () => {
    const rejected = apiClient.interceptors.response.handlers.find((handler) => handler.rejected)?.rejected;
    let result;
    try {
      await rejected({ response: { status: 409, data: { code: 'IDENTITY_CHANGED', message: 'Session changed' } } });
    } catch (error) {
      result = error;
    }

    expect(result).toBeInstanceOf(ApiError);
    expect(result.code).toBe('IDENTITY_CHANGED');
    expect(identity.requestIdentityTransition).toHaveBeenCalledOnce();
  });
});
