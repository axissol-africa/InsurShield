import { randomBytes } from 'node:crypto';
import { identityBasePath } from '../src/auth/auth.constants.js';
import { TEST_PASSWORD } from './builders.js';
import type { Http } from './helpers.js';

/** The headers a signed-in browser on the run's trusted origin sends: its session cookie and its `Origin`. */
export interface SessionHeaders {
  Cookie: string;
  Origin: string;
  [name: string]: string;
}

/** The first origin in `CORS_ORIGINS`, which the API trusts for cookie-authenticated writes. */
export function trustedOrigin(): string {
  const origin = (process.env.CORS_ORIGINS ?? '').split(',')[0].trim();
  if (!origin) throw new Error('CORS_ORIGINS must be set for the e2e suite');
  return origin;
}

/** A path under the identity base path, for the run's API prefix. */
export function identityPath(path: string): string {
  return `${identityBasePath(process.env.API_PREFIX ?? 'api/v1')}${path}`;
}

/** The `name=value` pairs of the cookies a response sets, without their attributes. */
export function cookiesSet(setCookie: string | string[] | undefined): string[] {
  const lines = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  return lines.map((line) => line.split(';')[0]);
}

/** Signs in through the real identity route and answers the headers that carry the session. */
export async function signIn(
  http: Http,
  user: { email: string },
  password = TEST_PASSWORD,
): Promise<SessionHeaders> {
  const origin = trustedOrigin();
  const response = await http
    .post(identityPath('/sign-in/email'))
    .set('Origin', origin)
    .send({ email: user.email, password });
  if (response.status !== 200) {
    throw new Error(`Sign-in for a built user answered ${response.status}: ${JSON.stringify(response.body)}`);
  }
  const cookies = cookiesSet(response.headers['set-cookie']);
  if (cookies.length === 0) throw new Error('Sign-in set no cookie');
  return { Cookie: cookies.join('; '), Origin: origin };
}

export function uniqueEmail(prefix = 'reg'): string {
  return `${prefix}-${randomBytes(5).toString('hex')}@example.invalid`;
}

/** A documentation address no other test uses, so each test has its own rate-limit buckets. */
export function uniqueAddress(): string {
  const [a, b] = randomBytes(2);
  return `198.18.${a}.${b}`;
}

/** A sign-in from `address` behind one proxy, with any body, answered as it comes. */
export function signInAttempt(http: Http, body: unknown, address = uniqueAddress()) {
  return http
    .post(identityPath('/sign-in/email'))
    .set('Origin', trustedOrigin())
    .set('X-Forwarded-For', address)
    .set('Content-Type', 'application/json')
    .send(typeof body === 'string' ? body : JSON.stringify(body));
}
