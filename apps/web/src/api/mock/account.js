import { belongsToCustomer } from '@/store';

export function customerRecords(state) {
  if (!state.isAuthenticated || !state.customer) throw new Error('Sign in to access your account.');
  const own = belongsToCustomer(state.customer);
  return Object.fromEntries(['policies', 'quoteRequests', 'claims', 'ncdApplications', 'inspections', 'serviceRequests']
    .map((key) => [key, (state[key] || []).filter(own)]));
}

/** The prototype has embedded files rather than a document repository. */
export function accountDocuments(state) {
  const records = customerRecords(state);
  const found = new Map();
  const visit = (value) => {
    if (!value || typeof value !== 'object') return;
    if (value.visibleToCustomer === false) return;
    if (value.name && value.type && (value.id || value.dataUrl)) {
      const id = value.id || `embedded-${found.size}`;
      found.set(id, { id, name: value.name, type: value.type, size: value.size || 0,
        kind: value.kind || 'DOCUMENT', uploadedAt: value.uploadedAt || null,
        available: Boolean(value.dataUrl), downloadPath: null, ...(value.dataUrl ? { dataUrl: value.dataUrl } : {}) });
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(records);
  return [...found.values()];
}

export function exportAccount(state) {
  const records = customerRecords(state);
  // Export records, never the persisted store (which also contains demo passwords and staff state).
  const { fullName, email, phone } = state.customer;
  const clean = (value) => {
    if (Array.isArray(value)) return value.filter((item) => item?.visibleToCustomer !== false).map(clean);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !['password', 'paymentProof', 'reconciliationItemId', 'authorName', 'dataUrl'].includes(key))
      .map(([key, entry]) => [key, clean(entry)]));
  };
  return {
    exportedAt: new Date().toISOString(), profile: { fullName, email, phone },
    consents: state.consentRecord ? [state.consentRecord] : [],
    contactPreferences: { preferences: state.contactPreferences || [], marketingConsent: state.marketingConsent || false },
    vehicles: records.policies.map((policy) => policy.vehicleDetails).filter(Boolean),
    ...clean(records),
    payments: records.policies.filter((policy) => policy.paymentProof).map((policy) => ({
      policyNumber: policy.policyNumber, amount: policy.paymentProof.amount,
      status: policy.paymentProof.status, confirmedAt: policy.paymentProof.confirmedAt,
    })),
    notifications: [], documents: clean(accountDocuments(state)),
  };
}
