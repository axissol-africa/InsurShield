/**
 * Backend adapter: every function maps 1:1 to an endpoint in `api/contracts.js`.
 * Responses are returned as the backend sends them (the client unwraps `data`).
 */
import { apiClient } from '@/lib/apiClient';
import { toUploadableFile } from '@/lib/files';
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
  export: () => apiClient.get('/account/export'),
  documents: () => apiClient.get('/account/documents'),
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

/**
 * The portal screens hold a picked file as a record, the same in both modes.
 * The API takes the file as its own upload and is then given the document id,
 * so it can scan and store the file before any quote or policy points at it.
 */
const uploadedDocumentId = async (record, fallbackName, kind) =>
  (await documents.upload(await toUploadableFile(record, record.name || fallbackName), kind)).id;

export const vehicles = {
  lookupPlate: (plate) => apiClient.get('/vehicles/lookup', { params: { plate } }),
};

const productPath = (id, productVersionId) =>
  `/insurer/quote-requests/${encodeURIComponent(id)}/products/${encodeURIComponent(productVersionId)}`;

export const quotes = {
  submitRequest: (request, idempotencyKey = newIdempotencyKey()) => {
    const body = { ...request };
    delete body.customer;
    return apiClient.post('/quote-requests', body, { headers: { 'Idempotency-Key': idempotencyKey } });
  },
  listMine: () => apiClient.get('/quote-requests'),
  get: (id) => apiClient.get(`/quote-requests/${id}`),
  requote: (id) => apiClient.post(`/quote-requests/${id}/requote`),
  listForInsurer: () => apiClient.get('/insurer/quote-requests'),
  reply: async (id, { document, ...quote }) => apiClient.post(
    `/insurer/quote-requests/${id}/quote`,
    document ? { ...quote, documentId: await uploadedDocumentId(document, 'quotation', 'QUOTATION') } : quote,
  ),
  // A quote for a chosen product is extended by naming that product.
  extend: (id, extraDays, productVersionId) => apiClient.post(
    `/insurer/quote-requests/${id}/extend`,
    productVersionId ? { extraDays, productVersionId } : { extraDays },
  ),
  // One chosen product's workflow: the insurer declines it, asks the customer
  // something, or keeps internal notes; the customer answers the question.
  declineReasons: () => apiClient.get('/insurer/decline-reasons'),
  decline: (id, productVersionId, decision) => apiClient.post(`${productPath(id, productVersionId)}/decline`, decision),
  requestInformation: (id, productVersionId, question) => apiClient.post(`${productPath(id, productVersionId)}/information-requests`, question),
  notes: (id, productVersionId) => apiClient.get(`${productPath(id, productVersionId)}/notes`),
  addNote: (id, productVersionId, body) => apiClient.post(`${productPath(id, productVersionId)}/notes`, { body }),
  withdraw: (id, productVersionId, reason) => apiClient.post(`${productPath(id, productVersionId)}/quote/withdraw`, { reason }),
  replace: async (id, productVersionId, { document, ...quote }) => apiClient.post(
    `${productPath(id, productVersionId)}/quote/replace`,
    { ...quote, documentId: await uploadedDocumentId(document, 'quotation', 'QUOTATION') },
  ),
  // The customer's choice of quote, with the conditions they accept.
  select: (id, insurerQuoteId, acceptedConditionCodes = [], addOnCodes = []) => apiClient.post(
    `/quote-requests/${encodeURIComponent(id)}/selection`,
    { insurerQuoteId, acceptedConditionCodes, addOnCodes },
  ),
  claim: (id, productVersionId) => apiClient.post(`${productPath(id, productVersionId)}/claim`),
  assign: (id, productVersionId, staffId) => apiClient.post(`${productPath(id, productVersionId)}/assign`, { staffId }),
  setPriority: (id, productVersionId, priority) => apiClient.post(`${productPath(id, productVersionId)}/priority`, { priority }),
  queue: (query = {}) => apiClient.get('/insurer/queue', { params: query }),
  answerInformation: (id, productVersionId, answer) => apiClient.post(
    `/quote-requests/${encodeURIComponent(id)}/products/${encodeURIComponent(productVersionId)}/information`,
    { answer },
  ),
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
    comparisonTaxonomy: () => apiClient.get('/insurer/products/comparison-taxonomy'),
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
  estimate: (productId, versionId, query) => apiClient.get(`/products/${encodeURIComponent(productId)}/versions/${encodeURIComponent(versionId)}/estimate`, { params: query }),
};

