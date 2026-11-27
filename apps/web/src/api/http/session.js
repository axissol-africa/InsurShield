import { env } from '@/config/env';
import { getIdentityBinding, requestIdentityTransition } from '@/app/identity';
import { networkError, responseError } from '@/lib/ApiError';

/** Restore identity before fetching the feature client. */
export async function readSession({ boot = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (!boot) headers['X-InsurShield-User'] = getIdentityBinding() || 'anonymous';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let response;
  let payload;
  try {
    response = await fetch(`${env.apiBaseUrl.replace(/\/+$/, '')}/auth/me`, {
      credentials: 'include',
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    payload = await response.json();
  } catch {
    if (!response || response.ok) throw networkError();
  } finally {
    clearTimeout(timeout);
  }
  if (response.ok) return payload;

  const error = responseError(response.status, payload);
  if (error.status === 409 && error.code === 'IDENTITY_CHANGED') requestIdentityTransition();
  throw error;
}
