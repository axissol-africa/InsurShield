import { describe, expect, it } from 'vitest';
import {
  IntegrationEndpointRedirectError,
  refuseRedirect,
  resolvePublicIntegrationEndpoint,
  UnsafeIntegrationEndpointError,
} from './endpoint-safety.js';

describe('insurer endpoint safety', () => {
  it('refuses IPv4-mapped IPv6 private addresses before an outbound request', async () => {
    await expect(
      resolvePublicIntegrationEndpoint('http://[::ffff:7f00:1]:65535/quote-requests', true),
    ).rejects.toBeInstanceOf(UnsafeIntegrationEndpointError);
  });

  it('refuses a hostname when any DNS answer is not publicly routable', async () => {
    await expect(
      resolvePublicIntegrationEndpoint('https://insurer.example/quote-requests', false, async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ]),
    ).rejects.toBeInstanceOf(UnsafeIntegrationEndpointError);
  });

  it('pins a public DNS answer for the outbound request', async () => {
    await expect(
      resolvePublicIntegrationEndpoint('https://insurer.example/quote-requests', false, async () => [
        { address: '93.184.216.34', family: 4 },
      ]),
    ).resolves.toMatchObject({ hostname: 'insurer.example', address: '93.184.216.34', family: 4 });
  });

  it('refuses redirects rather than following them to a second endpoint', () => {
    expect(() => refuseRedirect(302)).toThrow(IntegrationEndpointRedirectError);
    expect(refuseRedirect(202)).toBe(202);
  });
});
