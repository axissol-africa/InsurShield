import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The configuration module reads `import.meta.env` when it loads, so each case
 * stubs the variables and re-imports it. Reading the ambient environment
 * instead would make these pass or fail with whatever is in a developer's
 * `.env.local`.
 */
const loadEnv = async (vars) => {
  vi.resetModules();
  for (const [key, value] of Object.entries(vars)) vi.stubEnv(key, value);
  return (await import('./env.js')).env;
};

afterEach(() => vi.unstubAllEnvs());

describe('env', () => {
  it('serves records from browser storage unless the API mode says otherwise', async () => {
    const env = await loadEnv({ VITE_API_MODE: '', VITE_API_BASE_URL: '', VITE_MOCK_LATENCY_MS: '' });
    expect(env.apiMode).toBe('mock');
    expect(env.apiBaseUrl).toBe('/api/v1');
    expect(env.mockLatencyMs).toBe(600);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('switches to the backend only for the exact value "http"', async () => {
    expect((await loadEnv({ VITE_API_MODE: 'http' })).apiMode).toBe('http');
    expect((await loadEnv({ VITE_API_MODE: 'HTTP' })).apiMode).toBe('mock');
    expect((await loadEnv({ VITE_API_MODE: 'live' })).apiMode).toBe('mock');
  });

  it('takes the API base URL and identity settings from the environment', async () => {
    const env = await loadEnv({
      VITE_API_MODE: 'http',
      VITE_API_BASE_URL: 'https://api.insurshield.zm/v1',
    });
    expect(env.apiBaseUrl).toBe('https://api.insurshield.zm/v1');
  });
});
