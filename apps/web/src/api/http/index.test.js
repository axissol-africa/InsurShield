import { beforeEach, describe, expect, it, vi } from 'vitest';

const transport = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('@/lib/apiClient', () => ({ apiClient: transport }));

import { account, admin, auth, insurers, integrations, payments, policies, products, quotes, serviceRequests, settings } from './index';

beforeEach(() => vi.clearAllMocks());

describe('Better Auth HTTP adapter', () => {
  it('sends the renewal reference and leaves customer identity to the session', () => {
    quotes.submitRequest({ customer: { email: 'browser@example.com' }, renewalOfPolicyNumber: 'POL-EXAMPLE' }, 'renewal-key');
    expect(transport.post).toHaveBeenCalledWith('/quote-requests', {
      renewalOfPolicyNumber: 'POL-EXAMPLE',
    }, { headers: { 'Idempotency-Key': 'renewal-key' } });
  });

  it('retries a service request with the original key and already uploaded evidence', async () => {
    transport.post.mockResolvedValueOnce({ id: 'document-one' })
      .mockRejectedValueOnce(new Error('Connection lost after upload'))
      .mockResolvedValueOnce({ reference: 'SR-1' });
    const proof = new File(['%PDF-1.4'], 'proof.pdf', { type: 'application/pdf' });
    const request = { policyNumber: 'POL-1', type: 'ASSISTANCE', reason: 'Please help with the attached document.', files: [proof] };
    const attempt = { key: 'service-key', uploaded: new WeakMap() };

    await expect(serviceRequests.submit(request, attempt)).rejects.toThrow('Connection lost');
    await expect(serviceRequests.submit(request, attempt)).resolves.toEqual({ reference: 'SR-1' });
    expect(transport.post.mock.calls.filter(([path]) => path === '/documents')).toHaveLength(1);
    const submissions = transport.post.mock.calls.filter(([path]) => path === '/service-requests');
    expect(submissions).toHaveLength(2);
    expect(submissions[0]).toEqual(submissions[1]);
    expect(submissions[0][1].documentIds).toEqual(['document-one']);
    expect(submissions[0][2].headers['Idempotency-Key']).toBe('service-key');
  });

  it('uses identity routes for registration, sign-in, staff email codes and sign-out', () => {
    auth.register({ email: 'customer@example.com' });
    auth.signIn('customer@example.com', 'Password1!');
    auth.sendStaffMfaCode();
    auth.verifyStaffMfaCode('123456');
    auth.signOut();

    expect(transport.post).toHaveBeenNthCalledWith(1, '/identity/register', { email: 'customer@example.com' });
    expect(transport.post).toHaveBeenNthCalledWith(2, '/identity/sign-in/email', { email: 'customer@example.com', password: 'Password1!' });
    expect(transport.post).toHaveBeenNthCalledWith(3, '/identity/two-factor/send-otp', {});
    expect(transport.post).toHaveBeenNthCalledWith(4, '/identity/two-factor/verify-otp', { code: '123456' });
    expect(transport.post).toHaveBeenNthCalledWith(5, '/identity/sign-out');
  });

  it('restores an unbound tab without an identity header and closes through the API', () => {
    auth.me({ boot: true });
    account.close();

    expect(transport.get).toHaveBeenCalledWith('/auth/me', { identity: 'omit' });
    expect(transport.delete).toHaveBeenCalledWith('/account');
  });

  it('requests deleted insurers and restores one through the dedicated endpoint', () => {
    insurers.profile();
    insurers.list({ status: 'deleted' });
    insurers.restore('insurer-1');

    expect(transport.get).toHaveBeenNthCalledWith(1, '/insurer/profile');
    expect(transport.get).toHaveBeenNthCalledWith(2, '/insurers', { params: { status: 'deleted' } });
    expect(transport.post).toHaveBeenCalledWith('/insurers/insurer-1/restore');
  });

  it('loads the read-only audit trail with server filters', () => {
    admin.requestCustomerPasswordReset({ customerId: '1', confirmationEmail: 'customer@example.com', reason: 'Customer cannot sign in.' });
    admin.auditLogs({ entityType: 'POLICY', limit: 25, cursor: 'next-page' });

    expect(transport.post).toHaveBeenCalledWith('/admin/customers/password-reset', {
      customerId: '1', confirmationEmail: 'customer@example.com', reason: 'Customer cannot sign in.',
    });
    expect(transport.get).toHaveBeenCalledWith('/admin/audit-logs', {
      params: { entityType: 'POLICY', limit: 25, cursor: 'next-page' },
    });
  });

  it('uses the versioned insurer product endpoints without a browser-selected insurer id', () => {
    products.insurer.list();
    products.insurer.comparisonTaxonomy();
    products.insurer.create({ code: 'MOTOR-COMP-01' });
    products.insurer.updateDraft('product-1', 'version-1', { name: 'Comprehensive Gold' });
    products.insurer.submit('product-1', 'version-1');
    products.admin.list({ status: 'SUBMITTED' });
    products.admin.approve('product-1', 'version-1', { comment: 'Reviewed.' });
    products.directory({ coverType: 'COMPREHENSIVE', limit: 5 });
    products.estimate('product-1', 'version-1', { vehicleValue: 100000, vehicleUsage: 'Individual', coverageDuration: 'Q1' });

    expect(transport.get).toHaveBeenNthCalledWith(1, '/insurer/products');
    expect(transport.get).toHaveBeenNthCalledWith(2, '/insurer/products/comparison-taxonomy');
    expect(transport.post).toHaveBeenCalledWith('/insurer/products', { code: 'MOTOR-COMP-01' });
    expect(transport.patch).toHaveBeenCalledWith('/insurer/products/product-1/versions/version-1', { name: 'Comprehensive Gold' });
    expect(transport.post).toHaveBeenCalledWith('/insurer/products/product-1/versions/version-1/submit');
    expect(transport.get).toHaveBeenCalledWith('/admin/products', { params: { status: 'SUBMITTED' } });
    expect(transport.post).toHaveBeenCalledWith('/admin/products/product-1/versions/version-1/approve', { comment: 'Reviewed.' });
    expect(transport.get).toHaveBeenCalledWith('/products/directory', { params: { coverType: 'COMPREHENSIVE', limit: 5 } });
    expect(transport.get).toHaveBeenCalledWith('/products/product-1/versions/version-1/estimate', { params: { vehicleValue: 100000, vehicleUsage: 'Individual', coverageDuration: 'Q1' } });
  });

  it('passes the selected version and cover type to the public availability lookup', () => {
    products.directory({ coverType: 'COMPREHENSIVE', productVersionId: 'version-101', limit: 1 });
    expect(transport.get).toHaveBeenCalledWith('/products/directory', {
      params: { coverType: 'COMPREHENSIVE', productVersionId: 'version-101', limit: 1 },
    });
  });

  it('uses versioned rules and comparison taxonomy endpoints', () => {
    settings.rules.list();
    settings.rules.history('NCD_POLICY');
    settings.rules.create('NCD_POLICY', { value: { tiers: [] }, effectiveFrom: '2026-11-15' });
    settings.rules.confirm('NCD_POLICY', 'version-1');
    settings.taxonomy.list();
    settings.taxonomy.create({ code: 'EXCESS', label: 'Excess', category: 'EXCESS', dataType: 'CURRENCY' });
    settings.taxonomy.update('term-1', { status: 'DISABLED' });

    expect(transport.get).toHaveBeenCalledWith('/admin/settings/rules');
    expect(transport.get).toHaveBeenCalledWith('/admin/settings/rules/NCD_POLICY');
    expect(transport.post).toHaveBeenCalledWith('/admin/settings/rules/NCD_POLICY/versions', { value: { tiers: [] }, effectiveFrom: '2026-11-15' });
    expect(transport.post).toHaveBeenCalledWith('/admin/settings/rules/NCD_POLICY/versions/version-1/confirm');
    expect(transport.get).toHaveBeenCalledWith('/admin/settings/comparison-taxonomy');
    expect(transport.post).toHaveBeenCalledWith('/admin/settings/comparison-taxonomy', { code: 'EXCESS', label: 'Excess', category: 'EXCESS', dataType: 'CURRENCY' });
    expect(transport.patch).toHaveBeenCalledWith('/admin/settings/comparison-taxonomy/term-1', { status: 'DISABLED' });
  });

  it('loads safe integration delivery summaries and records a manual fallback', () => {
    integrations.list();
    integrations.listForInsurer();
    integrations.manualFallback('delivery-1', 'Confirmed through the insurer operations desk.');

    expect(transport.get).toHaveBeenCalledWith('/integrations/deliveries');
    expect(transport.get).toHaveBeenCalledWith('/insurer/integrations/deliveries');
    expect(transport.post).toHaveBeenCalledWith('/integrations/deliveries/delivery-1/manual-fallback', {
      note: 'Confirmed through the insurer operations desk.',
    });
  });

  it('uploads the quotation before sending a quote, and sends its id rather than the file', async () => {
    transport.post.mockResolvedValueOnce({ id: 'doc-quotation' }).mockResolvedValueOnce({ premium: 23400 });
    const document = { name: 'quotation.pdf', type: 'application/pdf', size: 8, dataUrl: 'data:application/pdf;base64,JVBERi0x' };

    await quotes.reply('QR-1', { premium: 23400, validityDays: 7, document, productVersionId: 'version-2' });

    const [uploadPath, form] = transport.post.mock.calls[0];
    expect(uploadPath).toBe('/documents');
    expect(form.get('kind')).toBe('QUOTATION');
    expect(form.get('file').name).toBe('quotation.pdf');
    expect(transport.post).toHaveBeenLastCalledWith('/insurer/quote-requests/QR-1/quote', {
      premium: 23400, validityDays: 7, productVersionId: 'version-2', documentId: 'doc-quotation',
    });
  });

  it('uploads the certificate before issuing a policy, and sends its id rather than the file', async () => {
    transport.post.mockResolvedValueOnce({ id: 'doc-certificate' }).mockResolvedValueOnce({ status: 'Active' });
    const certificateDocument = { name: 'certificate.pdf', type: 'application/pdf', size: 8, dataUrl: 'data:application/pdf;base64,JVBERi0x' };

    await policies.issueCertificate('POL-1', { certificateDocument, insurerPolicyNumber: 'PA-1' });

    expect(transport.post.mock.calls[0][1].get('kind')).toBe('CERTIFICATE');
    expect(transport.post).toHaveBeenLastCalledWith('/insurer/policies/POL-1/certificate', {
      insurerPolicyNumber: 'PA-1', certificateDocumentId: 'doc-certificate',
    });
  });

  it('names the product when extending a quote for a chosen product, and only then', () => {
    quotes.extend('QR-1', 7, 'version-2');
    quotes.extend('QR-LEGACY', 7);

    expect(transport.post).toHaveBeenCalledWith('/insurer/quote-requests/QR-1/extend', { extraDays: 7, productVersionId: 'version-2' });
    expect(transport.post).toHaveBeenCalledWith('/insurer/quote-requests/QR-LEGACY/extend', { extraDays: 7 });
  });
});

