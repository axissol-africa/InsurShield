/**
 * Backend adapter: every function maps 1:1 to an endpoint in `api/contracts.js`.
 * Responses are returned as the backend sends them (the client unwraps `data`).
 */
import { apiClient } from '@/lib/apiClient';
import { newIdempotencyKey } from '../shared';

// PARKED: `/auth/otp`, `/auth/otp/verify` and `/auth/password-reset` all need
// an email or SMS provider. Nothing calls them, so nothing claims they work.
export const auth = {
  register: (account) => apiClient.post('/auth/register', account),
  login: (identifier, password) => apiClient.post('/auth/login', { identifier, password }),
  staffLogin: (email, password) => apiClient.post('/auth/staff/login', { email, password }),
  changePassword: (currentPassword, newPassword) =>
    apiClient.post('/auth/password', { currentPassword, newPassword }),
  me: () => apiClient.get('/auth/me'),
  acceptConsent: (noticeVersion) => apiClient.post('/auth/consent', { noticeVersion }),
  closeAccount: () => apiClient.delete('/account'),
};

/**
 * Uploads land here first and are referenced by id afterwards: a quotation,
 * certificate or photo is attached to a record only once its bytes are stored.
 */
export const documents = {
  upload: (file, kind) => {
    const form = new FormData();
    form.append('file', file);
    form.append('kind', kind);
    return apiClient.post('/documents', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  get: (id) => apiClient.get(`/documents/${id}`),
};

export const vehicles = {
  lookupPlate: (plate) => apiClient.get('/vehicles/lookup', { params: { plate } }),
};

export const quotes = {
  submitRequest: (request) => apiClient.post('/quote-requests', request, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
  listMine: () => apiClient.get('/quote-requests'),
  get: (id) => apiClient.get(`/quote-requests/${id}`),
  requote: (id) => apiClient.post(`/quote-requests/${id}/requote`),
  listForInsurer: () => apiClient.get('/insurer/quote-requests'),
  reply: (id, quote) => apiClient.post(`/insurer/quote-requests/${id}/quote`, quote),
  extend: (id, extraDays) => apiClient.post(`/insurer/quote-requests/${id}/extend`, { extraDays }),
};

export const insurers = {
  list: () => apiClient.get('/insurers'),
  get: (id) => apiClient.get(`/insurers/${id}`),
  create: (insurer) => apiClient.post('/insurers', insurer),
  update: (id, updates) => apiClient.patch(`/insurers/${id}`, updates),
  setStatus: (id, status) => apiClient.patch(`/insurers/${id}/status`, { status }),
  remove: (id) => apiClient.delete(`/insurers/${id}`),
  directory: () => apiClient.get('/insurers/directory'),
};

export const payments = {
  pay: (payment) => apiClient.post('/payments', payment, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
  status: (id) => apiClient.get(`/payments/${id}`),
};

export const policies = {
  listMine: () => apiClient.get('/policies'),
  get: (policyNumber) => apiClient.get(`/policies/${policyNumber}`),
  renew: (policyNumber) => apiClient.post(`/policies/${policyNumber}/renew`),
  listForInsurer: () => apiClient.get('/insurer/policies'),
  issueCertificate: (policyNumber, issuance) => apiClient.post(`/insurer/policies/${policyNumber}/certificate`, issuance),
};

export const claims = {
  notify: (claim) => apiClient.post('/claims', claim, { headers: { 'Idempotency-Key': newIdempotencyKey() } }),
  listMine: () => apiClient.get('/claims'),
  listForInsurer: () => apiClient.get('/insurer/claims'),
  markReceived: (claimNumber) => apiClient.post(`/insurer/claims/${claimNumber}/received`),
};

export const ncd = {
  apply: (application) => apiClient.post('/ncd/applications', application),
  listMine: () => apiClient.get('/ncd/applications'),
  validateCode: (code) => apiClient.post('/ncd/codes/validate', { code }),
  listForInsurer: () => apiClient.get('/insurer/ncd/applications'),
  decide: (id, status) => apiClient.post(`/insurer/ncd/applications/${id}/decision`, { status }),
};

export const inspections = {
  request: (inspection) => apiClient.post('/inspections', inspection),
  list: () => apiClient.get('/inspections'),
  update: (id, changes) => apiClient.patch(`/inspections/${id}`, changes),
};

export const insurerPortal = {
  profile: () => apiClient.get('/insurer/profile'),
};

export const admin = {
  overview: () => apiClient.get('/admin/overview'),
  premiumByMonth: (months = 12) => apiClient.get('/admin/premium-by-month', { params: { months } }),
  recentPolicies: (limit = 8) => apiClient.get('/admin/policies', { params: { limit } }),
  findCustomer: (query) => apiClient.get('/admin/customers/find', { params: { query } }),

  listStaff: () => apiClient.get('/admin/staff'),
  createStaff: (staff) => apiClient.post('/admin/staff', staff),
  updateStaff: (id, changes) => apiClient.patch(`/admin/staff/${id}`, changes),
  resetStaffPassword: (id) => apiClient.post(`/admin/staff/${id}/password`),
  deactivateStaff: (id) => apiClient.delete(`/admin/staff/${id}`),

  listCustomers: (query = '', limit = 50) => apiClient.get('/admin/customers', { params: { query, limit } }),
  setCustomerSuspended: (id, suspended) =>
    apiClient.patch(`/admin/customers/${id}/suspension`, { suspended }),
};

export const config = {
  getPia: () => apiClient.get('/config/pia'),
  setPia: (piaConfig) => apiClient.put('/config/pia', piaConfig),
};
