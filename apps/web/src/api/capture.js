/** Client for the photo hand-off relay (see capture-relay.js for the contract). */
const BASE = '/api/capture';
const NETWORK_RETRY_DELAYS = [0, 500, 1200];

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  /** Address a phone on the same network can reach; falls back to the current origin. */
  host: () => request('/host').then((body) => body.origin).catch(() => window.location.origin),
  create: (plate, shots, journey) => request('', { method: 'POST', body: JSON.stringify({ plate, shots, journey }) }),
  get: (code) => request(`/${code}`),
  putPhoto: (code, key, dataUrl) => request(`/${code}/photos/${key}`, { method: 'PUT', body: JSON.stringify({ dataUrl }) }),
  complete: (code) => request(`/${code}/complete`, { method: 'POST' }),
  /** Live event stream for a session; the caller closes it. */
  events: (code) => new EventSource(`${BASE}/${code}/events`),
};
