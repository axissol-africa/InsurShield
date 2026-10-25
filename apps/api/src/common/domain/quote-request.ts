import type { QuoteRequestStatus } from './enums.js';

/** A quote request is open until it is marked expired or its expiry instant arrives. */
export const isRequestOpen = (status: QuoteRequestStatus, expiresAt: Date, now: Date): boolean =>
  status !== 'EXPIRED' && expiresAt > now;
