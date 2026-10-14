/** Client for the photo hand-off relay (see capture-relay.js for the contract). */
const BASE = '/api/capture';
const NETWORK_RETRY_DELAYS = [0, 500, 1200];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const normalisePhoneOrigin = (value) => {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1' || parsed.hostname === '[::1]') return null;
    return parsed.origin;
  } catch {
    return null;
  }
};

const currentReachableOrigin = () => normalisePhoneOrigin(window.location.origin);

async function request(path, options = {}) {
  for (const delay of NETWORK_RETRY_DELAYS) {
    if (delay) await wait(delay);
    try {
      const response = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
      return body;
    } catch (error) {
      // A response from the relay is actionable and should be shown as-is.
      // Only transient network failures merit a retry.
      if (error.message && error.message !== 'Failed to fetch') throw error;
    }
  }
  throw new Error('Could not reach the live photo link. Check that your phone and computer are on the same Wi-Fi, then try again.');
}

export const captureApi = {
  /**
   * Address a phone can reach. Never generate a localhost QR link: localhost
   * refers to the phone itself after scanning and therefore cannot reach this
   * computer. A hosted app can safely fall back to its own public origin.
   */
  host: async () => {
    try {
      const body = await request('/host');
      const origin = normalisePhoneOrigin(body.origin);
      if (origin) return origin;
    } catch {
      // A deployed API may not need this development-only endpoint. Fall
      // through to a public current origin below when that is safe.
    }

    const fallback = currentReachableOrigin();
    if (fallback) return fallback;
    throw new Error('A phone link could not be created. Keep this computer and your phone on the same Wi-Fi, then restart the prototype and try again.');
  },
  create: (plate, shots, journey) => request('', { method: 'POST', body: JSON.stringify({ plate, shots, journey }) }),
  get: (code) => request(`/${code}`),
  putPhoto: (code, key, dataUrl) => request(`/${code}/photos/${key}`, { method: 'PUT', body: JSON.stringify({ dataUrl }) }),
  complete: (code) => request(`/${code}/complete`, { method: 'POST' }),
  /** Live event stream for a session; the caller closes it. */
  events: (code) => new EventSource(`${BASE}/${code}/events`),
};
