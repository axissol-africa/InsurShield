import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertConfiguredEndpointIsPublic,
  IntegrationEndpointRedirectError,
  pinnedLookup,
  postJsonToEndpoint,
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

describe('the pinned lookup', () => {
  const endpoint = { hostname: 'insurer.example', address: '93.184.216.34', family: 4 as const };

  it('answers the list form Node uses when it selects an address family itself', () => {
    let answer: unknown;
    pinnedLookup(endpoint)('insurer.example', { all: true }, (error, address) => {
      expect(error).toBeNull();
      answer = address;
    });
    expect(answer).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });

  it('answers the single-address form', () => {
    let answer: unknown[] = [];
    pinnedLookup(endpoint)('insurer.example', {}, (error, address, family) => {
      expect(error).toBeNull();
      answer = [address, family];
    });
    expect(answer).toEqual(['93.184.216.34', 4]);
  });

  it('refuses a different host than the one that was checked', () => {
    let failure: unknown;
    pinnedLookup(endpoint)('elsewhere.example', { all: true }, (error) => {
      failure = error;
    });
    expect(failure).toBeInstanceOf(Error);
  });
});

describe('posting to a pinned endpoint', () => {
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  async function listen(status: number, headers: Record<string, string> = {}) {
    const received: string[] = [];
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        received.push(`${request.headers.host} ${body}`);
        response.writeHead(status, headers);
        response.end();
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { port, received };
  }

  // The address checks run in resolvePublicIntegrationEndpoint, so a loopback
  // test server can stand in for the insurer once the address is pinned.
  it('delivers the body to the pinned address under the original host name', async () => {
    const { port, received } = await listen(202);
    const status = await postJsonToEndpoint(
      { url: new URL(`http://insurer.example:${port}/quote-requests`), hostname: 'insurer.example', address: '127.0.0.1', family: 4 },
      { headers: { 'content-type': 'application/json' }, body: '{"a":1}', signal: new AbortController().signal },
    );
    expect(status).toBe(202);
    expect(received).toEqual([`insurer.example:${port} {"a":1}`]);
  });

  it('does not follow a redirect', async () => {
    const { port } = await listen(302, { location: 'http://169.254.169.254/' });
    await expect(
      postJsonToEndpoint(
        { url: new URL(`http://insurer.example:${port}/quote-requests`), hostname: 'insurer.example', address: '127.0.0.1', family: 4 },
        { headers: {}, body: '{}', signal: new AbortController().signal },
      ),
    ).rejects.toBeInstanceOf(IntegrationEndpointRedirectError);
  });
});

describe('checking an endpoint when an integration is saved', () => {
  it('accepts a public HTTPS endpoint', () => {
    expect(() => assertConfiguredEndpointIsPublic('https://api.insurer.example/v1', false)).not.toThrow();
  });

  it('refuses plain HTTP for a live integration but allows it in sandbox', () => {
    expect(() => assertConfiguredEndpointIsPublic('http://api.insurer.example/v1', false)).toThrow(UnsafeIntegrationEndpointError);
    expect(() => assertConfiguredEndpointIsPublic('http://api.insurer.example/v1', true)).not.toThrow();
  });

  it('refuses private, loopback and reserved hosts', () => {
    for (const endpoint of ['https://10.0.0.5/v1', 'https://[::ffff:7f00:1]/v1', 'https://localhost/v1', 'https://insurer.local/v1']) {
      expect(() => assertConfiguredEndpointIsPublic(endpoint, true), endpoint).toThrow(UnsafeIntegrationEndpointError);
    }
  });
});