describe('the quote workflow routes', () => {
  it('addresses each chosen product under its request', () => {
    quotes.declineReasons();
    quotes.decline('QR-1', 'pv-1', { reasonCode: 'OTHER' });
    quotes.requestInformation('QR-1', 'pv-1', { message: 'Odometer?', dueInDays: 3 });
    quotes.notes('QR-1', 'pv-1');
    quotes.addNote('QR-1', 'pv-1', 'Checked.');
    quotes.answerInformation('QR-1', 'pv-1', '84,200 km');

    expect(transport.get).toHaveBeenNthCalledWith(1, '/insurer/decline-reasons');
    expect(transport.get).toHaveBeenNthCalledWith(2, '/insurer/quote-requests/QR-1/products/pv-1/notes');
    expect(transport.post).toHaveBeenNthCalledWith(1, '/insurer/quote-requests/QR-1/products/pv-1/decline', { reasonCode: 'OTHER' });
    expect(transport.post).toHaveBeenNthCalledWith(2, '/insurer/quote-requests/QR-1/products/pv-1/information-requests', { message: 'Odometer?', dueInDays: 3 });
    expect(transport.post).toHaveBeenNthCalledWith(3, '/insurer/quote-requests/QR-1/products/pv-1/notes', { body: 'Checked.' });
    expect(transport.post).toHaveBeenNthCalledWith(4, '/quote-requests/QR-1/products/pv-1/information', { answer: '84,200 km' });
  });
});

