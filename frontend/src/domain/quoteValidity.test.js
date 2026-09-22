import { describe, expect, it } from 'vitest';
import { EXPIRING_SOON_DAYS, addDays, photosReusable, quoteValidity, requestStatus } from './quoteValidity';

const now = new Date('2026-09-21T10:00:00Z');
const at = (days) => addDays(now.toISOString(), days);

describe('quoteValidity', () => {
  it('reports days left and the valid-until date', () => {
    const v = quoteValidity({ validUntil: at(5) }, now);
    expect(v.expired).toBe(false);
    expect(v.expiringSoon).toBe(false);
    expect(v.daysLeft).toBe(5);
    expect(v.label).toMatch(/^Valid until .* 5 days left$/);
  });
  it('flags quotes ending within the warning window', () => {
    const v = quoteValidity({ validUntil: at(EXPIRING_SOON_DAYS) }, now);
    expect(v.expiringSoon).toBe(true);
    expect(v.expired).toBe(false);
  });
  it('marks past deadlines as expired', () => {
    const v = quoteValidity({ validUntil: at(-1) }, now);
    expect(v.expired).toBe(true);
    expect(v.label).toMatch(/^Expired on /);
    expect(quoteValidity({ validUntil: now.toISOString() }, now).expired).toBe(true);
  });
  it('treats a reply without a deadline as open', () => {
    expect(quoteValidity(null, now).expired).toBe(false);
    expect(quoteValidity({}, now).label).toBe('');
  });
});

describe('requestStatus', () => {
  const base = { id: 'QR-1', insurers: ['A', 'B'], expiresAt: at(10), insurerQuotes: {} };
  it('is pending with no replies and quoted once one arrives', () => {
    expect(requestStatus(base, now).status).toBe('pending');
    expect(requestStatus({ ...base, insurerQuotes: { A: { validUntil: at(5) } } }, now).status).toBe('quoted');
  });
  it('is expiring when any valid quote is inside the window', () => {
    const r = { ...base, insurerQuotes: { A: { validUntil: at(1) }, B: { validUntil: at(6) } } };
    expect(requestStatus(r, now)).toMatchObject({ status: 'expiring', validQuotes: 2 });
  });
  it('stays usable while at least one quote is valid', () => {
    const r = { ...base, insurerQuotes: { A: { validUntil: at(-1) }, B: { validUntil: at(6) } } };
    expect(requestStatus(r, now)).toMatchObject({ status: 'quoted', validQuotes: 1, expiredQuotes: 1 });
  });
  it('is expired when every quote has lapsed, or the request itself has', () => {
    expect(requestStatus({ ...base, insurerQuotes: { A: { validUntil: at(-2) } } }, now).status).toBe('expired');
    expect(requestStatus({ ...base, expiresAt: at(-1) }, now).status).toBe('expired');
    expect(requestStatus({ ...base, status: 'Expired' }, now).status).toBe('expired');
  });
});

describe('photosReusable', () => {
  it('allows recent photos and rejects old or missing ones', () => {
    expect(photosReusable(at(-3), now)).toBe(true);
    expect(photosReusable(at(-20), now)).toBe(false);
    expect(photosReusable(null, now)).toBe(false);
  });
});
