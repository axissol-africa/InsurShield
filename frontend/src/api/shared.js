/** Helpers used by both API adapters. */

export const newIdempotencyKey = () =>
  (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** Resolve after `ms`, so mock calls behave like network calls. */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
