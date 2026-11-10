/**
 * Mock adapter: the same functions as `api/http`, served from browser storage.
 *
 * Reads come straight from the store; writes call the store actions that the
 * pages used directly in the prototype. Each call waits `mockLatencyMs` so
 * loading states are exercised. Anything the prototype does not model yet
 * (OTP, payment gateway, RTSA registry) returns a realistic stub.
 */
import { env } from '@/config/env';
import { useStore, belongsToCustomer } from '@/store';
import { wait } from '../shared';
import { documentToRecord } from '@/lib/files';

const state = () => useStore.getState();
const call = async (fn) => { await wait(env.mockLatencyMs); return fn(state()); };
const newReference = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const insurerNameById = (id) => state().insurersList.find((insurer) => insurer.id === id)?.name ?? '';
const mine = (records) => records.filter(belongsToCustomer(state().customer));
const insurerName = () => state().staffSession?.name;
// The browser adapter stands in for the API during prototype demos. Production
// clients always receive this fee from the API configuration, never this value.
const MOCK_RTSA_ANNIVERSARY_FEE = 500;

export const auth = {
  register: (account) => call((s) => {
    s.registerCustomerAccount(account);
    return { signedIn: true, userId: `mock:${s.customer.email}`, customer: s.customer };
  }),
  signIn: (identifier, password) => call((s) => {
    if (identifier.startsWith('insurer@') || identifier.startsWith('admin@')) {
      const role = identifier.startsWith('insurer@') ? 'insurer' : 'admin';
      const staffSession = { role, name: role === 'insurer' ? 'Prestige Assurance' : 'Admin', isSuperAdmin: role === 'admin' };
      s.applyStaffSession(staffSession);
      return { user: { id: `mock:${identifier}`, email: identifier }, staffSession };
    }
    if (!s.authenticateCustomer(identifier, password)) throw new Error('Incorrect email/phone or password.');
    return { user: { id: `mock:${state().customer.email}`, email: state().customer.email }, customer: state().customer };
  }),
  signOut: () => call((s) => { s.clearCustomerSession(); return { ok: true }; }),
  revokeSessions: () => call(() => ({ ok: true })),
  changePassword: (_currentPassword, newPassword) => call((s) => { s.resetCustomerPassword(s.customer?.email, newPassword); return { ok: true }; }),
  requestPasswordReset: (email) => call(() => ({ email, sent: true })),
  resetPassword: (_token, newPassword) => call((s) => { s.resetCustomerPassword(s.customer?.email, newPassword); return { ok: true }; }),
  sendVerificationEmail: () => call(() => ({ sent: true })),
  acceptConsent: (noticeVersion) => call((s) => {
    const record = { accepted: true, noticeVersion, acceptedAt: new Date().toISOString() };
    s.setConsent(true, record);
    return record;
  }),
  me: () => call((s) => ({
    userId: s.staffSession ? `mock:${s.staffSession.role}` : (s.customer ? `mock:${s.customer.email}` : null),
    customer: s.customer,
    consent: { accepted: s.consentAccepted, noticeVersion: s.consentRecord?.noticeVersion ?? null, acceptedAt: s.consentTimestamp },
    staffSession: s.staffSession,
  })),
  // Existing demo tests and external prototype callers used these names.
  login: (identifier, password) => auth.signIn(identifier, password),
};

/**
 * Mock mode has no job runner and no insurer acting on its own, so nothing
 * generates a notification. The centre is therefore empty rather than seeded:
 * showing invented messages would make the empty state the one thing nobody
 * ever saw, and that is the state most customers will meet first.
 */
export const notifications = {
  list: () => call(() => ({ items: [], nextCursor: null, unread: 0 })),
  markRead: () => call(() => undefined),
};

export const contactPreferences = {
  read: () => call((s) => ({ preferences: s.contactPreferences ?? [], marketingConsent: s.marketingConsent ?? false })),
  save: (choice) => call((s) => { s.saveContactPreference(choice); }),
};

export const account = {
  close: () => call((s) => { s.deleteCurrentAccount(); return { ok: true }; }),
};

/**
 * In mock mode a document never leaves the browser: the file is read into a
 * data URL and handed back with the same shape the backend returns, so pages
 * can attach it by `id` either way.
 */
export const documents = {
  upload: (file) => call(async () => ({ ...(await documentToRecord(file)), id: newReference('DOC') })),
  get: (id) => call(() => ({ id })),
};

export const vehicles = {
  /** Prototype stand-in for the RTSA vehicle registry. */
  lookupPlate: (plate) => call(() => ({
    plateNumber: plate.trim().toUpperCase(),
    make: 'Toyota', model: 'Hilux', year: '2020', color: 'White',
    chassisNumber: 'JTEH1234560012345', engineNumber: '2GD-FTV-12345',
    registrationDate: '2020-03-15', rtsaAnniversaryDate: '2023-10-31',
  })),
};

