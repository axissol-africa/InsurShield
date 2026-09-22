import { describe, expect, it } from 'vitest';
import { env } from './env';

describe('env', () => {
  it('defaults to mock mode with a versioned API path', () => {
    expect(env.apiMode).toBe('mock');
    expect(env.apiBaseUrl).toBe('/api/v1');
    expect(env.mockLatencyMs).toBeGreaterThanOrEqual(0);
    expect(Object.isFrozen(env)).toBe(true);
  });
});
