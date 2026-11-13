
export const AUTH = Symbol('AUTH');
export const AUTH_SETTINGS = Symbol('AUTH_SETTINGS');

/** Shared by the cookie options and the identity-route middleware that looks for the session cookie. */
export const COOKIE_PREFIX = 'insurshield';

/** Set by the API from `req.ip` on every identity request; the only address Better Auth reads. */
export const CLIENT_ADDRESS_HEADER = 'x-insurshield-client-ip';

export const PASSWORD_POLICY = { minPasswordLength: 8, maxPasswordLength: 128 } as const;

export const SESSION_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

/** Staff sessions are deliberately shorter than customer sessions. */
export const STAFF_SESSION_ABSOLUTE_LIFETIME_SECONDS = 8 * 60 * 60;
export const STAFF_SESSION_IDLE_LIFETIME_SECONDS = 30 * 60;
export const STAFF_MAX_CONCURRENT_SESSIONS = 3;
export const STAFF_MFA_CHALLENGE_LIFETIME_SECONDS = 5 * 60;
export const STAFF_MFA_CODE_LIFETIME_MINUTES = 5;
export const STAFF_MFA_MAX_CODE_ATTEMPTS = 5;
export const STAFF_MFA_LOCKOUT_SECONDS = 15 * 60;

/** Both self-service and administrator-assisted links expire after one hour. */
export const PASSWORD_RESET_TOKEN_LIFETIME_SECONDS = 60 * 60;

/**
 * Administrator-assisted reset links are deliberately scarce. Failed delivery
 * still counts: otherwise an unavailable mail provider becomes a way to keep
 * asking the platform to generate recovery credentials.
 */
export const SUPPORT_PASSWORD_RESET_WINDOW_SECONDS = 60 * 60;
export const SUPPORT_PASSWORD_RESET_MAX_PER_CUSTOMER = 3;
export const SUPPORT_PASSWORD_RESET_MAX_PER_STAFF = 5;

export function identityBasePath(apiPrefix: string): string {
  return `/${apiPrefix.replace(/^\/+|\/+$/g, '')}/identity`;
}

