/** Client for the photo hand-off relay (see capture-relay.js for the contract). */
const BASE = '/api/capture';

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, { headers: { 'Content-Type': 'application/json' }, ...options });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export const captureApi = {
  /** Address a phone on the same network can reach; falls back to the current origin. */
  host: () => request('/host').then((body) => body.origin).catch(() => window.location.origin),
  create: (plate, shots) => request('', { method: 'POST', body: JSON.stringify({ plate, shots }) }),
  get: (code) => request(`/${code}`),
  putPhoto: (code, key, dataUrl) => request(`/${code}/photos/${key}`, { method: 'PUT', body: JSON.stringify({ dataUrl }) }),
  complete: (code) => request(`/${code}/complete`, { method: 'POST' }),
};
