import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { clientAddress, identityRoutes } from './identity-routes.js';

function requestWith(ip: string | undefined, headers: Record<string, string>): Request {
  return { ip, headers: { ...headers } } as unknown as Request;
}

describe('the client-address middleware', () => {
  it('replaces an inbound client-address header with the address Express derived', () => {
    const request = requestWith('203.0.113.4', { 'x-insurshield-client-ip': '9.9.9.9' });
    const next = vi.fn();

    clientAddress(request, {} as Response, next);

    expect(request.headers['x-insurshield-client-ip']).toBe('203.0.113.4');
    expect(next).toHaveBeenCalledOnce();
  });

  it('removes the inbound header and sets none when Express knows no address', () => {
    const request = requestWith(undefined, { 'x-insurshield-client-ip': '9.9.9.9' });
    const next = vi.fn();

    clientAddress(request, {} as Response, next);

    expect(request.headers).not.toHaveProperty('x-insurshield-client-ip');
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('the identity routes', () => {
  it('leave out the mail routes in production', () => {
    expect(identityRoutes('production')).toEqual([
      'POST /register',
      'POST /sign-in/email',
      'POST /sign-out',
      'POST /revoke-sessions',
      'POST /change-password',
    ]);
    expect(identityRoutes('development')).toEqual(identityRoutes('test'));
    expect(identityRoutes('test')).toHaveLength(9);
  });

  it.each(['staging', '', undefined])('leave out the mail routes for any NODE_ENV but development and test: %j', (nodeEnv) => {
    expect(identityRoutes(nodeEnv as never)).toEqual(identityRoutes('production'));
  });
});
