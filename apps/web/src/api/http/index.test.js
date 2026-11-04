import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/apiClient', () => ({ apiClient: transport }));

import { account, auth } from './index';

beforeEach(() => vi.clearAllMocks());

describe('Better Auth HTTP adapter', () => {
  it('uses identity routes for registration, sign-in and sign-out', () => {
    auth.register({ email: 'customer@example.com' });
    auth.signIn('customer@example.com', 'Password1!');
    auth.signOut();

    expect(transport.post).toHaveBeenNthCalledWith(1, '/identity/register', { email: 'customer@example.com' });
    expect(transport.post).toHaveBeenNthCalledWith(2, '/identity/sign-in/email', { email: 'customer@example.com', password: 'Password1!' });
    expect(transport.post).toHaveBeenNthCalledWith(3, '/identity/sign-out');
  });

  it('restores an unbound tab without an identity header and closes through the API', () => {
    auth.me({ boot: true });
    account.close();

    expect(transport.get).toHaveBeenCalledWith('/auth/me', { identity: 'omit' });
    expect(transport.delete).toHaveBeenCalledWith('/account');
  });
});