/** Versioned platform rules and the insurer-comparison vocabulary. */
export const settings = {
  rules: {
    list: () => apiClient.get('/admin/settings/rules'),
    history: (key) => apiClient.get(`/admin/settings/rules/${encodeURIComponent(key)}`),
    create: (key, input) => apiClient.post(`/admin/settings/rules/${encodeURIComponent(key)}/versions`, input),
    confirm: (key, versionId) => apiClient.post(`/admin/settings/rules/${encodeURIComponent(key)}/versions/${encodeURIComponent(versionId)}/confirm`),
  },
  taxonomy: {
    list: () => apiClient.get('/admin/settings/comparison-taxonomy'),
    create: (input) => apiClient.post('/admin/settings/comparison-taxonomy', input),
    update: (id, input) => apiClient.patch(`/admin/settings/comparison-taxonomy/${encodeURIComponent(id)}`, input),
  },
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
  /** Starts an attempt. The same key is sent again when the same attempt is retried, so it is never started twice. */
  pay: (payment, idempotencyKey = newIdempotencyKey()) => apiClient.post('/payments', payment, { headers: { 'Idempotency-Key': idempotencyKey } }),
  status: (id) => apiClient.get(`/payments/${id}`),
  cancel: (id) => apiClient.post(`/payments/${id}/cancel`),
};

export const policies = {
  listMine: () => apiClient.get('/policies'),
  get: (policyNumber) => apiClient.get(`/policies/${policyNumber}`),
  renew: (policyNumber) => apiClient.post(`/policies/${policyNumber}/renew`),
  listForInsurer: () => apiClient.get('/insurer/policies'),
  issueCertificate: async (policyNumber, { certificateDocument, ...issuance }) => apiClient.post(
    `/insurer/policies/${policyNumber}/certificate`,
    certificateDocument
      ? { ...issuance, certificateDocumentId: await uploadedDocumentId(certificateDocument, 'certificate', 'CERTIFICATE') }
      : issuance,
  ),
  acceptIssuance: (policyNumber, insurerPolicyNumber) => apiClient.post(
    `/insurer/policies/${policyNumber}/accept`,
    insurerPolicyNumber ? { insurerPolicyNumber } : {},
  ),
  reportIssuanceFailure: (policyNumber, failure) => apiClient.post(`/insurer/policies/${policyNumber}/issuance-failure`, failure),
};

export const claims = {
  notify: (claim, idempotencyKey = newIdempotencyKey()) => apiClient.post('/claims', claim, { headers: { 'Idempotency-Key': idempotencyKey } }),
  listMine: () => apiClient.get('/claims'),
  listForInsurer: () => apiClient.get('/insurer/claims'),
  markReceived: (claimNumber, acknowledgement) => apiClient.post(`/insurer/claims/${encodeURIComponent(claimNumber)}/received`, acknowledgement),
  intakeRules: () => apiClient.get('/claims/intake-rules'),
  timeline: (number) => apiClient.get(`/claims/${encodeURIComponent(number)}/timeline`),
  insurerTimeline: (number) => apiClient.get(`/insurer/claims/${encodeURIComponent(number)}/timeline`),
  update: (number, update, key = newIdempotencyKey()) => apiClient.post(`/insurer/claims/${encodeURIComponent(number)}/updates`, update, { headers: { 'Idempotency-Key': key } }),
  submitEvidence: (number, evidence, key = newIdempotencyKey()) => apiClient.post(`/claims/${encodeURIComponent(number)}/evidence`, evidence, { headers: { 'Idempotency-Key': key } }),
};

export const ncd = {
  rules: () => apiClient.get('/ncd/applications/rules'),
  submitEvidence: (id, payload, key) => apiClient.post(`/ncd/applications/${id}/evidence`, payload, key ? { headers: { 'Idempotency-Key': key } } : undefined),
  apply: (application, key) => apiClient.post('/ncd/applications', application, key ? { headers: { 'Idempotency-Key': key } } : undefined),
  listMine: () => apiClient.get('/ncd/applications'),
  validateCode: (payload) => apiClient.post('/ncd/codes/validate', payload),
  listForInsurer: () => apiClient.get('/insurer/ncd/applications'),
  decide: (id, status, note = '', verificationRevision = 0, key) => apiClient.post(`/insurer/ncd/applications/${id}/decision`, { status, note, verificationRevision }, key ? { headers: { 'Idempotency-Key': key } } : undefined),
};

export const inspections = {
  request: (inspection) => apiClient.post('/inspections', inspection),
  list: () => apiClient.get('/inspections'),
  update: (id, changes) => apiClient.patch(`/inspections/${id}`, changes),
  // The insurer's side: the inspections it carries out, and each step it records.
  listForInsurer: () => apiClient.get('/insurer/inspections'),
  schedule: (id, booking) => apiClient.post(`/insurer/inspections/${encodeURIComponent(id)}/schedule`, booking),
  assignInspector: (id, inspector) => apiClient.post(`/insurer/inspections/${encodeURIComponent(id)}/inspector`, inspector),
  approve: (id) => apiClient.post(`/insurer/inspections/${encodeURIComponent(id)}/approve`),
  fail: (id, reason) => apiClient.post(`/insurer/inspections/${encodeURIComponent(id)}/fail`, { reason }),
  noShow: (id, reason) => apiClient.post(`/insurer/inspections/${encodeURIComponent(id)}/no-show`, { reason }),
  cancel: (id, reason) => apiClient.post(`/insurer/inspections/${encodeURIComponent(id)}/cancel`, { reason }),
};

export const config = {
  getPia: () => apiClient.get('/config/pia'),
  setPia: (piaConfig) => apiClient.put('/config/pia', piaConfig),
};

