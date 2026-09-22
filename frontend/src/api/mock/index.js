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

const state = () => useStore.getState();
const call = async (fn) => { await wait(env.mockLatencyMs); return fn(state()); };
const mine = (records) => records.filter(belongsToCustomer(state().customer));
const insurerName = () => state().staffSession?.name;

export const auth = {
  register: (account) => call((s) => { s.registerCustomerAccount(account); return { customer: s.customer, token: null }; }),
  login: (identifier, password) => call((s) => {
    if (!s.authenticateCustomer(identifier, password)) throw new Error('Incorrect email/phone or password.');
    return { customer: state().customer, token: null };
  }),
  requestOtp: (phone) => call(() => ({ phone, sent: true, expiresInSeconds: 300 })),
  verifyOtp: (phone, code) => call(() => ({ phone, verified: /^\d{4,6}$/.test(code) })),
  resetPassword: (identifier, password) => call((s) => { s.resetCustomerPassword(identifier, password); return { ok: true }; }),
  staffLogin: (email) => call((s) => {
    const role = email.startsWith('insurer') ? 'insurer' : 'admin';
    const session = { role, name: role === 'insurer' ? 'Prestige Assurance' : 'Admin' };
    s.startStaffSession(session);
    return { session, token: null };
  }),
  me: () => call((s) => ({ customer: s.customer, staffSession: s.staffSession })),
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
  listForInsurer: () => call((s) => s.policies.filter((p) => p.insurer === insurerName())),
  issueCertificate: (policyNumber, issuance) => call((s) => { s.issuePolicyCertificate(policyNumber, issuance); return state().policies.find((p) => p.policyNumber === policyNumber); }),
};

export const claims = {
  notify: (claim) => call((s) => { s.addClaim(claim); return state().claims[0]; }),
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
  update: (id, status, data) => call((s) => { s.updateInspectionStatus(id, status, data); return state().inspections.find((i) => i.id === id); }),
};

export const config = {
  getPia: () => call((s) => s.piaConfig),
  setPia: (piaConfig) => call((s) => { s.setPiaConfig(piaConfig); return state().piaConfig; }),
};
