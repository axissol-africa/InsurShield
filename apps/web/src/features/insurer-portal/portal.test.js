import { describe, expect, it } from 'vitest';
import { AWAITING_CERTIFICATE, benefitsForCoverage, isOpenNcdApplication, portalPath, premiumCheck, quoteOpenUntil, replyDeadline, statusTone, toPortalRequest, waitingLongestFirst } from './portal';

describe('toPortalRequest', () => {
  const request = {
    id: 'QR-1', submittedAt: new Date().toISOString(), customer: { fullName: 'Mwiza Banda', phone: '0970123456' },
    vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' }, vehicleValue: 250000, vehicleUsage: 'Individual',
    insuranceType: 'ThirdParty', coverageDurationId: '4q', policyDates: null, inspectionShots: ['insp_front', 'insp_rear'],
    insurerQuotes: { 'Prestige Assurance': { premium: 10900 } },
  };

  it('formats the request for display and picks out this insurer’s reply', () => {
    const portal = toPortalRequest(request, 'Prestige Assurance');
    expect(portal).toMatchObject({ value: 'ZMW 250,000.00', coverage: 'Third Party Only', client: 'Mwiza Banda', contact: '0970123456', period: '1 Year (12 Months)', dates: 'From payment date', plate: 'BAA 1234', photos: 2, time: 'just now' });
    expect(portal.reply).toEqual({ premium: 10900 });
    expect(toPortalRequest(request, 'Global Guard Insurance').reply).toBeNull();
  });

  it('has sensible fallbacks for sparse records', () => {
    const portal = toPortalRequest({ id: 'QR-2', insurers: [] }, 'Prestige Assurance');
    expect(portal).toMatchObject({ vehicle: 'Vehicle pending', value: 'ZMW 0.00', usage: 'Private', coverage: 'Comprehensive', client: 'Customer', contact: '', period: '—', plate: '', photos: 0, reply: null });
  });
});

describe('portal helpers', () => {
  it('does not send comprehensive-only benefits in a third-party guide', () => {
    const insurer = { benefits: ['Third Party Property Damage', 'Own Damage', 'Theft & Fire Coverage', 'Medical Expenses up to ZMW 20,000'] };
    expect(benefitsForCoverage(insurer, 'ThirdParty')).toEqual(['Third Party Property Damage', 'Medical Expenses up to ZMW 20,000']);
    expect(benefitsForCoverage(insurer, 'Comprehensive')).toHaveLength(4);
  });

  it('treats submitted and under-review NCD applications as open', () => {
    expect(isOpenNcdApplication({ status: 'Submitted' })).toBe(true);
    expect(isOpenNcdApplication({ status: 'Under Review' })).toBe(true);
    expect(isOpenNcdApplication({ status: 'Approved' })).toBe(false);
  });

  it('marks open work for attention and everything else as dealt with', () => {
    for (const status of ['Notified', 'Submitted', 'Under Review', AWAITING_CERTIFICATE]) expect(statusTone(status)).toBe('open');
    for (const status of ['Received by insurer', 'Approved', 'Active']) expect(statusTone(status)).toBe('settled');
    expect(statusTone('Rejected')).toBe('declined');
    // An unrecognised status must never look like open work.
    expect(statusTone('Whatever')).toBe('settled');
  });

  it('gives every portal screen an address', () => {
    expect(portalPath.section('overview')).toBe('/insurer');
    expect(portalPath.section('claims')).toBe('/insurer?view=claims');
    expect(portalPath.quote('QR 1/2')).toBe('/insurer?quote=QR%201%2F2');
    expect(portalPath.issue('PA-2026-011293')).toBe('/insurer?view=policies&issue=PA-2026-011293');
  });
});

describe('replyDeadline', () => {
  const now = new Date('2026-10-12T10:00:00Z');

  it('says when the customer’s request stops taking quotes and how long is left', () => {
    expect(replyDeadline({ expiresAt: '2026-10-26T10:00:00Z' }, now)).toEqual({ label: 'Reply by 26 Oct 2026 · 14 days left', urgent: false });
    expect(replyDeadline({ expiresAt: '2026-10-13T10:00:00Z' }, now)).toEqual({ label: 'Reply by 13 Oct 2026 · 1 day left', urgent: true });
  });

  it('says so when the request has closed, and nothing when it carries no deadline', () => {
    expect(replyDeadline({ expiresAt: '2026-10-11T10:00:00Z' }, now)).toEqual({ label: 'Closed for quotes on 11 Oct 2026', urgent: true });
    expect(replyDeadline({}, now)).toBeNull();
  });
});

describe('premiumCheck', () => {
  it('questions a premium far from the indicative estimate, which is usually a slipped digit', () => {
    expect(premiumCheck(2340, 23400)).toBe('low');
    expect(premiumCheck(234000, 23400)).toBe('high');
  });

  it('accepts an insurer pricing differently, and has nothing to say without both figures', () => {
    expect(premiumCheck(14000, 23400)).toBeNull();
    expect(premiumCheck(40000, 23400)).toBeNull();
    expect(premiumCheck(0, 23400)).toBeNull();
    expect(premiumCheck(10650, 0)).toBeNull();
  });
});

describe('waitingLongestFirst', () => {
  it('orders work by who has waited longest', () => {
    const records = [{ id: 'new', at: '2026-10-12T09:00:00Z' }, { id: 'old', at: '2026-10-10T09:00:00Z' }, { id: 'mid', at: '2026-10-11T09:00:00Z' }];
    expect([...records].sort(waitingLongestFirst((record) => record.at)).map((record) => record.id)).toEqual(['old', 'mid', 'new']);
  });
});

describe('quoteOpenUntil', () => {
  it('gives the date a quote sent now stays open until', () => {
    expect(quoteOpenUntil(7, new Date('2026-10-12T10:00:00Z'))).toBe('19 Oct 2026');
  });
});
