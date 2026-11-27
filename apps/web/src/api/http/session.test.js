import { afterEach, describe, expect, it, vi } from 'vitest';
import { readSession } from './session';

const identity = vi.hoisted(() => ({
  getIdentityBinding: vi.fn(() => 'test-user'),
  requestIdentityTransition: vi.fn(),
}));
vi.mock('@/app/identity', () => identity);
vi.mock('@/config/env', () => ({ env: { apiBaseUrl: '/api/v1/' } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('session restore', () => {
  it.each([true, false])('uses cookies and preserves tab binding, boot=%s', async (boot) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ userId: 'test-user' }));
    vi.stubGlobal('fetch', fetch);
    await expect(readSession({ boot })).resolves.toEqual({ userId: 'test-user' });
    const [url, request] = fetch.mock.calls[0];
    expect(url).toBe('/api/v1/auth/me');
    expect(request.credentials).toBe('include');
    expect(request.headers.Authorization).toBeUndefined();
    expect(request.headers['X-InsurShield-User']).toBe(boot ? undefined : 'test-user');
  });

  it('reports a guest with a structured status even for a non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 401 })));
    await expect(readSession({ boot: true })).rejects.toMatchObject({ status: 401, code: 'HTTP_ERROR' });
  });

  it('starts the identity transition on a cross-tab mismatch', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ code: 'IDENTITY_CHANGED', message: 'Session changed' }, { status: 409 })));
    await expect(readSession()).rejects.toMatchObject({ status: 409, code: 'IDENTITY_CHANGED' });
    expect(identity.requestIdentityTransition).toHaveBeenCalledOnce();
  });

  it('returns a safe error when the network or response payload fails', async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new TypeError('transport detail'))
      .mockResolvedValueOnce(new Response('invalid JSON'));
    vi.stubGlobal('fetch', fetch);
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(readSession()).rejects.toMatchObject({ code: 'NETWORK' });
    }
  });
});
