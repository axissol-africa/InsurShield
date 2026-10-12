import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, DEMO_CUSTOMER_ACCOUNT } from '@/store';
import { INSPECTION_KEYS } from '@/domain/inspection';
import * as mock from './index';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock', apiBaseUrl: '/api/v1', mockLatencyMs: 0, appName: 'InsurShield', isProduction: false } }));

const initial = useStore.getInitialState();
beforeEach(() => useStore.setState({ ...initial, registeredAccounts: [DEMO_CUSTOMER_ACCOUNT], quoteRequests: [], policies: [], claims: [], ncdApplications: [] }, true));

const signIn = () => mock.auth.login(DEMO_CUSTOMER_ACCOUNT.email, DEMO_CUSTOMER_ACCOUNT.password);
const asInsurer = () => useStore.getState().startStaffSession({ role: 'insurer', name: 'Prestige Assurance' });

describe('mock api adapter', () => {
  it('signs in and reports the session', async () => {
    await expect(mock.auth.login('nobody@example.com', 'x')).rejects.toThrow('Incorrect');
    const { customer } = await signIn();
    expect(customer.email).toBe(DEMO_CUSTOMER_ACCOUNT.email);
    expect((await mock.auth.me()).customer.email).toBe(DEMO_CUSTOMER_ACCOUNT.email);
  });

  it('looks up a plate through the RTSA stand-in', async () => {
    const vehicle = await mock.vehicles.lookupPlate(' baa 1234 ');
    expect(vehicle).toMatchObject({ plateNumber: 'BAA 1234', make: 'Toyota' });
  });

  it('runs the quote flow: submit, insurer reply, extend, customer sees it', async () => {
    await signIn();
    const state = useStore.getState();
    state.setVehicleDetails({ plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' });
    state.setVehicleValue(250000);
    state.setVehicleUsage('Individual');
    state.setInsuranceType('Comprehensive');
    state.setDocuments(Object.fromEntries(INSPECTION_KEYS.map((key) => [key, 'data:image/jpeg;base64,x'])));

    const request = await mock.quotes.submitRequest({ customer: state.customer, policyDates: null });
    expect(request.insurers).toHaveLength(5);
    expect(await mock.quotes.listMine()).toHaveLength(1);

    asInsurer();
    expect(await mock.quotes.listForInsurer()).toHaveLength(1);
    const replied = await mock.quotes.reply(request.id, { premium: 10900, document: { name: 'q.pdf' } });
    expect(replied.insurerQuotes['Prestige Assurance'].premium).toBe(10900);
    const extended = await mock.quotes.extend(request.id, 7);
    expect(new Date(extended.insurerQuotes['Prestige Assurance'].validUntil) > new Date(replied.insurerQuotes['Prestige Assurance'].validUntil)).toBe(true);
  });

  it('confirms a payment and records the receipt for the confirmation page', async () => {
    const receipt = await mock.payments.pay({ amount: 10900, method: 'Mobile money' });
    expect(receipt).toMatchObject({ status: 'Confirmed', amount: 10900, currency: 'ZMW' });
    expect(useStore.getState().paymentReceipt).toEqual(receipt);
    expect(await mock.payments.status(receipt.transactionId)).toEqual(receipt);
  });

  it('issues a certificate for a paid policy and scopes lists to the insurer', async () => {
    useStore.getState().addPolicy({ policyNumber: 'POL-1', insurer: 'Prestige Assurance', customerEmail: DEMO_CUSTOMER_ACCOUNT.email, status: 'Awaiting insurer certificate' });
    useStore.getState().addPolicy({ policyNumber: 'POL-2', insurer: 'Global Guard Insurance', customerEmail: 'other@example.com', status: 'Active' });
    asInsurer();
    expect((await mock.policies.listForInsurer()).map((policy) => policy.policyNumber)).toEqual(['POL-1']);
    const issued = await mock.policies.issueCertificate('POL-1', { certificateDocument: { name: 'cert.pdf' }, insurerPolicyNumber: 'PA-1' });
    expect(issued.status).toBe('Active');
    await signIn();
    expect((await mock.policies.listMine()).map((policy) => policy.policyNumber)).toEqual(['POL-1']);
  });

  it('records a claim notification and lets the insurer mark it received', async () => {
    const claim = await mock.claims.notify({ claimNumber: 'CLM-1', insurer: 'Prestige Assurance', phone: DEMO_CUSTOMER_ACCOUNT.phone });
    expect(claim.status).toBe('Notified');
    asInsurer();
    expect((await mock.claims.markReceived('CLM-1')).status).toBe('Received by insurer');
  });

  it('decides NCD applications and validates approved codes', async () => {
    const application = await mock.ncd.apply({ insurer: 'Prestige Assurance', policyNumber: 'PA-1', fullName: 'A', phone: '1', yearsClaimFree: 2 });
    asInsurer();
    const approved = await mock.ncd.decide(application.id, 'Approved');
    expect(approved.approvedCode).toMatch(/^NCD-/);
    expect(await mock.ncd.validateCode(approved.approvedCode)).toMatchObject({ valid: true, yearsClaimFree: 2 });
    expect(await mock.ncd.validateCode('NCD-NOPE')).toEqual({ valid: false });
  });

  it('manages insurers and the customer directory', async () => {
    await mock.insurers.setStatus('5', 'Inactive');
    await mock.insurers.remove('4');
    expect((await mock.insurers.directory()).map((insurer) => insurer.id)).toEqual(['1', '2', '3', '5']);
    expect((await mock.insurers.get('4')).status).toBe('Deleted');
  });
});