/**
 * Delivery metadata for the integration operations views. These endpoints
 * intentionally never return provider URLs, request bodies, or credentials.
 */
export const integrations = {
  list: () => apiClient.get('/integrations/deliveries'),
  manualFallback: (id, note) => apiClient.post(`/integrations/deliveries/${encodeURIComponent(id)}/manual-fallback`, { note }),
  listForInsurer: () => apiClient.get('/insurer/integrations/deliveries'),
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
  reconciliation: {
    list: (query = {}) => apiClient.get('/admin/reconciliation/items', { params: query }),
    assign: (id, staffId) => apiClient.post(`/admin/reconciliation/items/${encodeURIComponent(id)}/assign`, { staffId }),
    resolve: (id, outcome, note) => apiClient.post(`/admin/reconciliation/items/${encodeURIComponent(id)}/resolve`, { outcome, note }),
    proposeRefund: (transactionId, refund) => apiClient.post(`/admin/payments/${encodeURIComponent(transactionId)}/refunds`, refund),
    proposeAdjustment: (adjustment) => apiClient.post('/admin/money-adjustments', adjustment),
    importStatement: (statement) => apiClient.post('/admin/reconciliation/statements', statement),
    listStatements: () => apiClient.get('/admin/reconciliation/statements'),
    standInStatement: (from, to) => apiClient.get('/admin/reconciliation/stand-in-statement', { params: { from, to }, responseType: 'text' }),
  },
  settlements: {
    list: (insurerId) => apiClient.get('/admin/settlements', { params: insurerId ? { insurerId } : {} }),
    draft: (insurerId, period) => apiClient.post('/admin/settlements', { insurerId, period }),
    get: (id) => apiClient.get(`/admin/settlements/${encodeURIComponent(id)}`),
    finalise: (id, reason) => apiClient.post(`/admin/settlements/${encodeURIComponent(id)}/finalise`, { reason }),
    exportCsv: (id) => apiClient.get(`/admin/settlements/${encodeURIComponent(id)}/export`, { responseType: 'text' }),
  },
};

/** What an insurer is paid: its own finalised settlements. */
export const settlements = {
  listForInsurer: () => apiClient.get('/insurer/settlements'),
  getForInsurer: (id) => apiClient.get(`/insurer/settlements/${encodeURIComponent(id)}`),
  exportCsv: (id) => apiClient.get(`/insurer/settlements/${encodeURIComponent(id)}/export`, { responseType: 'text' }),
};

/**
 * Service requests about a policy the customer holds. Files are uploaded first
 * and attached by id, like every other document.
 */
const attach = async (files = [], uploaded) => {
  const ids = [];
  for (const file of files) {
    let id = uploaded?.get(file);
    if (!id) {
      id = await uploadedDocumentId(file, 'document', 'SERVICE_REQUEST_DOCUMENT');
      uploaded?.set(file, id);
    }
    ids.push(id);
  }
  return ids;
};
const serviceRequestPath = (reference) => `/service-requests/${encodeURIComponent(reference)}`;
const insurerServiceRequestPath = (reference) => `/insurer/service-requests/${encodeURIComponent(reference)}`;

export const serviceRequests = {
  submit: async ({ files, ...request }, { key = newIdempotencyKey(), uploaded } = {}) =>
    apiClient.post('/service-requests', { ...request, documentIds: await attach(files, uploaded) }, { headers: { 'Idempotency-Key': key } }),
  listMine: () => apiClient.get('/service-requests'),
  get: (reference) => apiClient.get(serviceRequestPath(reference)),
  reply: async (reference, { message, files }) => apiClient.post(`${serviceRequestPath(reference)}/reply`, { message, documentIds: await attach(files) }),
  withdraw: (reference, reason) => apiClient.post(`${serviceRequestPath(reference)}/withdraw`, reason ? { reason } : {}),
  insurer: {
    list: (status) => apiClient.get('/insurer/service-requests', { params: status ? { status } : {} }),
    get: (reference) => apiClient.get(insurerServiceRequestPath(reference)),
    review: (reference) => apiClient.post(`${insurerServiceRequestPath(reference)}/review`),
    requestInformation: (reference, message) => apiClient.post(`${insurerServiceRequestPath(reference)}/information-requests`, { message }),
    postUpdate: async (reference, { message, visibleToCustomer, files }) =>
      apiClient.post(`${insurerServiceRequestPath(reference)}/updates`, { message, visibleToCustomer, documentIds: await attach(files) }),
    decline: (reference, reason) => apiClient.post(`${insurerServiceRequestPath(reference)}/decline`, { reason }),
    approve: (reference, decision) => apiClient.post(`${insurerServiceRequestPath(reference)}/approve`, decision),
    complete: async (reference, { note, files }) => apiClient.post(`${insurerServiceRequestPath(reference)}/complete`, { note, documentIds: await attach(files) }),
  },
};

/** The hand-over to the external help desk, and the look-up its agents use. */
export const support = {
  contact: () => apiClient.get('/support/contact'),
  findRecord: (reference, reason) => apiClient.get(`/admin/records/${encodeURIComponent(reference.trim())}`, { params: { reason } }),
};