export const quotes = {
  // The journey state already holds the vehicle, value and photos, so the
  // payload's extra fields are redundant here — the store builds the same
  // record the backend would return.
  submitRequest: ({ customer, policyDates }) => call((s) => {
    const rtsaAnniversaryFee = s.matchRtsaAnniversary ? MOCK_RTSA_ANNIVERSARY_FEE : 0;
    const id = s.submitQuoteRequest({ customer, policyDates, rtsaAnniversaryFee });
    return state().quoteRequests.find((r) => r.id === id);
  }),
  listMine: () => call((s) => mine(s.quoteRequests)),
  get: (id) => call((s) => s.quoteRequests.find((r) => r.id === id) || null),
  requote: (id) => call((s) => ({ ok: s.requoteFromRequest(id) })),
  listForInsurer: () => call((s) => s.quoteRequests.filter((r) => r.insurers?.includes(insurerName()))),
  reply: (id, quote) => call((s) => { s.addInsurerQuote(id, insurerName(), quote); return state().quoteRequests.find((r) => r.id === id); }),
  extend: (id, extraDays) => call((s) => { s.extendInsurerQuote(id, insurerName(), extraDays); return state().quoteRequests.find((r) => r.id === id); }),
};

export const insurers = {
  profile: () => call((s) => s.insurersList.find((insurer) => insurer.name === insurerName()) || null),
  list: ({ status } = {}) => call((s) => (
    status === 'deleted'
      ? s.insurersList.filter((insurer) => insurer.status === 'Deleted')
      : s.insurersList.filter((insurer) => insurer.status !== 'Deleted')
  )),
  get: (id) => call((s) => s.insurersList.find((i) => i.id === id) || null),
  create: (insurer) => call((s) => { s.addInsurer(insurer); return state().insurersList.at(-1); }),
  update: (id, updates) => call((s) => { s.updateInsurer(id, updates); return state().insurersList.find((i) => i.id === id); }),
  setStatus: (id, status) => call((s) => { s.setInsurerStatus(id, status); return state().insurersList.find((i) => i.id === id); }),
  remove: (id) => call((s) => { s.deleteInsurer(id); return { ok: true }; }),
  restore: (id) => call((s) => {
    const insurer = s.insurersList.find((entry) => entry.id === id);
    if (!insurer) throw new Error('Insurer was not found.');
    if (insurer.status !== 'Deleted') throw new Error('This insurer has not been deleted.');
    s.updateInsurer(id, { status: 'Inactive', deletedAt: null });
    return state().insurersList.find((entry) => entry.id === id);
  }),
  directory: () => call((s) => s.insurersList.filter((insurer) => !insurer.status || insurer.status === 'Active')),
};

export const payments = {
  /** Simulated gateway round-trip: always confirms. */
  pay: ({ amount, method, quoteRequestId }) => call((s) => {
    const request = s.quoteRequests.find((item) => item.id === quoteRequestId);
    const receipt = {
      transactionId: `TXN-${Date.now().toString(36).toUpperCase()}`,
      status: 'Confirmed',
      method,
      amount,
      rtsaAnniversaryFee: request?.rtsaAnniversaryFee ?? 0,
      currency: 'ZMW',
      confirmedAt: new Date().toISOString(),
      policyNumber: `POL-${Date.now().toString(36).toUpperCase()}`,
    };
    s.recordPayment(receipt);
    return receipt;
  }),
  status: (transactionId) => call((s) => (s.paymentReceipt?.transactionId === transactionId ? s.paymentReceipt : null)),
};

export const policies = {
  listMine: () => call((s) => mine(s.policies)),
  get: (policyNumber) => call((s) => s.policies.find((p) => p.policyNumber === policyNumber) || null),
  renew: (policyNumber) => call((s) => ({ ok: s.renewFromPolicy(policyNumber) })),
  listForInsurer: () => call((s) => s.policies.filter((p) => p.insurer === insurerName())),
  issueCertificate: (policyNumber, issuance) => call((s) => { s.issuePolicyCertificate(policyNumber, issuance); return state().policies.find((p) => p.policyNumber === policyNumber); }),
};

export const claims = {
  // The backend issues the claim number; in mock mode it is minted here so a
  // page gets the same record either way.
  notify: (claim) => call((s) => {
    s.addClaim({ ...claim, claimNumber: claim.claimNumber ?? newReference('CLM'), insurer: claim.insurer ?? insurerNameById(claim.insurerId) });
    return state().claims[0];
  }),
  listMine: () => call((s) => mine(s.claims)),
  listForInsurer: () => call((s) => s.claims.filter((c) => c.insurer === insurerName())),
  markReceived: (claimNumber) => call((s) => { s.markClaimReceived(claimNumber); return state().claims.find((c) => c.id === claimNumber); }),
};

