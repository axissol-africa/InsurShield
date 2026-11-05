/** The Better Auth user a browser tab is bound to, or `anonymous`. It grants nothing; it only refuses. */
export const IDENTITY_HEADER = 'x-insurshield-user';
export const ANONYMOUS = 'anonymous';

/**
 * Whether a request begun for the person in the header may run under the session it arrived with.
 * No header: always. `anonymous`: only without a session. A user id: only with that user's session.
 */
export function identityMatches(header: string | undefined, sessionUserId: string | null): boolean {
  if (header === undefined) return true;
  if (header === ANONYMOUS) return sessionUserId === null;
  return sessionUserId !== null && header === sessionUserId;
}

export function identityHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(',') : value;
}
