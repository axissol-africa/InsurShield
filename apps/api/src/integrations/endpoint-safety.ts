import { observeOutboundHttp } from '../observability/outbound-http.js';
import { lookup as dnsLookup } from 'node:dns/promises';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export class UnsafeIntegrationEndpointError extends Error {}

export class IntegrationEndpointResolutionError extends Error {}

export class IntegrationEndpointRedirectError extends Error {}

export type ResolvedIntegrationEndpoint = {
  url: URL;
  hostname: string;
  address: string;
  family: 4 | 6;
};

export type EndpointAddress = { address: string; family: number };
export type EndpointResolver = (hostname: string) => Promise<readonly EndpointAddress[]>;

/**
 * Resolves an insurer endpoint once and refuses private or mixed DNS answers.
 * The returned address is pinned by `postJsonToEndpoint`, avoiding a second
 * resolver lookup between validation and the outbound request.
 */
export async function resolvePublicIntegrationEndpoint(
  endpoint: string,
  sandboxMode: boolean,
  resolver: EndpointResolver = resolveHost,
): Promise<ResolvedIntegrationEndpoint> {
  const url = parseEndpoint(endpoint, sandboxMode);
  const hostname = normaliseHostname(url.hostname);
  if (reservedHostname(hostname)) {
    throw new UnsafeIntegrationEndpointError('An insurer API endpoint must be publicly routable.');
  }

  const directFamily = isIP(hostname);
  if (directFamily) {
    if (!isPublicAddress(hostname, directFamily)) {
      throw new UnsafeIntegrationEndpointError('An insurer API endpoint must be publicly routable.');
    }
    return { url, hostname, address: hostname, family: directFamily as 4 | 6 };
  }

  let addresses: readonly EndpointAddress[];
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new IntegrationEndpointResolutionError('The insurer API endpoint could not be resolved.');
  }
  if (addresses.length === 0 || addresses.some(({ address, family }) => !isPublicAddress(address, family))) {
    throw new UnsafeIntegrationEndpointError('An insurer API endpoint must be publicly routable.');
  }

  const first = addresses[0];
  if (first.family !== 4 && first.family !== 6) {
    throw new IntegrationEndpointResolutionError('The insurer API endpoint could not be resolved.');
  }
  return { url, hostname, address: first.address, family: first.family };
}

/**
 * Deliberately uses Node's request API rather than `fetch`: it does not follow
 * redirects, and its `lookup` hook pins the previously validated IP address.
 */
export function postJsonToEndpoint(
  endpoint: ResolvedIntegrationEndpoint,
  input: { headers: Record<string, string>; body: string; signal: AbortSignal },
): Promise<number> {
  return observeOutboundHttp('insurer', input.signal, (traceContext) => new Promise<number>((resolve, reject) => {
    const request = endpoint.url.protocol === 'https:' ? httpsRequest : httpRequest;
    let clientRequest: ClientRequest | undefined;
    let settled = false;

    const cleanUp = () => input.signal.removeEventListener('abort', abort);
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      cleanUp();
      action();
    };
    const fail = (error: Error) => finish(() => reject(error));
    const abort = () => clientRequest?.destroy(new Error('The insurer API request timed out.'));

    clientRequest = request(
      endpoint.url,
      {
        method: 'POST',
        headers: { ...input.headers, traceparent: traceContext },
        lookup: pinnedLookup(endpoint),
      },
      (response) => {
        response.resume();
        response.once('error', fail);
        response.once('end', () => {
          try {
            const status = refuseRedirect(response.statusCode ?? 0);
            finish(() => resolve(status));
          } catch (error) {
            fail(error instanceof Error ? error : new Error('The insurer API request failed.'));
          }
        });
      },
    );
    clientRequest.once('error', fail);
    input.signal.addEventListener('abort', abort, { once: true });
    if (input.signal.aborted) {
      abort();
      return;
    }
    clientRequest.end(input.body);
  }), (status) => status);
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | Array<{ address: string; family: number }>,
  family?: number,
) => void;

