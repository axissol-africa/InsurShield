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

export const auth = {
  register: (account) =>
    call((s) => {
      s.registerCustomerAccount({ ...account, consentTimestamp: null });
      // Read back after the write: `s` is the snapshot from before it.
      return { customer: state().customer, consent: { accepted: false }, token: null };
    }),
  login: (identifier, password) =>
    call((s) => {
      if (!s.authenticateCustomer(identifier, password)) {
        throw new Error('Incorrect email/phone or password.');
      }
      return {
        customer: state().customer,
        consent: { accepted: state().consentAccepted, acceptedAt: state().consentTimestamp },
        token: null,
      };
    }),
  staffLogin: (email) =>
    call((s) => {
      // Matches the seeded accounts: an address at an insurer's domain is a
      // portal login, anything else is the console.
      const insurer = /^insurer@/i.test(email) ? state().insurersList[0] : null;
      const session = insurer
        ? { id: 'mock-insurer', name: `${insurer.name} portal`, email, role: 'insurer', insurerId: insurer.id, insurerName: insurer.name }
        : { id: 'mock-admin', name: 'InsurShield Administrator', email, role: 'admin', insurerId: null, insurerName: null };
      s.startStaffSession(session);
      return { session, token: null };
    }),
  changePassword: () => call(() => ({ ok: true })),
  me: () => call((s) => ({ customer: s.customer, staffSession: s.staffSession })),
  acceptConsent: (noticeVersion) =>
    call(() => ({ accepted: true, noticeVersion, acceptedAt: new Date().toISOString() })),
  closeAccount: () => call((s) => { s.deleteCurrentAccount(); return { ok: true }; }),
};

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
  submitRequest: ({ customer, policyDates }) => call((s) => { const id = s.submitQuoteRequest({ customer, policyDates }); return state().quoteRequests.find((r) => r.id === id); }),
  listMine: () => call((s) => mine(s.quoteRequests)),
  get: (id) => call((s) => s.quoteRequests.find((r) => r.id === id) || null),
  requote: (id) => call((s) => ({ ok: s.requoteFromRequest(id) })),
  listForInsurer: () => call((s) => s.quoteRequests.filter((r) => r.insurers?.includes(insurerName()))),
  reply: (id, quote) => call((s) => { s.addInsurerQuote(id, insurerName(), quote); return state().quoteRequests.find((r) => r.id === id); }),
  extend: (id, extraDays) => call((s) => { s.extendInsurerQuote(id, insurerName(), extraDays); return state().quoteRequests.find((r) => r.id === id); }),
};

export const insurers = {
  list: () => call((s) => s.insurersList),
  get: (id) => call((s) => s.insurersList.find((i) => i.id === id) || null),
  create: (insurer) => call((s) => { s.addInsurer(insurer); return state().insurersList.at(-1); }),
  update: (id, updates) => call((s) => { s.updateInsurer(id, updates); return state().insurersList.find((i) => i.id === id); }),
  setStatus: (id, status) => call((s) => { s.setInsurerStatus(id, status); return state().insurersList.find((i) => i.id === id); }),
  remove: (id) => call((s) => { s.deleteInsurer(id); return { ok: true }; }),
  directory: () => call((s) => s.insurersList.filter((i) => i.status !== 'Deleted')),
};

export const payments = {
  /** Simulated gateway round-trip: always confirms. */
  pay: ({ amount, method }) => call((s) => {
    const receipt = { transactionId: `TXN-${Date.now().toString(36).toUpperCase()}`, status: 'Confirmed', method, amount, currency: 'ZMW', confirmedAt: new Date().toISOString() };
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
    return approved ? { valid: true, insurer: approved.insurer, yearsClaimFree: approved.yearsClaimFree } : { valid: false };
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

export const insurerPortal = {
  profile: () =>
    call((s) => {
      const name = s.staffSession?.insurerName ?? s.staffSession?.name;
      return s.insurersList.find((insurer) => insurer.name === name) ?? null;
    }),
};

/**
 * The console, served from the store. Staff accounts have no browser-storage
 * equivalent, so they are kept in `mockStaffUsers` purely so the page can be
 * worked on without the API running.
 */
export const admin = {
  overview: () =>
    call((s) => ({
      insurers: s.insurersList.length,
      customers: s.registeredAccounts.length,
      quoteRequests: s.quoteRequests.length,
      policies: s.policies.length,
      claims: s.claims.length,
    })),
  premiumByMonth: () => call(() => []),
  recentPolicies: (limit = 8) => call((s) => s.policies.slice(0, limit)),
  findCustomer: (query) =>
    call((s) => s.registeredAccounts.filter((account) => account.email.includes(String(query).toLowerCase()))),

  listStaff: () => call((s) => s.mockStaffUsers),
  createStaff: (staff) =>
    call((s) => {
      const created = s.addMockStaffUser(staff);
      return { staff: created, temporaryPassword: 'mock-only-aa-12' };
    }),
  updateStaff: (id, changes) => call((s) => s.updateMockStaffUser(id, changes)),
  resetStaffPassword: () => call(() => ({ temporaryPassword: 'mock-only-aa-12' })),
  deactivateStaff: (id) => call((s) => s.updateMockStaffUser(id, { isActive: false })),

  listCustomers: (query = '') =>
    call((s) =>
      s.registeredAccounts
        .filter((account) =>
          !query ||
          [account.fullName, account.email, account.phone].some((field) =>
            String(field).toLowerCase().includes(String(query).toLowerCase()),
          ),
        )
        .map((account) => ({
          id: account.email,
          fullName: account.fullName,
          email: account.email,
          phone: account.phone,
          status: account.suspended ? 'Suspended' : 'Active',
          policies: s.policies.filter((policy) => policy.customerEmail === account.email).length,
          quoteRequests: s.quoteRequests.filter((request) => request.customer?.email === account.email).length,
          claims: s.claims.filter((claim) => claim.email === account.email).length,
          lastLoginAt: null,
          createdAt: account.createdAt ?? null,
        })),
    ),
  setCustomerSuspended: (id, suspended) =>
    call((s) => { s.setMockCustomerSuspended(id, suspended); return { id, status: suspended ? 'Suspended' : 'Active' }; }),
};

export const config = {
  getPia: () => call((s) => s.piaConfig),
  setPia: (piaConfig) => call((s) => { s.setPiaConfig(piaConfig); return state().piaConfig; }),
};
