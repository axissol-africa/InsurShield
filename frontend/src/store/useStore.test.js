import { beforeEach, describe, expect, it } from 'vitest';
import { DEMO_CUSTOMER_ACCOUNT, belongsToCustomer, selectActiveQuoteRequest, useStore } from './useStore';
import { INSPECTION_KEYS } from '../utils/inspection';

const initial = useStore.getInitialState();
const reset = () => useStore.setState({ ...initial, registeredAccounts: [DEMO_CUSTOMER_ACCOUNT] }, true);
const state = () => useStore.getState();

const signInDemo = () => state().authenticateCustomer(DEMO_CUSTOMER_ACCOUNT.email, DEMO_CUSTOMER_ACCOUNT.password);

const seedVehicle = () => {
  state().setVehicleDetails({ plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' });
  state().setVehicleValue(250000);
  state().setVehicleUsage('Individual');
  state().setInsuranceType('Comprehensive');
  state().setDocuments(Object.fromEntries(INSPECTION_KEYS.map((key) => [key, 'data:image/jpeg;base64,x'])));
};

beforeEach(reset);

describe('customer accounts', () => {
  it('authenticates the seeded demo account by email or phone, case-insensitively', () => {
    expect(state().authenticateCustomer('MWIZA.BANDA@insurshield.zm', DEMO_CUSTOMER_ACCOUNT.password)).toBe(true);
    expect(state().isAuthenticated).toBe(true);
    state().signOut();
    expect(state().authenticateCustomer(DEMO_CUSTOMER_ACCOUNT.phone, DEMO_CUSTOMER_ACCOUNT.password)).toBe(true);
  });

  it('rejects a wrong password without changing the session', () => {
    expect(state().authenticateCustomer(DEMO_CUSTOMER_ACCOUNT.email, 'wrong')).toBe(false);
    expect(state().isAuthenticated).toBe(false);
  });

  it('registers a new account with consent and can remove it again', () => {
    state().registerCustomerAccount({ fullName: 'Test Person', email: 'test@example.com', phone: '0971111111', password: 'Password1!', consentTimestamp: '2026-09-01T00:00:00.000Z' });
    expect(state().isAuthenticated).toBe(true);
    expect(state().consentAccepted).toBe(true);
    expect(state().registeredAccounts).toHaveLength(2);

    state().deleteCurrentAccount();
    expect(state().isAuthenticated).toBe(false);
    expect(state().registeredAccounts.map((account) => account.email)).toEqual([DEMO_CUSTOMER_ACCOUNT.email]);
  });

  it('never deletes the seeded demo account', () => {
    signInDemo();
    state().deleteCurrentAccount();
    expect(state().registeredAccounts).toHaveLength(1);
  });

  it('resets a password for the matching identifier only', () => {
    state().registerCustomerAccount({ fullName: 'A', email: 'a@example.com', phone: '0970000001', password: 'oldpass1!' });
    state().resetCustomerPassword('0970000001', 'newpass1!');
    state().signOut();
    expect(state().authenticateCustomer('a@example.com', 'oldpass1!')).toBe(false);
    expect(state().authenticateCustomer('a@example.com', 'newpass1!')).toBe(true);
  });
});

describe('quote requests', () => {
  it('sends a request to every active insurer and records the captured shots', () => {
    signInDemo();
    seedVehicle();
    state().updateInsurerRate('4', { status: 'Inactive' });
    const id = state().submitQuoteRequest({ customer: { fullName: 'Mwiza Banda', phone: '0970123456', email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });

    const request = selectActiveQuoteRequest(state());
    expect(request.id).toBe(id);
    expect(request.insurers).toHaveLength(4);
    expect(request.insurers).not.toContain('Metro Safe Assurance');
    expect(request.inspectionShots).toEqual(INSPECTION_KEYS);
    expect(request.insurerQuotes).toEqual({});
    expect(request.status).toBe('Submitted');
  });

  it('attaches an insurer reply and reopens earlier requests', () => {
    signInDemo();
    seedVehicle();
    const first = state().submitQuoteRequest({ customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });
    const second = state().submitQuoteRequest({ customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });
    expect(state().activeQuoteRequestId).toBe(second);

    state().addInsurerQuote(first, 'Prestige Assurance', { premium: 10900, notes: 'Includes windscreen' });
    const replied = state().quoteRequests.find((request) => request.id === first);
    expect(replied.status).toBe('Quoted');
    expect(replied.insurerQuotes['Prestige Assurance'].premium).toBe(10900);
    expect(replied.insurerQuotes['Prestige Assurance'].sentAt).toBeTruthy();

    state().selectQuote({ name: 'x', price: 1 }, { finalPremium: 1 });
    state().setActiveQuoteRequest(first);
    expect(selectActiveQuoteRequest(state()).id).toBe(first);
    expect(state().selectedQuote).toBeNull();
  });

  it('resets the journey but keeps records and the session', () => {
    signInDemo();
    seedVehicle();
    state().submitQuoteRequest({ customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });
    state().addPolicy({ policyNumber: 'POL-1', customerEmail: DEMO_CUSTOMER_ACCOUNT.email });
    state().resetJourney();
    expect(state().vehicleDetails).toBeNull();
    expect(state().activeQuoteRequestId).toBeNull();
    expect(state().documents.insp_front).toBeNull();
    expect(state().quoteRequests).toHaveLength(1);
    expect(state().policies).toHaveLength(1);
    expect(state().isAuthenticated).toBe(true);
  });

  it('does not issue the same policy number twice', () => {
    state().addPolicy({ policyNumber: 'POL-1' });
    state().addPolicy({ policyNumber: 'POL-1' });
    expect(state().policies).toHaveLength(1);
    expect(state().policies[0].status).toBe('Active');
  });
});

describe('claims', () => {
  it('records a first notification and lets the insurer mark it received', () => {
    state().addClaim({ claimNumber: 'CLM-123456', insurer: 'Prestige Assurance', phone: DEMO_CUSTOMER_ACCOUNT.phone });
    const [claim] = state().claims;
    expect(claim.id).toBe('CLM-123456');
    expect(claim.status).toBe('Notified');

    state().markClaimReceived('CLM-123456');
    expect(state().claims[0].status).toBe('Received by insurer');
    expect(state().claims[0].receivedAt).toBeTruthy();
  });
});

describe('belongsToCustomer', () => {
  const customer = { email: 'a@example.com', phone: '0970000001' };
  it('matches on any of the record email/phone fields', () => {
    expect(belongsToCustomer(customer)({ customerEmail: 'a@example.com' })).toBe(true);
    expect(belongsToCustomer(customer)({ customer: { phone: '0970000001' } })).toBe(true);
    expect(belongsToCustomer(customer)({ phone: '0970000001' })).toBe(true);
    expect(belongsToCustomer(customer)({ customerEmail: 'b@example.com' })).toBe(false);
  });
  it('matches nothing without a customer', () => {
    expect(belongsToCustomer(null)({ customerEmail: 'a@example.com' })).toBe(false);
  });
});

describe('quote validity and re-quote', () => {
  it('stamps an insurer reply with its validity window', () => {
    signInDemo();
    seedVehicle();
    const id = state().submitQuoteRequest({ customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });
    state().addInsurerQuote(id, 'Global Guard Insurance', { premium: 9000 });
    const reply = state().quoteRequests[0].insurerQuotes['Global Guard Insurance'];
    expect(reply.validityDays).toBe(2); // Global Guard's configured window
    expect(new Date(reply.validUntil) - new Date(reply.sentAt)).toBe(2 * 24 * 60 * 60 * 1000);
    expect(state().quoteRequests[0].expiresAt).toBeTruthy();

    state().extendInsurerQuote(id, 'Global Guard Insurance', 7);
    expect(new Date(state().quoteRequests[0].insurerQuotes['Global Guard Insurance'].validUntil) - new Date(reply.validUntil)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('re-quotes from an expired request with details carried over and the old one linked', () => {
    signInDemo();
    seedVehicle();
    state().setVehicleUsage('Commercial (Taxis & Yangos)');
    const oldId = state().submitQuoteRequest({ customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });
    // The customer wandered off: journey fields changed but the documents are still on the device.
    state().setVehicleDetails(null);
    state().setVehicleValue(0);
    state().setVehicleUsage('');

    expect(state().requoteFromRequest(oldId)).toBe(true);
    expect(state().vehicleDetails.plateNumber).toBe('BAA 1234');
    expect(state().vehicleUsage).toBe('Commercial (Taxis & Yangos)');
    expect(state().vehicleValue).toBe(250000);
    expect(state().requotedFromId).toBe(oldId);
    expect(state().documents.insp_front).toBeTruthy(); // photos are recent enough to reuse

    const newId = state().submitQuoteRequest({ customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });
    const old = state().quoteRequests.find((request) => request.id === oldId);
    const fresh = state().quoteRequests.find((request) => request.id === newId);
    expect(old.status).toBe('Expired');
    expect(old.requotedAs).toBe(newId);
    expect(fresh.requotedFromId).toBe(oldId);
    expect(state().requotedFromId).toBeNull();
  });

  it('drops stale photos when re-quoting', () => {
    signInDemo();
    seedVehicle();
    state().setDocument('whiteBook', 'blob:whitebook');
    const oldId = state().submitQuoteRequest({ customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policyDates: null });
    useStore.setState({ quoteRequests: state().quoteRequests.map((request) => (request.id === oldId ? { ...request, photosCapturedAt: '2020-01-01T00:00:00.000Z' } : request)) });
    state().requoteFromRequest(oldId);
    expect(state().documents.insp_front).toBeNull();
    expect(state().documents.whiteBook).toBeTruthy();
  });
});

describe('legacy data backfill', () => {
  it('gives pre-existing replies a validity window on load', async () => {
    const { useStore: store } = await import('./useStore');
    const legacy = {
      id: 'QR-LEGACY', submittedAt: '2026-09-20T09:00:00.000Z', insurers: ['Prestige Assurance'],
      insurerQuotes: { 'Prestige Assurance': { premium: 10900, sentAt: '2026-09-20T10:00:00.000Z' } },
    };
    const merged = store.persist.getOptions().merge({ quoteRequests: [legacy] }, store.getInitialState());
    const reply = merged.quoteRequests[0].insurerQuotes['Prestige Assurance'];
    expect(reply.validityDays).toBe(7);
    expect(reply.validUntil).toBe('2026-09-27T10:00:00.000Z');
    expect(merged.quoteRequests[0].expiresAt).toBe('2026-10-04T09:00:00.000Z');
  });
});
