/**
 * Backend adapter: every function maps 1:1 to an endpoint in `api/contracts.js`.
 * Responses are returned as the backend sends them (the client unwraps `data`).
 */
import { apiClient } from '@/lib/apiClient';
import { newIdempotencyKey } from '../shared';

export const auth = {
  register: (account) => apiClient.post('/identity/register', account),
  signIn: (email, password) => apiClient.post('/identity/sign-in/email', { email, password }),
  sendStaffMfaCode: () => apiClient.post('/identity/two-factor/send-otp', {}),
  verifyStaffMfaCode: (code) => apiClient.post('/identity/two-factor/verify-otp', { code }),
  signOut: () => apiClient.post('/identity/sign-out'),
  revokeSessions: () => apiClient.post('/identity/revoke-sessions'),
  changePassword: (currentPassword, newPassword) => apiClient.post('/identity/change-password', { currentPassword, newPassword, revokeOtherSessions: true }),
  requestPasswordReset: (email, redirectTo) => apiClient.post('/identity/request-password-reset', { email, redirectTo }),
  resetPassword: (token, newPassword) => apiClient.post('/identity/reset-password', { token, newPassword }),
  sendVerificationEmail: (callbackURL) => apiClient.post('/identity/send-verification-email', { callbackURL }),
  me: ({ boot = false } = {}) => apiClient.get('/auth/me', { identity: boot ? 'omit' : undefined }),
  acceptConsent: (noticeVersion) => apiClient.post('/auth/consent', { noticeVersion }),
};

export const account = {
  close: () => apiClient.delete('/account'),
};

/**
 * Uploads land here first and are referenced by id afterwards: a quotation,
 * certificate or photo is attached to a record only once its bytes are stored.
 */
export const notifications = {
  list: (before) => apiClient.get(`/notifications${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  markRead: (id) => apiClient.post(`/notifications/${id}/read`),
};

export const contactPreferences = {
  read: () => apiClient.get('/contact-preferences'),
  save: (choice) => apiClient.put('/contact-preferences', choice),
};

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
  submitRequest: (request, idempotencyKey = newIdempotencyKey()) => apiClient.post('/quote-requests', request, { headers: { 'Idempotency-Key': idempotencyKey } }),
  listMine: () => apiClient.get('/quote-requests'),
  get: (id) => apiClient.get(`/quote-requests/${id}`),
  requote: (id) => apiClient.post(`/quote-requests/${id}/requote`),
  listForInsurer: () => apiClient.get('/insurer/quote-requests'),
  reply: (id, quote) => apiClient.post(`/insurer/quote-requests/${id}/quote`, quote),
  extend: (id, extraDays) => apiClient.post(`/insurer/quote-requests/${id}/extend`, { extraDays }),
};

export const insurers = {
  /** The signed-in insurer's own record; never a browser-selected insurer. */
  profile: () => apiClient.get('/insurer/profile'),
  list: (query = {}) => apiClient.get('/insurers', { params: query }),
  get: (id) => apiClient.get(`/insurers/${id}`),
  create: (insurer) => apiClient.post('/insurers', insurer),
  update: (id, updates) => apiClient.patch(`/insurers/${id}`, updates),
  setStatus: (id, status) => apiClient.patch(`/insurers/${id}/status`, { status }),
  suspend: (id, reason) => apiClient.post(`/insurers/${id}/suspend`, { reason }),
  evidence: (id) => apiClient.get(`/insurers/${id}/evidence`),
  captureEvidence: (id, evidence) => apiClient.post(`/insurers/${id}/evidence`, evidence),
  reviewEvidence: (id, evidenceId, review) => apiClient.post(`/insurers/${id}/evidence/${evidenceId}/review`, review),
  integration: (id) => apiClient.get(`/insurers/${id}/integration`),
  setIntegration: (id, model) => apiClient.put(`/insurers/${id}/integration`, model),
  activate: (id, approval) => apiClient.post(`/insurers/${id}/activate`, approval),
  remove: (id) => apiClient.delete(`/insurers/${id}`),
  restore: (id) => apiClient.post(`/insurers/${id}/restore`),
  directory: () => apiClient.get('/insurers/directory'),
};

/**
 * Versioned policy terms. Insurers own the draft and submit it for review;
 * only platform administrators can approve, reject, or withdraw a version.
 */
export const products = {
  insurer: {
    list: () => apiClient.get('/insurer/products'),
    get: (productId) => apiClient.get(`/insurer/products/${encodeURIComponent(productId)}`),
    create: (product) => apiClient.post('/insurer/products', product),
    updateDraft: (productId, versionId, changes) => apiClient.patch(`/insurer/products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(versionId)}`, changes),
    revise: (productId, versionId) => apiClient.post(`/insurer/products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(versionId)}/revise`),
    submit: (productId, versionId) => apiClient.post(`/insurer/products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(versionId)}/submit`),
  },
  admin: {
    list: (query = {}) => apiClient.get('/admin/products', { params: query }),
    approve: (productId, versionId, decision = {}) => apiClient.post(`/admin/products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(versionId)}/approve`, decision),
    reject: (productId, versionId, decision) => apiClient.post(`/admin/products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(versionId)}/reject`, decision),
    withdraw: (productId, versionId, decision) => apiClient.post(`/admin/products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(versionId)}/withdraw`, decision),
  },
  directory: (query = {}) => apiClient.get('/products/directory', { params: query }),
};

export const staff = {
  listUsers: () => apiClient.get('/staff/users'),
  createUser: (user) => apiClient.post('/staff/users', user),
  updateUser: (id, changes) => apiClient.patch(`/staff/users/${id}`, changes),
  resendInvitation: (id, reason) => apiClient.post(`/staff/users/${id}/invitation`, { reason }),
  listTeams: () => apiClient.get('/staff/teams'),
  createTeam: (team) => apiClient.post('/staff/teams', team),
  updateTeam: (id, changes) => apiClient.patch(`/staff/teams/${id}`, changes),
  removeTeam: (id, reason) => apiClient.delete(`/staff/teams/${id}`, { data: { reason } }),
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
  notify: (claim, idempotencyKey = newIdempotencyKey()) => apiClient.post('/claims', claim, { headers: { 'Idempotency-Key': idempotencyKey } }),
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

export const config = {
  getPia: () => apiClient.get('/config/pia'),
  setPia: (piaConfig) => apiClient.put('/config/pia', piaConfig),
};

/** Platform-wide records for the administrator console. */
export const admin = {
  approvals: {
    list: () => apiClient.get('/admin/approvals'),
    approve: (id, decision = {}) => apiClient.post(`/admin/approvals/${encodeURIComponent(id)}/approve`, decision),
    reject: (id, decision = {}) => apiClient.post(`/admin/approvals/${encodeURIComponent(id)}/reject`, decision),
  },
  overview: () => apiClient.get('/admin/overview'),
  premiumByMonth: (months = 12) => apiClient.get('/admin/premium-by-month', { params: { months } }),
  recentPolicies: (limit = 8) => apiClient.get('/admin/policies', { params: { limit } }),
  findCustomer: (query) => apiClient.get('/admin/customers/find', { params: { query } }),
  requestCustomerPasswordReset: (request) => apiClient.post('/admin/customers/password-reset', request),
  auditLogs: (query = {}) => apiClient.get('/admin/audit-logs', { params: query }),
};
