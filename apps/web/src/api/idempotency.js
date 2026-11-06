import { newIdempotencyKey } from './shared';

const PREFIX = 'insurshield:pending-command:';
const fallback = new Map();

function pendingStore() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function read(name) {
  const store = pendingStore();
  const raw = store ? store.getItem(PREFIX + name) : fallback.get(name);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    if (store) store.removeItem(PREFIX + name);
    else fallback.delete(name);
    return null;
  }
}

function write(name, record) {
  const raw = JSON.stringify(record);
  const store = pendingStore();
  if (store) store.setItem(PREFIX + name, raw);
  else fallback.set(name, raw);
}

function remove(name) {
  const store = pendingStore();
  if (store) store.removeItem(PREFIX + name);
  else fallback.delete(name);
}

/**
 * Saves a prepared command before sending it, allowing a lost HTTP response to
 * be retried with the same uploaded document IDs and idempotency key.
 */
export async function submitWithRetry({ operation, fingerprint, prepare, send }) {
  let pending = read(operation);
  if (!pending || pending.fingerprint !== fingerprint) {
    pending = { fingerprint, key: newIdempotencyKey(), payload: await prepare() };
    write(operation, pending);
  }

  try {
    const result = await send(pending.payload, pending.key);
    remove(operation);
    return result;
  } catch (error) {
    // A reused key means the browser cache is no longer a safe retry source.
    if (error?.code === 'IDEMPOTENCY_KEY_REUSED') remove(operation);
    throw error;
  }
}
