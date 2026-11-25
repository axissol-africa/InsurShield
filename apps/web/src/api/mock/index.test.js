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

  /** A signed-in customer's request for one of Prestige Assurance's published products. */
  const requestPrestigeProduct = async () => {
    await signIn();
    const state = useStore.getState();
    state.setVehicleDetails({ plateNumber: 'BAA 1234', make: 'Toyota', model: 'Hilux', year: '2020' });
    state.setVehicleValue(250000);
    state.setVehicleUsage('Individual');
    state.setInsuranceType('Comprehensive');
    state.setRtsaAnniversary(true, '2023-10-31');
    state.setDocuments(Object.fromEntries(INSPECTION_KEYS.map((key) => [key, 'data:image/jpeg;base64,x'])));
    const product = (await mock.products.directory({ coverType: 'COMPREHENSIVE' }))
      .find((entry) => entry.insurer.name === 'Prestige Assurance');
    const request = await mock.quotes.submitRequest({
      customer: state.customer, policyDates: null, selectedProductVersionIds: [product.version.id],
    });
    return { request, versionId: product.version.id };
  };

  it('runs the quote flow for a chosen product: submit, insurer reply, extend, customer sees it', async () => {
    const { request, versionId } = await requestPrestigeProduct();
    expect(request.insurers).toEqual(['Prestige Assurance']);
    expect(request.rtsaAnniversaryFee).toBe(500);
    expect(await mock.quotes.listMine()).toHaveLength(1);

    asInsurer();
    expect(await mock.quotes.listForInsurer()).toHaveLength(1);
    const replied = await mock.quotes.reply(request.id, { premium: 10900, document: { name: 'q.pdf' }, productVersionId: versionId });
    const quote = replied.productQuotes.find((entry) => entry.productVersionId === versionId);
    expect(quote.premium).toBe(10900);

    const extended = await mock.quotes.extend(request.id, 7, versionId);
    const after = extended.productQuotes.find((entry) => entry.productVersionId === versionId);
    expect(new Date(after.validUntil) > new Date(quote.validUntil)).toBe(true);
    expect(after.extendedAt).toBeTruthy();
  });

  it('asks the customer a question, takes the answer, then declines with the customer wording only', async () => {
    const { request, versionId } = await requestPrestigeProduct();
    expect(request.selectedProducts[0]).toMatchObject({ status: 'SUBMITTED', informationRequests: [] });

    asInsurer();
    await mock.quotes.requestInformation(request.id, versionId, { message: 'Please send the odometer reading.', dueInDays: 3 });
    await expect(mock.quotes.requestInformation(request.id, versionId, { message: 'And the licence.', dueInDays: 3 }))
      .rejects.toThrow('already asked');
    await mock.quotes.addNote(request.id, versionId, 'Customer called to say the photos are blurred.');

    const asked = (await mock.quotes.get(request.id)).selectedProducts[0];
    expect(asked).toMatchObject({ status: 'VERIFICATION_REQUIRED', statusLabel: 'The insurer needs more information' });

    const answered = await mock.quotes.answerInformation(request.id, versionId, '84,200 km');
    expect(answered.selectedProducts[0]).toMatchObject({
      status: 'INSURER_PROCESSING',
      informationRequests: [{ message: 'Please send the odometer reading.', answer: '84,200 km', open: false }],
    });
    await expect(mock.quotes.answerInformation(request.id, versionId, 'again')).rejects.toThrow('not waiting');

    await expect(mock.quotes.decline(request.id, versionId, { reasonCode: 'MADE_UP' })).rejects.toThrow('listed reasons');
    await mock.quotes.decline(request.id, versionId, { reasonCode: 'VEHICLE_NOT_ELIGIBLE', customerNote: 'Under 15 years only.', internalNote: 'Rebuilt chassis.' });
    const declined = (await mock.quotes.get(request.id)).selectedProducts[0];
    expect(declined).toMatchObject({ status: 'DECLINED', decline: { reason: "Your vehicle does not meet this product's eligibility rules.", note: 'Under 15 years only.' } });
    expect(JSON.stringify(declined)).not.toContain('Rebuilt chassis');
    expect((await mock.quotes.notes(request.id, versionId)).map((note) => note.body)).toEqual([
      'Rebuilt chassis.',
      'Customer called to say the photos are blurred.',
    ]);
  });

  it('replaces and withdraws a quote, and needs required conditions accepted to choose one', async () => {
    const { request, versionId } = await requestPrestigeProduct();
    asInsurer();
    await mock.quotes.reply(request.id, { premium: 10900, document: { name: 'q.pdf' }, productVersionId: versionId, conditions: [{ code: 'TRACKER', text: 'Fit a tracker.', purchaseCritical: true }] });
    const replaced = await mock.quotes.replace(request.id, versionId, { premium: 10500, document: { name: 'q2.pdf' }, conditions: [{ code: 'TRACKER', text: 'Fit a tracker.', purchaseCritical: true }] });
    expect(replaced.premium).toBe(10500);

    await expect(mock.quotes.select(request.id, replaced.id, [])).rejects.toThrow('required');
    const chosen = await mock.quotes.select(request.id, replaced.id, ['TRACKER']);
    expect(chosen.selection).toMatchObject({ insurerQuoteId: replaced.id, acceptedConditionCodes: ['TRACKER'] });
    asInsurer();
    await expect(mock.quotes.withdraw(request.id, versionId, 'Too late.')).rejects.toThrow('chosen');

    useStore.getState().setQuoteSelection(request.id, null);
    await mock.quotes.withdraw(request.id, versionId, 'Rated on the wrong use.');
    const after = await mock.quotes.get(request.id);
    expect(after.productQuotes).toEqual([]);
    expect(after.selectedProducts[0].status).toBe('INSURER_PROCESSING');
  });

  it('refuses a request without chosen products, as the API does', async () => {
    await signIn();
    await expect(mock.quotes.submitRequest({ customer: useStore.getState().customer, policyDates: null }))
      .rejects.toThrow('Choose one to five published insurance products.');
  });

  const quotedPrestige = async () => {
    const { request, versionId } = await requestPrestigeProduct();
    asInsurer();
    const replied = await mock.quotes.reply(request.id, { premium: 10900, document: { name: 'q.pdf' }, productVersionId: versionId });
    return { request, quote: replied.productQuotes.find((entry) => entry.productVersionId === versionId) };
  };

  it('starts a payment as pending, then confirms it on the status check and records the receipt', async () => {
    const { request, quote } = await quotedPrestige();
    const started = await mock.payments.pay({ amount: 11400, method: 'Mobile money', mobileNumber: '+260970000001', quoteRequestId: request.id, insurerQuoteId: quote.id }, 'KEY-1');
    expect(started).toMatchObject({ status: 'Pending', amount: 11400, rtsaAnniversaryFee: 500, currency: 'ZMW', payer: '*******001' });
    expect(started).not.toHaveProperty('mobileNumber');
    expect(await mock.payments.pay({ amount: 11400, method: 'Mobile money', quoteRequestId: request.id, insurerQuoteId: quote.id }, 'KEY-1')).toEqual(started);

    const receipt = await mock.payments.status(started.transactionId);
    expect(receipt).toMatchObject({ status: 'Confirmed', policyStatus: 'Policy issuing' });
    expect(useStore.getState().paymentReceipt).toEqual(receipt);
  });

  it('follows the stand-in test wallets: a decline can be tried again, and a waiting one can be cancelled', async () => {
    const { request, quote } = await quotedPrestige();
    const body = { amount: 11400, method: 'Mobile money', quoteRequestId: request.id, insurerQuoteId: quote.id };
    const declined = await mock.payments.pay({ ...body, mobileNumber: '+260970000002' });
    expect(await mock.payments.status(declined.transactionId)).toMatchObject({ status: 'Failed', failure: expect.stringContaining('No money was taken') });

    const waiting = await mock.payments.pay({ ...body, mobileNumber: '+260970000003' });
    expect((await mock.payments.status(waiting.transactionId)).status).toBe('Pending');
    await expect(mock.payments.pay({ ...body, mobileNumber: '+260970000001' })).rejects.toThrow('already under way');
    expect((await mock.payments.cancel(waiting.transactionId)).status).toBe('Cancelled');
  });

  it('refuses a payment that does not name the quote, as the API does', async () => {
    await expect(mock.payments.pay({ amount: 10900, method: 'Mobile money' }))
      .rejects.toThrow('This quote needs to be refreshed before payment.');
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

  it('lets the insurer accept a paid policy or report that it cannot be issued, and then not issue it', async () => {
    useStore.getState().addPolicy({ policyNumber: 'POL-A', insurer: 'Prestige Assurance', customerEmail: DEMO_CUSTOMER_ACCOUNT.email, status: 'Awaiting insurer certificate' });
    useStore.getState().addPolicy({ policyNumber: 'POL-B', insurer: 'Global Guard Insurance', customerEmail: 'other@example.com', status: 'Awaiting insurer certificate' });
    asInsurer();
    expect(await mock.policies.acceptIssuance('POL-A', 'PA-7')).toMatchObject({ insurerPolicyNumber: 'PA-7', issuanceAcceptedAt: expect.any(String) });
    await expect(mock.policies.acceptIssuance('POL-B')).rejects.toThrow('Policy was not found.');
    await expect(mock.policies.reportIssuanceFailure('POL-A', { reasonCode: 'OTHER', customerMessage: 'No.' })).rejects.toThrow('at least 10');
    expect(await mock.policies.reportIssuanceFailure('POL-A', { reasonCode: 'OTHER', customerMessage: 'We cannot cover this vehicle.' })).toMatchObject({ status: 'Issuance failed' });
    await expect(mock.policies.issueCertificate('POL-A', { certificateDocument: { name: 'c.pdf' } })).rejects.toThrow('being refunded');
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
    const comparisonItems = (await mock.products.insurer.comparisonTaxonomy()).map((term) => ({
      taxonomyItemId: term.id,
      included: true,
      valueText: term.dataType === 'BOOLEAN' ? 'Yes'
        : term.dataType === 'LIST' ? term.allowedValues[0]
          : term.dataType === 'TEXT' ? 'Included'
            : '500',
    }));
    const saved = await mock.products.insurer.updateDraft(created.product.id, created.id, { coverGuide: guide, comparisonItems });
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
