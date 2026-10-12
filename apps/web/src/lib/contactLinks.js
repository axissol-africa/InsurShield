/**
 * Links that call or write to a person, built from details that person typed.
 *
 * A phone number or email address goes into a `tel:` or `mailto:` address
 * only when it is nothing but a number or an address. Anything else — a dial
 * code, a pause, a second recipient, a subject or a body — would make the
 * link do more than reach that person, so it gets no link and is shown as
 * text instead.
 */

/** Spacing people put in phone numbers, which a dialler does not need. */
const PHONE_SEPARATORS = /[\s().-]/g;
const TRUNK_ZERO_AFTER_COUNTRY_CODE = /^(\s*\+\d{1,3})\s*\(0\)/;
const MAX_EMAIL_LENGTH = 254;
const PHONE_NUMBER = /^\+?\d{6,15}$/;
const EMAIL_ADDRESS = /^[A-Za-z0-9._+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

/** `tel:` address for a plain phone number, or `null` when it is not one. */
export function telHref(phone) {
  // "+260 (0) 97…" is written for both local and foreign callers; the 0 is not dialled after a country code.
  const number = String(phone ?? '').replace(TRUNK_ZERO_AFTER_COUNTRY_CODE, '$1').replace(PHONE_SEPARATORS, '');
  return PHONE_NUMBER.test(number) ? `tel:${number}` : null;
}

/** `mailto:` address for a single plain email address, or `null` when it is not one. */
export function mailtoHref(email) {
  const address = String(email ?? '').trim();
  return address.length <= MAX_EMAIL_LENGTH && EMAIL_ADDRESS.test(address) ? `mailto:${address}` : null;
}
