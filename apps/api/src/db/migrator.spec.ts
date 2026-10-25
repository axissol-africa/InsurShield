import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';
import { failureDetails, failureReason } from './migrator.js';

const withCode = (code: unknown) => Object.assign(new Error('secret host and role'), { code });
const fromServer = (code: string) => Object.assign(new DatabaseError('secret host and role', 0, 'error'), { code });

describe('failureReason', () => {
  it.each([
    ['a refused connection', withCode('ECONNREFUSED'), 'could not connect to the server (ECONNREFUSED)'],
    ['a self-signed certificate', withCode('DEPTH_ZERO_SELF_SIGNED_CERT'), 'TLS failed (DEPTH_ZERO_SELF_SIGNED_CERT)'],
    ['a certificate for another host', withCode('ERR_TLS_CERT_ALTNAME_INVALID'), 'TLS failed (ERR_TLS_CERT_ALTNAME_INVALID)'],
    ['an expired certificate', withCode('CERT_HAS_EXPIRED'), 'TLS failed (CERT_HAS_EXPIRED)'],
    ['an unknown issuer', withCode('UNABLE_TO_VERIFY_LEAF_SIGNATURE'), 'TLS failed (UNABLE_TO_VERIFY_LEAF_SIGNATURE)'],
    ['a TLS protocol error', withCode('ERR_SSL_WRONG_VERSION_NUMBER'), 'TLS failed (ERR_SSL_WRONG_VERSION_NUMBER)'],
    ['a server that answers a TLS request with no', new Error('The server does not support SSL connections'), 'TLS failed: the server does not offer TLS'],
    ['a missing file', withCode('ENOENT'), 'an unexpected error (ENOENT)'],
    ['a code that is not a plain name', withCode('E nope; secret'), 'an unexpected error'],
    ['a code that is not text', withCode(42), 'an unexpected error'],
    ['an error with no code', new Error('secret'), 'an unexpected error'],
    ['a broken pipe', withCode('EPIPE'), 'an unexpected error (EPIPE)'],
    ['a refused permission', withCode('EPERM'), 'an unexpected error (EPERM)'],
    ['a bad file descriptor', withCode('EBADF'), 'an unexpected error (EBADF)'],
    ['a broken pipe under a wrapper', new Error('secret', { cause: withCode('EPIPE') }), 'an unexpected error'],
    ['a wrong password', fromServer('28P01'), 'authentication failed'],
    ['a statement error', fromServer('42501'), 'a statement failed'],
    ['a statement error under a wrapper', new Error('secret', { cause: fromServer('42501') }), 'a statement failed'],
    ['a SQLSTATE on an error the server did not send', withCode('42501'), 'an unexpected error'],
  ])('names %s', (_case, error, reason) => {
    expect(failureReason(error)).toBe(reason);
  });
});

describe('failureDetails', () => {
  it.each([
    ['a broken pipe', withCode('EPIPE'), {}],
    ['a broken pipe under a wrapper', new Error('secret', { cause: withCode('EPIPE') }), {}],
    ['a SQLSTATE on an error the server did not send', withCode('42501'), {}],
    ['a statement error', fromServer('42501'), { code: '42501' }],
    [
      'a unique clash under a wrapper',
      new Error('secret', { cause: Object.assign(fromServer('23505'), { constraint: 'customers_email_key' }) }),
      { code: '23505', constraint: 'customers_email_key' },
    ],
  ])('for %s', (_case, error, details) => {
    expect(failureDetails(error)).toEqual(details);
  });
});
