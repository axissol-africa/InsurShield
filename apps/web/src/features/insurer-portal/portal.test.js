import { describe, expect, it } from 'vitest';
import { AWAITING_CERTIFICATE, awaitsInsurer, benefitsForCoverage, quotableNow, coverTypeOf, isOpenNcdApplication, portalPath, premiumCheck, quoteOpenUntil, replyDeadline, statusTone, toPortalCases, toPortalRequest, waitingLongestFirst } from './portal';

describe('toPortalRequest', () => {
  const request = {
    id: 'QR-1', submittedAt: new Date().toISOString(), customer: { fullName: 'Mwiza Banda', phone: '0970123456' },
    vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' }, vehicleValue: 250000, vehicleUsage: 'Individual',
    insuranceType: 'ThirdParty', coverageDurationId: '4q', policyDates: null, inspectionShots: ['insp_front', 'insp_rear'],
    insurerQuotes: { 'Prestige Assurance': { premium: 10900 } },
  };

  it('formats the request for display and picks out this insurer’s reply', () => {
    const portal = toPortalRequest(request, 'Prestige Assurance');
    expect(portal).toMatchObject({ value: 'ZMW 250,000.00', coverage: 'Third Party Only', client: 'Mwiza Banda', period: '1 Year (12 Months)', dates: 'From payment date', plate: 'BAA 1234', photos: 2, time: 'just now' });
    expect(portal.reply).toEqual({ premium: 10900 });
    expect(toPortalRequest(request, 'Global Guard Insurance').reply).toBeNull();
  });

  it('names the cover type one way, whatever the record calls it', () => {
    expect(coverTypeOf({ insuranceType: 'ThirdParty' })).toBe('ThirdParty');
    expect(coverTypeOf({ coverage: 'Third Party Only' })).toBe('ThirdParty');
    // Anything unrecognised is priced as comprehensive, as the queue already labels it.
    for (const request of [{ insuranceType: 'Comprehensive' }, { insuranceType: 'third party' }, { insuranceType: 'Fleet' }, {}]) {
      expect(coverTypeOf(request)).toBe('Comprehensive');
    }
    expect(toPortalRequest({ id: 'QR-3', insuranceType: 'Fleet' }, 'Prestige Assurance').coverage).toBe('Comprehensive');
  });

  it('has sensible fallbacks for sparse records', () => {
    const portal = toPortalRequest({ id: 'QR-2', insurers: [] }, 'Prestige Assurance');
    expect(portal).toMatchObject({ vehicle: 'Vehicle pending', value: 'ZMW 0.00', usage: 'Private', coverage: 'Comprehensive', client: 'Customer', period: '—', plate: '', photos: 0, reply: null });
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

  it('says the reply is overdue once the date has passed, without claiming the request is closed', () => {
    // A late quote is still accepted, so the label must not say otherwise.
    expect(replyDeadline({ expiresAt: '2026-10-11T10:00:00Z' }, now)).toEqual({ label: 'Reply was due 11 Oct 2026', urgent: true });
  });

  it('says nothing when the request carries no deadline, or one that is not a date', () => {
    expect(replyDeadline({}, now)).toBeNull();
    expect(replyDeadline({ expiresAt: 'soon' }, now)).toBeNull();
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

  it('puts a record whose wait is unknown first rather than losing it in the order', () => {
    const records = [{ id: 'new', at: '2026-10-12T09:00:00Z' }, { id: 'garbled', at: 'yesterday' }, { id: 'old', at: '2026-10-10T09:00:00Z' }, { id: 'undated' }];
    const order = waitingLongestFirst((record) => record.at);
    expect(order(records[1], records[0])).not.toBeNaN();
    expect([...records].sort(order).map((record) => record.id)).toEqual(['garbled', 'undated', 'old', 'new']);
  });
});

describe('quoteOpenUntil', () => {
  it('gives the date a quote sent now stays open until', () => {
    expect(quoteOpenUntil(7, new Date('2026-10-12T10:00:00Z'))).toBe('19 Oct 2026');
  });
});

describe('toPortalCases', () => {
  const INSURER = 'Prestige Assurance';
  const base = {
    id: 'QR-2', submittedAt: new Date().toISOString(), vehicle: '2021 Toyota Corolla', vehicleValue: 300000,
    insuranceType: 'Comprehensive', coverageDurationId: '4q', insurers: [INSURER], insurerQuotes: {},
  };
  const product = (productVersionId, productName, extra = {}) => ({
    productVersionId, productName, productVersionNumber: 1, insurerName: INSURER, coverGuide: { planName: productName }, unavailableAt: null, ...extra,
  });

  it('keeps a request from before product selection as one case addressed by its id', () => {
    const [only, ...rest] = toPortalCases({ ...base, insurerQuotes: { [INSURER]: { premium: 9000 } } }, INSURER);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ id: 'QR-2', caseKey: 'QR-2', productVersionId: null, reply: { premium: 9000 } });
  });

  it('gives each product the customer chose from this insurer its own case, quote and address', () => {
    const cases = toPortalCases({
      ...base,
      selectedProducts: [product('v-essential', 'Essential', { reply: { premium: 13500 } }), product('v-plus', 'Plus'), product('v-other', 'Other', { insurerName: 'Global Guard' })],
    }, INSURER);

    expect(cases.map(({ caseKey, productName, reply }) => ({ caseKey, productName, premium: reply?.premium ?? null }))).toEqual([
      { caseKey: 'QR-2~v-essential', productName: 'Essential', premium: 13500 },
      { caseKey: 'QR-2~v-plus', productName: 'Plus', premium: null },
    ]);
    expect(cases.every((portalCase) => portalCase.id === 'QR-2')).toBe(true);
    expect(cases[1].coverGuide).toEqual({ planName: 'Plus' });
    expect(portalPath.quote(cases[1].caseKey)).toBe('/insurer?quote=QR-2~v-plus');
  });

  it('reads a product quote held the mock way, beside the request', () => {
    const [portalCase] = toPortalCases({
      ...base,
      selectedProducts: [product('v-plus', 'Plus')],
      productQuotes: [{ productVersionId: 'v-plus', premium: 15600 }],
    }, INSURER);
    expect(portalCase.reply).toEqual({ productVersionId: 'v-plus', premium: 15600 });
  });

  it('drops a cancelled product that was never quoted, but keeps one already quoted', () => {
    const cases = toPortalCases({
      ...base,
      selectedProducts: [
        product('v-unanswered', 'Unanswered', { unavailableAt: '2026-11-20T00:00:00Z' }),
        product('v-quoted', 'Quoted', { unavailableAt: '2026-11-20T00:00:00Z', reply: { premium: 14000 } }),
      ],
    }, INSURER);
    expect(cases.map((portalCase) => portalCase.productName)).toEqual(['Quoted']);
    expect(cases[0].unavailable).toBe(true);
  });

  it('gives an insurer no work on a request whose products all belong to others', () => {
    expect(toPortalCases({ ...base, selectedProducts: [product('v-other', 'Other', { insurerName: 'Global Guard' })] }, INSURER)).toEqual([]);
  });
});

describe('a chosen product\'s workflow in the portal', () => {
  const INSURER = 'Prestige Assurance';
  const request = (selected) => ({
    id: 'QR-3', submittedAt: new Date().toISOString(), vehicle: '2019 Honda Fit', vehicleValue: 120000,
    insuranceType: 'Comprehensive', coverageDurationId: '4q', insurers: [INSURER], insurerQuotes: {},
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    selectedProducts: [{ productVersionId: 'pv-1', productName: 'Essential', insurerName: INSURER, unavailableAt: null, ...selected }],
  });

  it('reads the workflow the portal route nests under the product', () => {
    const [portalCase] = toPortalCases(request({ workflow: { status: 'VERIFICATION_REQUIRED', clockPausedAt: '2026-11-20T10:00:00.000Z', informationRequests: [] } }), INSURER);
    expect(portalCase.workflow.status).toBe('VERIFICATION_REQUIRED');
    expect(replyDeadline(portalCase)).toEqual({ label: 'Clock stopped · waiting for the customer', urgent: false });
    expect(awaitsInsurer(portalCase)).toBe(true);
    expect(quotableNow(portalCase)).toBe(true);
  });

  it('reads the flat workflow the prototype keeps, and treats a product with none as new', () => {
    const [declined] = toPortalCases(request({ status: 'DECLINED', decline: { reason: 'Not eligible.', note: null } }), INSURER);
    expect(declined.workflow).toMatchObject({ status: 'DECLINED', decline: { customerText: 'Not eligible.' } });
    expect(awaitsInsurer(declined)).toBe(false);

    const [fresh] = toPortalCases(request({}), INSURER);
    expect(fresh.workflow.status).toBe('SUBMITTED');
    expect(awaitsInsurer(fresh)).toBe(true);
  });

  it('keeps a product waiting for an inspection in the queue but not quotable', () => {
    const [waiting] = toPortalCases(request({ workflow: { status: 'INSPECTION_REQUIRED', informationRequests: [] } }), INSURER);
    expect(awaitsInsurer(waiting)).toBe(true);
    expect(quotableNow(waiting)).toBe(false);
  });

  it('counts the reply deadline from the product\'s own due date', () => {
    const due = new Date(Date.now() + 2 * 86_400_000 - 3_600_000).toISOString();
    const [portalCase] = toPortalCases(request({ workflow: { status: 'SUBMITTED', replyDueAt: due, informationRequests: [] } }), INSURER);
    expect(replyDeadline(portalCase).label).toMatch(/2 days left$/);
  });
});
