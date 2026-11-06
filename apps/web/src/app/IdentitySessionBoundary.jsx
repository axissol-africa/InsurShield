import { useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/Button';
import { api, ApiError } from '@/api';
import { env } from '@/config/env';
import { useStore } from '@/store';
import {
  IDENTITY_CHANNEL,
  announceIdentity,
  clearIdentityBinding,
  getIdentityBinding,
  setIdentityBinding,
  setIdentityController,
} from './identity';
import { clearHttpPersistence, suspendHttpPersistence } from '@/store/persistence';

const isHttp = () => env.apiMode === 'http';

/**
 * Owns the browser's cookie session in HTTP mode. A tab binds its private
 * sessionStorage state to one Better Auth user; the server remains the source
 * of truth and rejects requests if the browser cookie changes underneath it.
 */
export default function IdentitySessionBoundary({ children }) {
  const booting = useRef(false);
  const staleBoot = useRef(false);
  const bootRetry = useRef(false);

  const transition = useCallback(({ landing, userId, announce = false } = {}) => {
    if (!isHttp()) return false;
    const state = useStore.getState();
    if (state.leaving) return true;

    const resolvedLanding = landing || (state.staffSession ? '/admin-login' : '/');
    if (announce) announceIdentity(userId);
    suspendHttpPersistence();
    state.beginIdentityTransition();
    clearHttpPersistence();
    clearIdentityBinding();
    window.location.replace(resolvedLanding);
    return true;
  }, []);

  const applyProfile = useCallback((profile) => {
    const state = useStore.getState();
    if (state.leaving) return;
    if (profile.staffSession) {
      state.applyStaffSession(profile.staffSession);
      return;
    }
    if (profile.customer) state.applyCustomerSession(profile.customer, profile.consent);
  }, []);

  const settleGuest = useCallback(() => {
    const state = useStore.getState();
    if (state.leaving) return;
    clearIdentityBinding();
    state.clearHttpSession();
    state.setIdentityReady(true);
  }, []);

  const boot = useCallback(async () => {
    if (!isHttp() || booting.current) return;
    booting.current = true;
    bootRetry.current = false;
    useStore.getState().setIdentityReady(false);
    try {
      while (true) {
        const binding = getIdentityBinding();
        try {
          const profile = await api.auth.me({ boot: !binding });
          if (staleBoot.current && !bootRetry.current) {
            staleBoot.current = false;
            bootRetry.current = true;
            continue;
          }

          if (!profile?.userId || (binding && binding !== profile.userId)) {
            transition();
            return;
          }
          setIdentityBinding(profile.userId);
          applyProfile(profile);
          useStore.getState().setIdentityReady(true);
          return;
        } catch (error) {
          if (staleBoot.current && !bootRetry.current) {
            staleBoot.current = false;
            bootRetry.current = true;
            continue;
          }
          if (error instanceof ApiError && error.status === 401 && !binding) {
            settleGuest();
          } else if (!(error instanceof ApiError && error.code === 'IDENTITY_CHANGED')) {
            useStore.getState().setIdentityFailure(error instanceof Error ? error.message : 'We could not restore your session.');
          }
          return;
        }
      }
    } finally {
      booting.current = false;
    }
  }, [applyProfile, settleGuest, transition]);

  const adopt = useCallback(({ userId, profile, landing, announce = true }) => {
    if (!isHttp() || !userId) return { transitioned: false };
    const binding = getIdentityBinding();
    if (binding && binding !== userId) {
      transition({ landing, userId, announce });
      return { transitioned: true };
    }
    setIdentityBinding(userId);
    if (announce) announceIdentity(userId);
    applyProfile(profile);
    useStore.getState().setIdentityReady(true);
    return { transitioned: false };
  }, [applyProfile, transition]);

  useEffect(() => {
    if (!isHttp()) {
      useStore.getState().setIdentityReady(true);
      return undefined;
    }
    return setIdentityController({ transition, adopt });
  }, [adopt, transition]);

  useEffect(() => {
    if (!isHttp()) return undefined;
    void boot();

    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(IDENTITY_CHANNEL);
    const onMessage = (event) => {
      const nextUserId = event.data?.userId || null;
      if (booting.current) {
        staleBoot.current = true;
        return;
      }
      const binding = getIdentityBinding();
      if (binding && binding !== nextUserId) transition();
    };
    channel?.addEventListener('message', onMessage);

    const onPageShow = (event) => {
      if (event.persisted) {
        void boot();
      }
    };
    window.addEventListener('pageshow', onPageShow);

    return () => {
      channel?.removeEventListener('message', onMessage);
      channel?.close();
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [boot, transition]);

  const { identityReady, leaving, identityFailure } = useStore();
  if (isHttp() && (!identityReady || leaving)) {
    return (
      <main className="grid min-h-screen place-items-center bg-muted/60 p-6" aria-live="polite">
        <section className="w-full max-w-sm rounded-xl border border-border bg-card p-6 text-center shadow-none">
          <span className="material-symbols-outlined animate-spin text-2xl text-primary" aria-hidden="true">sync</span>
          <h1 className="mt-3 text-lg font-semibold">Checking your session</h1>
          <p className="mt-2 text-sm text-muted-foreground">We are keeping this tab private while your account is confirmed.</p>
          {identityFailure && <p role="alert" className="mt-4 text-sm text-primary">{identityFailure}</p>}
          {identityFailure && <Button className="mt-4" variant="outline" onClick={() => void boot()}>Try again</Button>}
        </section>
      </main>
    );
  }

  return children;
}
