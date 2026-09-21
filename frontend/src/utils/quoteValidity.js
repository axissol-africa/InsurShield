/**
 * Quote validity rules.
 *
 * Every insurer's final quote is an offer with a deadline set by that insurer
 * (`quoteValidityDays` in the catalogue, extendable from the insurer portal).
 * A request as a whole also expires, because the declared value and live
 * photos go stale. Expired quotes can be seen but never paid for; the
 * customer re-requests with their previous details pre-filled.
 */
import { formatDate } from './premiumEngine';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Default validity when an insurer has not configured one. */
export const DEFAULT_QUOTE_VALIDITY_DAYS = 5;
/** Flag a quote as "expiring soon" when it ends within this many days. */
export const EXPIRING_SOON_DAYS = 2;
/** A request with no valid quotes after this many days is expired regardless of replies. */
export const REQUEST_VALIDITY_DAYS = 14;
/** Live inspection photos may be reused on a new request only if captured within this window. */
export const PHOTO_REUSE_DAYS = 14;

export const addDays = (iso, days) => new Date(new Date(iso).getTime() + days * MS_PER_DAY).toISOString();

const daysUntil = (iso, now) => Math.ceil((new Date(iso).getTime() - now.getTime()) / MS_PER_DAY);

/**
 * Validity of one insurer reply.
 * @returns {{ validUntil: string|null, daysLeft: number|null, expired: boolean, expiringSoon: boolean, label: string }}
 */
export function quoteValidity(reply, now = new Date()) {
  if (!reply?.validUntil) return { validUntil: null, daysLeft: null, expired: false, expiringSoon: false, label: '' };
  const daysLeft = daysUntil(reply.validUntil, now);
  const expired = new Date(reply.validUntil) <= now;
  const expiringSoon = !expired && daysLeft <= EXPIRING_SOON_DAYS;
  const label = expired
    ? `Expired on ${formatDate(reply.validUntil)}`
    : `Valid until ${formatDate(reply.validUntil)} · ${daysLeft === 0 ? 'ends today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}`;
  return { validUntil: reply.validUntil, daysLeft, expired, expiringSoon, label };
}

/**
 * Overall status of a quote request for the customer's account.
 * @returns {{ status: 'expired'|'expiring'|'quoted'|'pending', validQuotes: number, expiredQuotes: number, replies: number, expiresAt: string|null }}
 */
export function requestStatus(request, now = new Date()) {
  if (!request) return { status: 'pending', validQuotes: 0, expiredQuotes: 0, replies: 0, expiresAt: null };
  if (request.status === 'Expired') return { status: 'expired', validQuotes: 0, expiredQuotes: 0, replies: Object.keys(request.insurerQuotes || {}).length, expiresAt: request.expiresAt || null };

  const replies = Object.values(request.insurerQuotes || {});
  const validity = replies.map((reply) => quoteValidity(reply, now));
  const valid = validity.filter((v) => !v.expired);
  const requestExpired = request.expiresAt ? new Date(request.expiresAt) <= now : false;

  if (replies.length && !valid.length) return { status: 'expired', validQuotes: 0, expiredQuotes: replies.length, replies: replies.length, expiresAt: request.expiresAt || null };
  if (!replies.length && requestExpired) return { status: 'expired', validQuotes: 0, expiredQuotes: 0, replies: 0, expiresAt: request.expiresAt || null };
  if (valid.some((v) => v.expiringSoon)) return { status: 'expiring', validQuotes: valid.length, expiredQuotes: replies.length - valid.length, replies: replies.length, expiresAt: request.expiresAt || null };
  return { status: replies.length ? 'quoted' : 'pending', validQuotes: valid.length, expiredQuotes: replies.length - valid.length, replies: replies.length, expiresAt: request.expiresAt || null };
}

/** Whether inspection photos captured at `capturedAt` may be reused on a new request. */
export const photosReusable = (capturedAt, now = new Date()) =>
  Boolean(capturedAt) && new Date(capturedAt).getTime() + PHOTO_REUSE_DAYS * MS_PER_DAY > now.getTime();
