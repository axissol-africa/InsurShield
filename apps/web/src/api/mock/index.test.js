import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore, DEMO_CUSTOMER_ACCOUNT } from '@/store';
import { INSPECTION_KEYS } from '@/domain/inspection';
import * as mock from './index';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock', apiBaseUrl: '/api/v1', mockLatencyMs: 0, appName: 'InsurShield', isProduction: false } }));

const initial = useStore.getInitialState();
beforeEach(() => {
  localStorage.removeItem('insurshield.mock.approvals.v1');
  localStorage.removeItem('insurshield.mock.products.v1');
  useStore.setState({ ...initial, staffSession: null, registeredAccounts: [DEMO_CUSTOMER_ACCOUNT], quoteRequests: [], policies: [], claims: [], ncdApplications: [] }, true);
});

const signIn = () => mock.auth.login(DEMO_CUSTOMER_ACCOUNT.email, DEMO_CUSTOMER_ACCOUNT.password);
const asInsurer = () => useStore.getState().startStaffSession({ role: 'insurer', name: 'Prestige Assurance' });
const asPlatformAdmin = (id, name) => useStore.getState().startStaffSession({
  id,
  role: 'admin',
  staffRole: 'SUPER_ADMIN',
  isSuperAdmin: true,
  name,
});

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
    state.setRtsaAnniversary(true, '2023-10-31');
    state.setDocuments(Object.fromEntries(INSPECTION_KEYS.map((key) => [key, 'data:image/jpeg;base64,x'])));

    const request = await mock.quotes.submitRequest({ customer: state.customer, policyDates: null });
    expect(request.insurers).toEqual([]);
    expect(request.rtsaAnniversaryFee).toBe(500);
    expect(await mock.quotes.listMine()).toHaveLength(1);

    state.requestQuotesFromGuides(request.id, ['1']);

    asInsurer();
    expect(await mock.quotes.listForInsurer()).toHaveLength(1);
    const replied = await mock.quotes.reply(request.id, { premium: 10900, document: { name: 'q.pdf' } });
    expect(replied.insurerQuotes['Prestige Assurance'].premium).toBe(10900);
    const extended = await mock.quotes.extend(request.id, 7);
    expect(new Date(extended.insurerQuotes['Prestige Assurance'].validUntil) > new Date(replied.insurerQuotes['Prestige Assurance'].validUntil)).toBe(true);
  });

  it('confirms a payment and records the receipt for the confirmation page', async () => {
    const receipt = await mock.payments.pay({ amount: 10900, method: 'Mobile money' });
    expect(receipt).toMatchObject({ status: 'Confirmed', amount: 10900, rtsaAnniversaryFee: 0, currency: 'ZMW' });
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
    expect(await mock.ncd.validateCode(approved.approvedCode)).toEqual({ valid: true });
    expect(await mock.ncd.validateCode('NCD-NOPE')).toEqual({ valid: false });
  });

  it('keeps insurer product versions immutable through draft, review and approval', async () => {
    asInsurer();
    const created = await mock.products.insurer.create({
      code: 'MOTOR-COMP-02', name: 'Comprehensive Select', coverType: 'COMPREHENSIVE',
      coverGuide: {}, inspectionRule: 'NOT_REQUIRED', effectiveFrom: '2026-11-13',
    });
    const guide = {
      planName: 'Comprehensive Select', summary: 'A full motor policy for private vehicles.',
      coveredItems: ['Own damage'], exclusions: ['Driving without a valid licence'],
      notifyWithinDays: 7, howToNotify: 'Call the claims line.', documentsRequired: ['Police report'],
      claimsContact: '+260 211 255 100', settlementTime: '14 working days', territorialLimit: 'Zambia',
      ncdAccepted: true, quoteValidityDays: 7,
    };
    const saved = await mock.products.insurer.updateDraft(created.product.id, created.id, { coverGuide: guide });
    expect(saved.status).toBe('DRAFT');
    await expect(mock.products.insurer.submit(created.product.id, created.id)).resolves.toMatchObject({ status: 'SUBMITTED' });
    await expect(mock.products.insurer.updateDraft(created.product.id, created.id, { name: 'Changed after review' })).rejects.toThrow('Create a new draft');

    asPlatformAdmin('mock:reviewer', 'Reviewer Admin');
    const submitted = await mock.products.admin.list({ status: 'SUBMITTED' });
    expect(submitted).toEqual(expect.arrayContaining([expect.objectContaining({
      id: created.id,
      product: expect.objectContaining({ id: created.product.id, code: 'MOTOR-COMP-02', coverType: 'COMPREHENSIVE' }),
    })]));
    await expect(mock.products.admin.approve(created.product.id, created.id, { comment: 'Terms reviewed.' })).resolves.toMatchObject({ status: 'APPROVED' });
    expect(await mock.products.directory({ coverType: 'COMPREHENSIVE' })).toEqual(expect.arrayContaining([expect.objectContaining({ version: expect.objectContaining({ id: created.id, number: 1 }) })]));

    asInsurer();
    const revised = await mock.products.insurer.revise(created.product.id, created.id);
    expect(revised).toMatchObject({ status: 'DRAFT', versionNumber: 2, name: 'Comprehensive Select' });
  });

  it('adds a fixed cover type to persisted product drafts from the earlier browser prototype', async () => {
    asInsurer();
    const insurer = useStore.getState().insurersList.find((entry) => entry.name === 'Prestige Assurance');
    localStorage.setItem('insurshield.mock.products.v1', JSON.stringify([{
      id: 'PROD-LEGACY', insurerId: insurer.id, code: 'LEGACY-TP',
      versions: [{ id: 'PV-LEGACY', versionNumber: 1, status: 'DRAFT', coverType: 'THIRD_PARTY' }],
    }]));

    const [product] = await mock.products.insurer.list();
    expect(product).toMatchObject({ code: 'LEGACY-TP', coverType: 'THIRD_PARTY' });
    expect(JSON.parse(localStorage.getItem('insurshield.mock.products.v1'))[0].coverType).toBe('THIRD_PARTY');
  });

  it('manages insurers and the customer directory', async () => {
    asPlatformAdmin('mock:maker', 'Maker Admin');
    const deactivation = await mock.insurers.setStatus('5', 'Inactive');
    expect((await mock.insurers.get('5')).status).not.toBe('Inactive');

    asPlatformAdmin('mock:checker', 'Checker Admin');
    await mock.admin.approvals.approve(deactivation.id);
    expect((await mock.insurers.get('5')).status).toBe('Inactive');

    asPlatformAdmin('mock:maker', 'Maker Admin');
    const removal = await mock.insurers.remove('4');
    expect((await mock.insurers.get('4')).status).not.toBe('Deleted');

    asPlatformAdmin('mock:checker', 'Checker Admin');
    await mock.admin.approvals.approve(removal.id);
    expect((await mock.insurers.directory()).map((insurer) => insurer.id)).toEqual(['1', '2', '3']);
    expect((await mock.insurers.get('4')).status).toBe('Deleted');

    expect((await mock.insurers.list({ status: 'deleted' })).map((insurer) => insurer.id)).toEqual(['4']);
    asPlatformAdmin('mock:maker', 'Maker Admin');
    const restoration = await mock.insurers.restore('4');
    expect((await mock.insurers.get('4')).status).toBe('Deleted');
    asPlatformAdmin('mock:checker', 'Checker Admin');
    await expect(mock.admin.approvals.approve(restoration.id)).resolves.toMatchObject({ status: 'EXECUTED' });
    expect(await mock.insurers.list({ status: 'deleted' })).toEqual([]);
    expect((await mock.insurers.directory()).map((insurer) => insurer.id)).not.toContain('4');
  });
});