export const ncd = {
  apply: (application) => call((s) => { s.addNcdApplication(application); return state().ncdApplications[0]; }),
  listMine: () => call((s) => mine(s.ncdApplications)),
  validateCode: (code) => call((s) => {
    const approved = s.ncdApplications.find((a) => a.approvedCode === code);
    return { valid: Boolean(approved) };
  }),
  listForInsurer: () => call((s) => s.ncdApplications.filter((a) => a.insurer === insurerName())),
  decide: (id, status) => call((s) => {
    const code = status === 'Approved' ? `NCD-${Math.random().toString(36).slice(2, 7).toUpperCase()}` : null;
    s.updateNcdApplicationStatus(id, status, code);
    return state().ncdApplications.find((a) => a.id === id);
  }),
};

export const inspections = {
  request: (inspection) => call((s) => { s.addInspection(inspection); return state().inspections[0]; }),
  list: () => call((s) => mine(s.inspections)),
  update: (id, changes) => call((s) => { s.updateInspectionStatus(id, 'Requested', changes); return state().inspections.find((i) => i.id === id); }),
};

export const config = {
  getPia: () => call((s) => s.piaConfig),
  setPia: (piaConfig) => call((s) => { s.setPiaConfig(piaConfig); return state().piaConfig; }),
};

/**
 * Browser-storage equivalent of the protected administrator read endpoints.
 * It keeps prototype mode useful while HTTP mode always reads these figures
 * from the API rather than reusing persisted demo records.
 */
export const admin = {
  overview: () => call((s) => {
    const activePolicies = s.policies.filter((policy) => policy.status === 'Active').length;
    const awaitingCertificate = s.policies.filter((policy) => policy.status === 'Awaiting insurer certificate').length;
    const activeInsurers = s.insurersList.filter((insurer) => insurer.status === 'Active').length;
    const visibleInsurers = s.insurersList.filter((insurer) => insurer.status !== 'Deleted').length;
    const openClaims = s.claims.filter((claim) => claim.status === 'Notified').length;
    const submittedQuotes = s.quoteRequests.filter((request) => request.status === 'Submitted').length;
    const quotedRequests = s.quoteRequests.filter((request) => request.status === 'Quoted').length;
    const openNcd = s.ncdApplications.filter((application) => ['Submitted', 'Under Review'].includes(application.status)).length;
    const confirmed = s.policies.filter((policy) => policy.paymentProof?.status === 'Confirmed');
    return {
      policies: { total: s.policies.length, active: activePolicies, awaitingCertificate, expiringIn30Days: 0 },
      insurers: { total: visibleInsurers, active: activeInsurers, inactive: visibleInsurers - activeInsurers },
      claims: { open: openClaims, total: s.claims.length },
      quoteRequests: { awaitingQuotes: submittedQuotes, quoted: quotedRequests },
      ncd: { open: openNcd },
      customers: { total: s.registeredAccounts.length },
      premium: { currency: 'ZMW', allTime: confirmed.reduce((sum, policy) => sum + (policy.premium || 0), 0), thisMonth: 0 },
    };
  }),
  premiumByMonth: (months = 12) => call((s) => {
    const now = new Date();
    return Array.from({ length: months }, (_, index) => {
      const date = new Date(now.getFullYear(), now.getMonth() - (months - index - 1), 1);
      const total = s.policies
        .filter((policy) => policy.paymentProof?.status === 'Confirmed')
        .filter((policy) => {
          const paidAt = new Date(policy.paymentProof?.confirmedAt || policy.receivedAt || policy.issuedAt || 0);
          return paidAt.getFullYear() === date.getFullYear() && paidAt.getMonth() === date.getMonth();
        })
        .reduce((sum, policy) => sum + (policy.premium || 0), 0);
      return { month: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`, total };
    });
  }),
  recentPolicies: (limit = 8) => call((s) => [...s.policies]
    .sort((first, second) => new Date(second.receivedAt || second.issuedAt || 0) - new Date(first.receivedAt || first.issuedAt || 0))
    .slice(0, limit)),
  findCustomer: (query) => call((s) => {
    const needle = query.trim().toLowerCase();
    const account = s.registeredAccounts.find((item) => item.email.toLowerCase() === needle || item.phone === query.trim());
    if (!account) {
      const error = new Error('Customer account was not found.');
      error.status = 404;
      throw error;
    }
    return {
      id: account.id || account.email,
      fullName: account.fullName,
      email: account.email,
      phone: account.phone,
      createdAt: account.createdAt || null,
      consent: null,
      counts: {
        quoteRequests: s.quoteRequests.filter((item) => item.customer?.email === account.email || item.customer?.phone === account.phone).length,
        policies: s.policies.filter((item) => item.customerEmail === account.email || item.customerPhone === account.phone).length,
        claims: s.claims.filter((item) => item.email === account.email || item.phone === account.phone).length,
      },
    };
  }),
  // Audit history needs the server's append-only database. Prototype mode
  // states that boundary plainly rather than inventing compliance records.
  auditLogs: () => call(() => ({ items: [], nextCursor: null })),
};
