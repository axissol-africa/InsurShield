import { isLocalEndpoint } from './endpoint.js';

describe('isLocalEndpoint', () => {
  it.each([
    'http://minio:9000',
    'http://localhost:9000',
    'http://127.0.0.1:9000',
    'https://bucket.localhost',
    'http://storage.local:9000',
    'http://10.1.2.3:9000',
    'http://192.168.1.10:9000',
    'http://172.20.0.4:9000',
    'http://[::1]:9000',
  ])('calls %s a bucket that exists only on this machine or network', (endpoint) => {
    expect(isLocalEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'https://s3.eu-west-1.wasabisys.com',
    'https://abc123.r2.cloudflarestorage.com',
    'https://fra1.digitaloceanspaces.com',
    'https://s3.af-south-1.amazonaws.com',
    // A public address is a hosted bucket; only the private ranges are local.
    'https://172.32.9.9',
  ])('calls %s a hosted bucket', (endpoint) => {
    expect(isLocalEndpoint(endpoint)).toBe(false);
  });

  it('treats a value it cannot parse as local rather than trusting it', () => {
    expect(isLocalEndpoint('not a url')).toBe(true);
  });
});
