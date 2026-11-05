import { env } from '@/config/env';

export const IDENTITY_STORAGE_KEY = 'insurshield-identity';
export const IDENTITY_CHANNEL = 'insurshield-identity';

const live = () => env.apiMode === 'http';

const storage = () => (typeof window === 'undefined' ? null : window.sessionStorage);

export const getIdentityBinding = () => (live() ? storage()?.getItem(IDENTITY_STORAGE_KEY) || null : null);

export const setIdentityBinding = (userId) => {
  if (!live() || !userId) return;
  storage()?.setItem(IDENTITY_STORAGE_KEY, userId);
};

export const clearIdentityBinding = () => {
  if (live()) storage()?.removeItem(IDENTITY_STORAGE_KEY);
};

/** Tabs only announce their own cookie-changing action. Receivers never echo it. */
export const announceIdentity = (userId) => {
  if (!live() || typeof BroadcastChannel === 'undefined') return;
  const channel = new BroadcastChannel(IDENTITY_CHANNEL);
  channel.postMessage({ userId: userId || null });
  channel.close();
};

/** Reject a redirect that could leave the application after a sign-in. */
export const safeApplicationPath = (candidate, fallback = '/account') => {
  if (!candidate || typeof window === 'undefined') return fallback;
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\') || /[a-z][a-z\d+.-]*:/i.test(candidate)) return fallback;

  try {
    return new URL(candidate, window.location.origin).origin === window.location.origin ? candidate : fallback;
  } catch {
    return fallback;
  }
};

let controller = null;

/** Installed by the HTTP-session boundary once React has mounted. */
export const setIdentityController = (nextController) => {
  controller = nextController;
  return () => {
    if (controller === nextController) controller = null;
  };
};

/** Used by the HTTP interceptor when the API refuses a stale tab identity. */
export const requestIdentityTransition = (options) => controller?.transition(options);

/** Used by the sign-in pages after a successful cookie-changing action. */
export const adoptOwnIdentity = (identity) => controller?.adopt(identity) ?? { transitioned: false };
