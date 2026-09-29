import Keycloak from 'keycloak-js';
import { env } from '@/config/env';

/**
 * The Keycloak client. Sign-in and sign-up happen on Keycloak's own pages
 * through the Authorization Code flow with PKCE, so no password ever reaches
 * this application or the API.
 */
export const keycloak = new Keycloak({
  url: env.keycloakUrl,
  realm: env.keycloakRealm,
  clientId: env.keycloakClientId,
});

/**
 * `keycloak.init` may only run once per page load, but React's StrictMode
 * mounts effects twice in development. Holding the promise here makes the
 * second call reuse the first result instead of throwing.
 */
let initPromise = null;

/**
 * How long to wait for Keycloak before carrying on signed out.
 *
 * The silent check runs in a hidden iframe, and an identity server that is
 * unreachable — or that does not recognise this origin — never answers it at
 * all. Without a deadline the whole site would sit behind its loading screen,
 * so a visitor who only wants to browse is held up by a service they do not
 * need yet.
 */
const INIT_TIMEOUT_MS = 3000;

/**
 * Restores an existing Keycloak session.
 *
 * @returns {Promise<{ authenticated: boolean, reachable: boolean }>}
 *   `reachable` is false when the identity server did not answer in time.
 *   That is not the same as "signed out", and callers must not treat it as
 *   such: a check that failed is no reason to end a session the visitor has.
 */
export function initKeycloak() {
  initPromise ??= Promise.race([
    keycloak
      .init({
        // Guests browse freely; this only restores a session that already exists.
        onLoad: 'check-sso',
        silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
        pkceMethod: 'S256',
        checkLoginIframe: false,
      })
      .then((authenticated) => ({ authenticated, reachable: true })),
    new Promise((resolve) => setTimeout(() => resolve({ authenticated: false, reachable: false }), INIT_TIMEOUT_MS)),
  ]);
  return initPromise;
}

const redirectUri = (next) =>
  `${window.location.origin}${next && next.startsWith('/') ? next : '/'}`;

/** Sends the visitor to Keycloak's sign-in page. */
export const signIn = (next) => keycloak.login({ redirectUri: redirectUri(next) });

/** Sends the visitor to Keycloak's registration page. */
export const signUp = (next) => keycloak.register({ redirectUri: redirectUri(next) });

/** Ends the Keycloak session as well as the local one. */
export const signOutOfKeycloak = () =>
  keycloak.logout({ redirectUri: `${window.location.origin}/` });
