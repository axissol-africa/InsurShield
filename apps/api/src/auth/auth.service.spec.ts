import type { Request } from 'express';
import { describe, expect, it } from 'vitest';
import { originAllowed } from '../common/auth/auth.guard.js';
import { ANONYMOUS, identityMatches } from '../common/auth/identity-precondition.js';
import { shownPhone } from '../common/auth/phone.js';

const TRUSTED = ['http://localhost:5173'];

function request(headers: Record<string, string>): Request {
  return { header: (name: string) => headers[name.toLowerCase()] } as unknown as Request;
}

describe('the identity precondition', () => {
  it.each([
    ['no header, no session', undefined, null, true],
    ['no header, a session', undefined, 'user-a', true],
    ['anonymous, no session', ANONYMOUS, null, true],
    ['anonymous, a session', ANONYMOUS, 'user-a', false],
    ['the session user', 'user-a', 'user-a', true],
    ['another user', 'user-a', 'user-b', false],
    ['a user, no session', 'user-a', null, false],
  ])('%s', (_case, header, sessionUserId, matches) => {
    expect(identityMatches(header, sessionUserId)).toBe(matches);
  });
});

describe('the origin rule for cookie-authenticated unsafe requests', () => {
  it.each([
    ['a trusted Origin', { origin: 'http://localhost:5173' }, true],
    ['no Origin, Sec-Fetch-Site same-origin', { 'sec-fetch-site': 'same-origin' }, true],
    ['a foreign Origin', { origin: 'https://evil.example' }, false],
    ['Origin null', { origin: 'null', 'sec-fetch-site': 'same-origin' }, false],
    ['no Origin, Sec-Fetch-Site cross-site', { 'sec-fetch-site': 'cross-site' }, false],
    ['neither header', {}, false],
  ])('%s', (_case, headers, allowed) => {
    expect(originAllowed(request(headers), TRUSTED)).toBe(allowed);
  });
});

describe('shownPhone', () => {
  it('hides the placeholder of a customer created before registration collected a phone', () => {
    expect(shownPhone('pending:7c1e')).toBeNull();
    expect(shownPhone('+260971234567')).toBe('+260971234567');
  });
});
