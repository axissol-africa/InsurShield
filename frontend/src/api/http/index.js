/**
 * Backend adapter: every function maps 1:1 to an endpoint in `api/contracts.js`.
 * Responses are returned as the backend sends them (the client unwraps `data`).
 */
import { apiClient } from '@/lib/apiClient';
import { newIdempotencyKey } from '../shared';

export const auth = {
  register: (account) => apiClient.post('/auth/register', account),
  login: (identifier, password) => apiClient.post('/auth/login', { identifier, password }),
  requestOtp: (phone) => apiClient.post('/auth/otp', { phone }),
  verifyOtp: (phone, code) => apiClient.post('/auth/otp/verify', { phone, code }),
  resetPassword: (identifier, password, otp) => apiClient.post('/auth/password-reset', { identifier, password, otp }),
  staffLogin: (email, password) => apiClient.post('/auth/staff/login', { email, password }),
  me: () => apiClient.get('/auth/me'),
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
  update: (id, status, data) => apiClient.patch(`/inspections/${id}`, { status, ...data }),
};

export const config = {
  getPia: () => apiClient.get('/config/pia'),
  setPia: (piaConfig) => apiClient.put('/config/pia', piaConfig),
};