/**
 * Answers the socket's DNS lookup with the address that was already checked.
 * Node 20+ connects with `autoSelectFamily`, which asks with `{ all: true }`
 * and expects a list; answering that call with a single address fails every
 * request with ERR_INVALID_IP_ADDRESS.
 */
export function pinnedLookup(endpoint: Pick<ResolvedIntegrationEndpoint, 'hostname' | 'address' | 'family'>) {
  return (hostname: string, options: { all?: boolean }, callback: LookupCallback): void => {
    if (normaliseHostname(hostname) !== endpoint.hostname) {
      callback(new Error('The insurer API endpoint changed during delivery.'), options.all ? [] : '', 0);
      return;
    }
    if (options.all) {
      callback(null, [{ address: endpoint.address, family: endpoint.family }]);
      return;
    }
    callback(null, endpoint.address, endpoint.family);
  };
}

/**
 * The same address rules as delivery, applied when an integration is saved, so
 * a private or malformed endpoint is refused at the form rather than discovered
 * later in the exception queue. Host names are resolved again at send time.
 */
export function assertConfiguredEndpointIsPublic(endpoint: string, sandboxMode: boolean): void {
  const url = parseEndpoint(endpoint, sandboxMode);
  const hostname = normaliseHostname(url.hostname);
  if (reservedHostname(hostname)) {
    throw new UnsafeIntegrationEndpointError('An insurer API endpoint must be publicly routable.');
  }
  const family = isIP(hostname);
  if (family && !isPublicAddress(hostname, family)) {
    throw new UnsafeIntegrationEndpointError('An insurer API endpoint must be publicly routable.');
  }
}

export function refuseRedirect(status: number): number {
  if (status >= 300 && status < 400) {
    throw new IntegrationEndpointRedirectError('The insurer API endpoint returned a redirect.');
  }
  return status;
}

function parseEndpoint(endpoint: string, sandboxMode: boolean): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new UnsafeIntegrationEndpointError('The insurer API endpoint is invalid.');
  }
  if (url.username || url.password || !['http:', 'https:'].includes(url.protocol)) {
    throw new UnsafeIntegrationEndpointError('The insurer API endpoint is invalid.');
  }
  if (!sandboxMode && url.protocol !== 'https:') {
    throw new UnsafeIntegrationEndpointError('A live insurer API endpoint must use HTTPS.');
  }
  return url;
}

async function resolveHost(hostname: string): Promise<readonly EndpointAddress[]> {
  return dnsLookup(hostname, { all: true, verbatim: true });
}

function normaliseHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
}

function reservedHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local');
}

function isPublicAddress(address: string, family: number): boolean {
  const normalised = normaliseHostname(address);
  const actualFamily = isIP(normalised);
  if (actualFamily !== family) return false;
  return actualFamily === 4 ? isPublicIpv4(normalised) : isPublicIpv6(normalised);
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) return false;
  const [first, second, third] = octets;
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113)
  );
}

function isPublicIpv6(address: string): boolean {
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  const first = bytes[0];
  const mappedIpv4 = bytes.slice(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatibleIpv4 = bytes.slice(0, 12).every((byte) => byte === 0);
  if (mappedIpv4 || compatibleIpv4) {
    return isPublicIpv4(Array.from(bytes.slice(12)).join('.'));
  }
  return !(
    bytes.every((byte) => byte === 0) ||
    (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) ||
    first === 0xff ||
    (first & 0xfe) === 0xfc ||
    (first === 0xfe && (bytes[1] & 0xc0) === 0x80) ||
    (first === 0xfe && (bytes[1] & 0xc0) === 0xc0)
  );
}

function ipv6Bytes(address: string): Uint8Array | undefined {
  const halves = address.toLowerCase().split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return undefined;
  const parts = [...left, ...Array(missing).fill('0'), ...right];
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return undefined;

  const bytes = new Uint8Array(16);
  for (const [index, part] of parts.entries()) {
    const value = Number.parseInt(part, 16);
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}