describe('the quote queue routes', () => {
  it('claims, assigns, sets priority and reads the queue', () => {
    quotes.claim('QR-1', 'pv-1');
    quotes.assign('QR-1', 'pv-1', null);
    quotes.setPriority('QR-1', 'pv-1', 'HIGH');
    quotes.queue({ owner: 'me' });
    expect(transport.post).toHaveBeenNthCalledWith(1, '/insurer/quote-requests/QR-1/products/pv-1/claim');
    expect(transport.post).toHaveBeenNthCalledWith(2, '/insurer/quote-requests/QR-1/products/pv-1/assign', { staffId: null });
    expect(transport.post).toHaveBeenNthCalledWith(3, '/insurer/quote-requests/QR-1/products/pv-1/priority', { priority: 'HIGH' });
    expect(transport.get).toHaveBeenCalledWith('/insurer/queue', { params: { owner: 'me' } });
  });
});

describe('quote changes and the customer choice', () => {
  it('withdraws, chooses and replaces with an uploaded quotation', async () => {
    quotes.withdraw('QR-1', 'pv-1', 'Wrong use.');
    quotes.select('QR-1', 'IQ-1', ['TRACKER']);
    expect(transport.post).toHaveBeenNthCalledWith(1, '/insurer/quote-requests/QR-1/products/pv-1/quote/withdraw', { reason: 'Wrong use.' });
    expect(transport.post).toHaveBeenNthCalledWith(2, '/quote-requests/QR-1/selection', { insurerQuoteId: 'IQ-1', acceptedConditionCodes: ['TRACKER'], addOnCodes: [] });
  });
});

