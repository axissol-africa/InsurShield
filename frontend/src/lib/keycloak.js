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

export function initKeycloak() {
  initPromise ??= keycloak.init({
    // Guests browse freely; this only restores a session that already exists.
    onLoad: 'check-sso',
    silentCheckSsoRedirectUri: `${window.location.origin}/silent-check-sso.html`,
    pkceMethod: 'S256',
    checkLoginIframe: false,
  });
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
