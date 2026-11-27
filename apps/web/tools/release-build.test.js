import { describe, expect, it } from 'vitest';
import { assertReleaseApi } from './release-build.js';

describe('release web builds', () => {
  it.each(['/api/v1', '/gateway/insurance', 'https://api.example.test/api/v1'])('accepts a connected API at %s', (base) => {
    expect(() => assertReleaseApi({ VITE_API_MODE: 'http', VITE_API_BASE_URL: base })).not.toThrow();
  });

  it.each([undefined, '', 'mock', 'HTTP'])('requires the explicit HTTP adapter when mode is %s', (mode) => {
    expect(() => assertReleaseApi({ VITE_API_MODE: mode, VITE_API_BASE_URL: '/api/v1' })).toThrow('VITE_API_MODE=http');
  });

  it.each([
    undefined, '', '/', '/api/..', '/%2e', 'api/v1', '//api.example.test/api/v1', 'http://api.example.test/api/v1',
    'https://user:credential@api.example.test/', 'https://api.example.test/?secret=value',
    'https://localhost:4000/api/v1', 'https://127.0.0.1/api/v1', 'https://[::1]/api/v1',
    '/api/v1#fragment', '/api/v1\n', '/\\api.example.test',
  ])('rejects an invalid release target %s', (base) => {
    expect(() => assertReleaseApi({ VITE_API_MODE: 'http', VITE_API_BASE_URL: base })).toThrow(/^VITE_API_BASE_URL must be/);
  });
});
