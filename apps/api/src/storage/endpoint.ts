/**
 * Whether an `S3_ENDPOINT` names a bucket that only exists on the deployment's
 * own machine or network: the development MinIO, not a hosted bucket.
 *
 * `S3_ENDPOINT` is unset in production so the SDK talks to real S3, but a
 * deployment may legitimately set it for a hosted S3-compatible provider. The
 * configuration worth refusing is the one that reaches production by accident —
 * a compose file's `http://minio:9000` or a loopback address — so the test is
 * the address, not merely that the setting is present.
 */
export function isLocalEndpoint(endpoint: string): boolean {
  let host: string;
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    // env.ts already refuses anything that is not a URL; an unparseable value
    // here is not a hosted bucket, so treat it as local rather than trusted.
    return true;
  }
  const bracketless = host.replace(/^\[|\]$/g, '');
  if (bracketless === '::1' || bracketless === '0.0.0.0') return true;
  if (host.startsWith('127.') || host.startsWith('10.') || host.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  // A single-label name is a container or service name on a private network;
  // a hosted bucket is always reached by a fully qualified domain.
  return !host.includes('.');
}
