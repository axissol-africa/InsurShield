import { newIdempotencyKey } from './shared';

const PREFIX = 'insurshield:pending-command:';
const fallback = new Map();
let identityGeneration = 0;

function pendingStore() {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
}

function read(name) {
  let raw = fallback.get(name);
  try { raw ??= pendingStore()?.getItem(PREFIX + name); } catch { /* Storage can be disabled by browser privacy settings. */ }
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { remove(name); return null; }
}

function write(name, record) {
  const raw = JSON.stringify(record);
  try {
    const store = pendingStore();
    if (store) { store.setItem(PREFIX + name, raw); fallback.delete(name); return; }
  } catch { /* Keep retries in memory when browser storage is unavailable. */ }
  fallback.set(name, raw);
}

function remove(name) {
  fallback.delete(name);
  try { pendingStore()?.removeItem(PREFIX + name); } catch { /* Storage is unavailable. */ }
}

export function clearPendingCommands() {
  identityGeneration += 1;
  fallback.clear();
  const store = pendingStore();
  if (!store) return;
  try {
    const keys = Array.from({ length: store.length }, (_, index) => store.key(index));
    for (const key of keys) if (key?.startsWith(PREFIX)) store.removeItem(key);
  } catch { /* The in-memory queue is still cleared when storage is disabled. */ }
}

/** Keep prepared payloads and keys stable after a lost response, within one identity. */
export async function submitWithRetry({ operation, fingerprint, prepare, send }) {
  const generation = identityGeneration;
  const assertIdentity = () => {
    if (generation !== identityGeneration) throw new Error('Your account changed. Start this action again in your current account.');
  };
  let pending = read(operation);
  if (!pending || pending.fingerprint !== fingerprint) {
    pending = { fingerprint, key: newIdempotencyKey(), payload: await prepare() };
    assertIdentity();
    write(operation, pending);
  }

  try {
    assertIdentity();
    const result = await send(pending.payload, pending.key);
    assertIdentity();
    remove(operation);
    return result;
  } catch (error) {
    if (generation === identityGeneration && error?.code === 'IDEMPOTENCY_KEY_REUSED') remove(operation);
    throw error;
  }
}
