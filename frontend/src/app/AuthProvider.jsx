import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '@/store';
import { keycloak, initKeycloak } from '@/lib/keycloak';
import { apiClient } from '@/lib/apiClient';

/**
 * Restores the Keycloak session on load and keeps the store in step with it.
 *
 * Keycloak is the source of truth for who is signed in. Anything the browser
 * persisted from a previous visit is discarded when Keycloak says there is no
 * session, so a stale local flag can never leave someone apparently signed in.
 *
 * The phone capture page is the one exception: it is opened from a QR code on
 * a LAN address where Keycloak is not reachable, and the session code in the
 * link is its authorisation. Bootstrapping Keycloak there would block the page
 * on a request that cannot succeed.
 */
const isPhoneCapture = (pathname) => pathname.startsWith('/capture/');

export default function AuthProvider({ children }) {
  const { pathname } = useLocation();
  const skipAuth = isPhoneCapture(pathname);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (skipAuth) return undefined;
    let cancelled = false;

    const sync = async () => {
      let authenticated = false;
      try {
        authenticated = await initKeycloak();
      } catch (error) {
        // A Keycloak that is down must not take the whole site with it —
        // public pages keep working, signed out.
        console.error('Keycloak could not be reached', error);
      }
      if (cancelled) return;

      const store = useStore.getState();

      if (!authenticated) {
        store.clearCustomerSession();
        setReady(true);
        return;
      }

      store.setAuthToken(keycloak.token);

      // Refresh shortly before expiry so an in-flight request never carries a
      // token that has just lapsed.
      keycloak.onTokenExpired = () => {
        keycloak
          .updateToken(30)
          .then(() => useStore.getState().setAuthToken(keycloak.token))
          .catch(() => useStore.getState().clearCustomerSession());
      };

      try {
        const { customer, consent } = await apiClient.get('/auth/me');
        if (!cancelled && customer) store.applyCustomerSession(customer, consent);
      } catch (error) {
        // The token is valid but the profile could not be loaded. Fall back to
        // the token's own claims so the person is still signed in.
        console.error('Could not load the account profile', error);
        const claims = keycloak.tokenParsed ?? {};
        if (!cancelled) {
          store.applyCustomerSession({
            fullName: claims.name ?? claims.preferred_username ?? '',
            email: claims.email ?? '',
            phone: null,
          });
        }
      }

      if (!cancelled) setReady(true);
    };

    void sync();
    return () => {
      cancelled = true;
    };
  }, [skipAuth]);

  // Rendering before the session is known would flash the signed-out header
  // and bounce guarded routes. The capture page has no session to wait for.
  if (!skipAuth && !ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <span className="sr-only">Checking your session…</span>
        <span aria-hidden="true" className="flex items-center gap-1.5">
          {Array.from({ length: 12 }, (_, index) => (
            <span
              key={index}
              className="dot-pulse block h-[3px] w-[3px] rounded-full bg-primary"
              style={{ animationDelay: `${index * 0.09}s` }}
            />
          ))}
        </span>
      </div>
    );
  }

  return children;
}
