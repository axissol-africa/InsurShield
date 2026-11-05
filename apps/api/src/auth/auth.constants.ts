import type { Env } from '../config/env.js';

export const AUTH = Symbol('AUTH');
export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');

/** Shared by the cookie options and the identity-route middleware that looks for the session cookie. */
export const COOKIE_PREFIX = 'insurshield';

/** Set by the API from `req.ip` on every identity request; the only address Better Auth reads. */
export const CLIENT_ADDRESS_HEADER = 'x-insurshield-client-ip';

export const PASSWORD_POLICY = { minPasswordLength: 8, maxPasswordLength: 128 } as const;

export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

export function identityBasePath(apiPrefix: string): string {
  return `/${apiPrefix.replace(/^\/+|\/+$/g, '')}/identity`;
}

/** The password-reset and email-verification routes exist only where a developer can read the mailer's log. */
export function mailRoutesEnabled(nodeEnv: Env['NODE_ENV']): boolean {
  return nodeEnv === 'development' || nodeEnv === 'test';
}