describe('the insurer inspection routes', () => {
  it('lists and moves the insurer\'s inspections', async () => {
    const { inspections } = await import('./index');
    inspections.listForInsurer();
    inspections.schedule('INS-1', { scheduledDate: '2026-12-01T09:00:00.000Z' });
    inspections.assignInspector('INS-1', { inspectorName: 'Bwalya' });
    inspections.approve('INS-1');
    inspections.fail('INS-1', 'Damage.');
    inspections.noShow('INS-1', 'Absent.');
    inspections.cancel('INS-1', 'Duplicate.');
    expect(transport.get).toHaveBeenCalledWith('/insurer/inspections');
    expect(transport.post.mock.calls.map(([path]) => path)).toEqual([
      '/insurer/inspections/INS-1/schedule',
      '/insurer/inspections/INS-1/inspector',
      '/insurer/inspections/INS-1/approve',
      '/insurer/inspections/INS-1/fail',
      '/insurer/inspections/INS-1/no-show',
      '/insurer/inspections/INS-1/cancel',
    ]);
  });
});

describe('payments', () => {
  it('sends the caller key with each attempt, and reads and cancels by transaction', () => {
    payments.pay({ quoteRequestId: 'QR-1' }, 'KEY-1');
    payments.status('TXN-1');
    payments.cancel('TXN-1');
    expect(transport.post).toHaveBeenNthCalledWith(1, '/payments', { quoteRequestId: 'QR-1' }, { headers: { 'Idempotency-Key': 'KEY-1' } });
    expect(transport.get).toHaveBeenCalledWith('/payments/TXN-1');
    expect(transport.post).toHaveBeenNthCalledWith(2, '/payments/TXN-1/cancel');
  });
});

it('reads account JSON export and document metadata through the authenticated client', async () => {
  transport.get.mockResolvedValueOnce({ profile: { fullName: 'Mine' } }).mockResolvedValueOnce([]);
  await expect(account.export()).resolves.toEqual({ profile: { fullName: 'Mine' } });
  await expect(account.documents()).resolves.toEqual([]);
  expect(transport.get).toHaveBeenNthCalledWith(1, '/account/export');
  expect(transport.get).toHaveBeenNthCalledWith(2, '/account/documents');
});
