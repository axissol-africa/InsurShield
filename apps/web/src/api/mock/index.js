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
import { demoCoverGuides } from '@/domain/insurers';
import { wait } from '../shared';
import { documentToRecord } from '@/lib/files';

const state = () => useStore.getState();
const call = async (fn) => { await wait(env.mockLatencyMs); return fn(state()); };
const newReference = (prefix) => `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
const insurerNameById = (id) => state().insurersList.find((insurer) => insurer.id === id)?.name ?? '';
const mine = (records) => records.filter(belongsToCustomer(state().customer));
const insurerName = () => state().staffSession?.name;
const insurerIdForSession = () => state().staffSession?.insurerId
  ?? state().insurersList.find((insurer) => insurer.name === insurerName())?.id;
// The browser adapter stands in for the API during prototype demos. Production
// clients always receive this fee from the API configuration, never this value.
const MOCK_RTSA_ANNIVERSARY_FEE = 500;
const PRODUCT_STORAGE = 'insurshield.mock.products.v1';
const PRODUCT_COVER_TYPES = ['COMPREHENSIVE', 'THIRD_PARTY'];
const INSPECTION_RULES = ['NOT_REQUIRED', 'OPTIONAL', 'REQUIRED'];
const INSPECTION_TIMINGS = ['BEFORE_QUOTATION', 'BEFORE_PAYMENT', 'AFTER_PAYMENT'];
const INSPECTION_METHODS = ['SELF_CAPTURE', 'PHYSICAL'];
const PRODUCT_GUIDE_FIELDS = new Set([
  'planName', 'summary', 'coveredItems', 'exclusions', 'notifyWithinDays', 'howToNotify',
  'documentsRequired', 'claimsContact', 'settlementTime', 'territorialLimit', 'ncdAccepted', 'quoteValidityDays',
]);

const today = () => new Date().toISOString().slice(0, 10);
const productRecords = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(PRODUCT_STORAGE) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};
const saveProducts = (records) => localStorage.setItem(PRODUCT_STORAGE, JSON.stringify(records));
const productGuide = (guide = {}) => {
  const terms = { ...(guide || {}) };
  delete terms.coverType;
  return terms;
};

/**
 * Browser mode starts with one approved version for each existing demo guide.
 * Those records stay independent from the legacy guide field so Batch 12 can
 * move customer selection to this API without rewriting the old prototype.
 */
function seededProducts(s) {
  const existing = productRecords();
  if (existing.length) {
    // Product cover type was added after the first browser prototype. Derive
    // it once from historical version one instead of discarding a user's
    // drafts while upgrading their local demo state.
    const migrated = existing.map((product) => (
      product.coverType ? product : { ...product, coverType: product.versions?.[0]?.coverType || 'COMPREHENSIVE' }
    ));
    if (migrated.some((product, index) => product !== existing[index])) saveProducts(migrated);
    return migrated;
  }
  const createdAt = new Date().toISOString();
  const records = s.insurersList.flatMap((insurer) => {
    // Deliberately use the built-in demonstration seed, not a persisted
    // `insurer.coverGuides` value. A browser upgrade must never silently turn
    // an insurer's old editable guide into an approved product version.
    const guides = demoCoverGuides(insurer);
    return PRODUCT_COVER_TYPES.map((coverType) => {
      const inspectionRule = insurer.inspectionRules?.replaceAll(' ', '_') || 'NOT_REQUIRED';
      const guideType = coverType === 'THIRD_PARTY' ? 'ThirdParty' : 'Comprehensive';
      return {
      id: newReference('PROD'),
      insurerId: insurer.id,
      code: `${String(insurer.id).toUpperCase()}-${coverType === 'COMPREHENSIVE' ? 'COMP' : 'TP'}`,
      coverType,
      createdAt,
      updatedAt: createdAt,
      versions: [{
        id: newReference('PV'), versionNumber: 1, status: 'APPROVED',
        name: guides[guideType]?.planName || `${insurer.name} ${guideType}`,
        coverType, coverGuide: productGuide(guides[guideType]),
        inspection: {
          rule: inspectionRule,
          timing: inspectionRule === 'NOT_REQUIRED' ? null : insurer.timing?.replaceAll(' ', '_') || null,
          method: inspectionRule === 'NOT_REQUIRED' ? null : insurer.method?.replaceAll('-', '_') || null,
        },
        effectiveFrom: today(), effectiveUntil: null, submittedAt: createdAt, reviewedAt: createdAt,
        reviewComment: 'Initial prototype catalogue version.', withdrawnAt: null, withdrawalReason: null,
        createdAt, updatedAt: createdAt,
      }],
    }; });
  });
  saveProducts(records);
  return records;
}

const ownProducts = (s) => seededProducts(s).filter((product) => product.insurerId === insurerIdForSession());
const versionFor = (s, productId, versionId) => {
  const product = seededProducts(s).find((entry) => entry.id === productId);
  const version = product?.versions?.find((entry) => entry.id === versionId);
  return { product, version };
};
const toProduct = (product) => ({ ...product, versions: [...(product.versions || [])].sort((a, b) => b.versionNumber - a.versionNumber) });
const toAdminProduct = (s, product, version) => {
  const insurer = s.insurersList.find((entry) => entry.id === product.insurerId);
  return {
    insurer: { id: insurer?.id || product.insurerId, name: insurer?.name || 'Unknown insurer', tradingName: insurer?.tradingName || null, logoUrl: insurer?.logoUrl || null },
    product: { id: product.id, code: product.code, coverType: product.coverType }, ...version,
  };
};
const assertInsurerEditor = (s) => {
  if (s.staffSession?.role !== 'insurer' || !insurerIdForSession()) throw new Error('Sign in as an insurer administrator to manage products.');
};
const assertProductStanding = (s) => {
  const insurer = s.insurersList.find((entry) => entry.id === insurerIdForSession());
  // Browser mode has no evidence store. The production API additionally
  // verifies evidence and licence validity in the same database transaction.
  if (!insurer || (insurer.status && insurer.status !== 'Active')) {
    throw new Error('Only an active, verified insurer can manage product terms.');
  }
};
const assertProductInput = (input, existing = {}) => {
  const next = {
    name: input.name ?? existing.name,
    coverType: input.coverType ?? existing.coverType,
    coverGuide: input.coverGuide === undefined ? existing.coverGuide || {} : { ...(existing.coverGuide || {}), ...input.coverGuide },
    inspection: {
      rule: input.inspectionRule ?? existing.inspection?.rule,
      timing: input.inspectionRule === 'NOT_REQUIRED' ? null : input.inspectionTiming ?? existing.inspection?.timing ?? null,
      method: input.inspectionRule === 'NOT_REQUIRED' ? null : input.inspectionMethod ?? existing.inspection?.method ?? null,
    },
    effectiveFrom: input.effectiveFrom ?? existing.effectiveFrom,
    effectiveUntil: input.effectiveUntil === undefined ? existing.effectiveUntil ?? null : input.effectiveUntil || null,
  };
  if (typeof next.name !== 'string' || next.name.trim().length < 2 || next.name.trim().length > 120) throw new Error('Enter a product name between 2 and 120 characters.');
  if (!PRODUCT_COVER_TYPES.includes(next.coverType)) throw new Error('Choose a supported cover type.');
  if (!INSPECTION_RULES.includes(next.inspection.rule)) throw new Error('Choose whether an inspection is required.');
  if (next.inspection.rule !== 'NOT_REQUIRED' && (!INSPECTION_TIMINGS.includes(next.inspection.timing) || !INSPECTION_METHODS.includes(next.inspection.method))) {
    throw new Error('Choose both an inspection timing and method.');
  }
  const unknownGuideField = Object.keys(next.coverGuide || {}).find((key) => !PRODUCT_GUIDE_FIELDS.has(key));
  if (unknownGuideField) throw new Error(`“${unknownGuideField}” is not a supported cover-guide field.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next.effectiveFrom || '')) throw new Error('Choose an effective-from date.');
  if (next.effectiveUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(next.effectiveUntil) || next.effectiveUntil < next.effectiveFrom)) throw new Error('The end date cannot be before the start date.');
  return { ...next, name: next.name.trim() };
};
const completeProductGuide = (guide) => [
  'planName', 'summary', 'coveredItems', 'exclusions', 'notifyWithinDays', 'howToNotify', 'documentsRequired', 'claimsContact', 'settlementTime', 'territorialLimit', 'ncdAccepted', 'quoteValidityDays',
].every((key) => Array.isArray(guide?.[key]) ? guide[key].some(Boolean) : guide?.[key] !== '' && guide?.[key] !== undefined && guide?.[key] !== null);

// Versioned separately from the catalogue; only allowlisted proposal data is stored.
const APPROVAL_STORAGE = 'insurshield.mock.approvals.v1';
const approvalRecords = () => JSON.parse(localStorage.getItem(APPROVAL_STORAGE) || '[]').map((record) => (
  record.status === 'PENDING' && Date.parse(record.expiresAt) <= Date.now()
    ? { ...record, status: 'EXPIRED' } : record
));
const saveApprovals = (records) => localStorage.setItem(APPROVAL_STORAGE, JSON.stringify(records));
const approvalResponse = ({ payload, ...record }) => ({
  ...record,
  proposal: record.action === 'PIA_FLOOR_CHANGE' ? { piaRatePercentage: payload.piaRatePercentage }
    : record.action === 'INSURER_ACTIVATE' ? { effectiveFrom: payload.effectiveFrom, renewalDate: payload.renewalDate, conditions: payload.conditions }
      : record.action === 'INSURER_SUSPEND' ? { reason: payload.reason } : {},
});

function approvalActor(s, superOnly = false) {
  const session = s.staffSession;
  const role = session?.staffRole || session?.role;
  if (!['SUPER_ADMIN', 'ADMIN', 'admin'].includes(role) || (superOnly && role !== 'SUPER_ADMIN' && !session?.isSuperAdmin)) {
    throw new Error('Only an authorised administrator may review this action.');
  }
  let id = session.id || session.staffId || session.userId || session.email;
  // The existing prototype login creates this one demo account without an id.
  // Bind it consistently: signing out and back in must never create a checker.
  if (!id && session.role === 'admin' && session.name === 'Admin') {
    id = 'mock:admin@insurshield.zm';
    s.startStaffSession({ ...session, id });
  }
  if (!id) throw new Error('Sign in again to establish your reviewer identity.');
  return { id, name: session.name || id };
}

function proposeApproval(s, action, targetId, payload, requestedReason) {
  const actor = approvalActor(s, ['INSURER_DELETE', 'INSURER_RESTORE'].includes(action));
  if (action !== 'PIA_FLOOR_CHANGE' && !s.insurersList.some((entry) => entry.id === targetId)) throw new Error('Insurer was not found.');
  const reason = requestedReason?.trim();
  if (!reason) throw new Error('Explain why this high-risk action is needed.');
  const records = approvalRecords();
  if (records.some((entry) => entry.action === action && entry.targetId === targetId && entry.status === 'PENDING')) {
    throw new Error('An approval for this action is already waiting for review.');
  }
  const record = {
    id: newReference('APPROVAL'), action, targetType: action === 'PIA_FLOOR_CHANGE' ? 'SETTING' : 'INSURER', targetId,
    payload, requestedReason: reason, requestedByStaffId: actor.id, requestedByName: actor.name,
    status: 'PENDING', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    decidedByStaffId: null, decidedAt: null, decisionReason: null, executedAt: null,
  };
  saveApprovals([...records, record]);
  return approvalResponse(record);
}

function decideApproval(s, id, decision, approve) {
  const actor = approvalActor(s);
  const records = approvalRecords();
  const record = records.find((entry) => entry.id === id);
  if (!record) throw new Error('Approval request was not found.');
  if (record.status !== 'PENDING') throw new Error('This approval request is no longer pending or has expired.');
  if (record.requestedByStaffId === actor.id) throw new Error('A different authorised administrator must review this request.');
  if (decision.reason !== undefined && (typeof decision.reason !== 'string' || decision.reason.length > 2000)) throw new Error('Decision reason must be at most 2000 characters.');
  if (approve) executeApproval(s, record);
  const now = new Date().toISOString();
  const result = { ...record, status: approve ? 'EXECUTED' : 'REJECTED', decidedByStaffId: actor.id, decisionReason: decision.reason?.trim() || null, decidedAt: now, executedAt: approve ? now : null };
  saveApprovals(records.map((entry) => entry.id === id ? result : entry));
  return approvalResponse(result);
}

function executeApproval(s, record) {
  const { action, targetId: id, payload } = record;
  if (action === 'PIA_FLOOR_CHANGE') {
    s.setPiaConfig({ piaRatePercentage: payload.piaRatePercentage });
    return;
  }
  const insurer = s.insurersList.find((entry) => entry.id === id);
  if (!insurer) throw new Error('Insurer was not found.');
  if (['INSURER_DELETE', 'INSURER_RESTORE'].includes(action)) approvalActor(s, true);
  if (action === 'INSURER_RESTORE') {
    if (insurer.status !== 'Deleted') throw new Error('This insurer has not been deleted.');
    s.updateInsurer(id, { status: 'Inactive', deletedAt: null });
    return;
  }
  if (insurer.status === 'Deleted') throw new Error('Restore this insurer before changing its status.');
  switch (action) {
    case 'INSURER_ACTIVATE': {
      const licence = insurer.evidence?.find((item) => item.kind === 'LICENCE');
      if (!licence || licence.state !== 'APPROVED') throw new Error('This insurer cannot be activated yet: no approved licence is on file.');
      if (licence.expiresAt && Date.parse(licence.expiresAt) < Date.now()) throw new Error('This insurer cannot be activated yet: the licence has expired.');
      s.updateInsurer(id, { status: 'Active', activation: { ...payload, approvedAt: new Date().toISOString() } });
      break;
    }
    case 'INSURER_DEACTIVATE': s.setInsurerStatus(id, 'Inactive'); break;
    case 'INSURER_DELETE': s.deleteInsurer(id); break;
    case 'INSURER_SUSPEND': {
      const unavailableAt = new Date().toISOString();
      s.updateInsurer(id, { status: 'Suspended', suspensionReason: payload.reason, suspendedAt: unavailableAt });
      s.setQuoteRequests(s.quoteRequests.map((request) => {
        if (!request.insurers?.includes(insurer.name)) return request;
        const reply = request.insurerQuotes?.[insurer.name];
        if (reply) return { ...request, insurerQuotes: { ...request.insurerQuotes, [insurer.name]: { ...reply, unavailableAt } } };
        const unavailableInsurers = request.unavailableInsurers || [];
        return unavailableInsurers.some((entry) => entry.name === insurer.name) ? request
          : { ...request, unavailableInsurers: [...unavailableInsurers, { name: insurer.name, unavailableAt }] };
      }));
      break;
    }
    default: throw new Error('This approval action cannot be executed.');
  }
}

export const auth = {
  register: (account) => call((s) => {
    s.registerCustomerAccount(account);
    return { signedIn: true, userId: `mock:${s.customer.email}`, customer: s.customer };
  }),
  signIn: (identifier, password) => call((s) => {
    if (identifier.startsWith('insurer@') || identifier.startsWith('admin@')) {
      const role = identifier.startsWith('insurer@') ? 'insurer' : 'admin';
      const staffSession = {
        id: `mock:${identifier.toLowerCase()}`,
        role,
        // The production identity endpoint keeps this canonical role beside
        // the short portal-routing role. It lets the UI avoid presenting
        // staff-management controls to an ordinary insurer officer.
        staffRole: role === 'insurer' ? 'INSURER_ADMIN' : 'SUPER_ADMIN',
        name: role === 'insurer' ? 'Prestige Assurance' : 'Admin',
        isSuperAdmin: role === 'admin',
      };
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
    userId: s.staffSession ? s.staffSession.id : (s.customer ? `mock:${s.customer.email}` : null),
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
  create: (insurer) => call((s) => {
    // A fresh insurer is a review record, never an active trading partner.
    s.addInsurer({ ...insurer, status: 'Pending' });
    return state().insurersList.at(-1);
  }),
  update: (id, updates) => call((s) => { s.updateInsurer(id, updates); return state().insurersList.find((i) => i.id === id); }),
  setStatus: (id, status) => call((s) => {
    if (!['Inactive', 'Deleted'].includes(status)) throw new Error('Use the evidence review to request activation.');
    return proposeApproval(s, status === 'Deleted' ? 'INSURER_DELETE' : 'INSURER_DEACTIVATE', id, {}, status === 'Deleted' ? 'Remove insurer from the platform.' : 'Deactivate insurer for new business.');
  }),
  suspend: (id, reason) => call((s) => {
    if (typeof reason !== 'string' || reason.trim().length < 3 || reason.length > 1000) throw new Error('Provide a suspension reason between 3 and 1000 characters.');
    return proposeApproval(s, 'INSURER_SUSPEND', id, { reason: reason.trim() }, reason);
  }),
  evidence: (id) => call((s) => s.insurersList.find((entry) => entry.id === id)?.evidence || []),
  captureEvidence: (id, evidence) => call((s) => {
    const insurer = s.insurersList.find((entry) => entry.id === id);
    if (!insurer) throw new Error('Insurer was not found.');
    const item = { id: newReference('EVIDENCE'), ...evidence, state: 'PENDING', reviewedBy: null, reviewedAt: null, note: null, capturedAt: new Date().toISOString() };
    s.updateInsurer(id, { evidence: [...(insurer.evidence || []), item] });
    return item;
  }),
  reviewEvidence: (id, evidenceId, review) => call((s) => {
    const insurer = s.insurersList.find((entry) => entry.id === id);
    const evidence = insurer?.evidence?.find((entry) => entry.id === evidenceId);
    if (!insurer || !evidence) throw new Error('Evidence was not found.');
    const reviewed = { ...evidence, ...review, reviewedAt: new Date().toISOString(), reviewedBy: s.staffSession?.name || 'Administrator' };
    s.updateInsurer(id, { evidence: insurer.evidence.map((entry) => entry.id === evidenceId ? reviewed : entry) });
    return reviewed;
  }),
  integration: (id) => call((s) => s.insurersList.find((entry) => entry.id === id)?.integration || null),
  setIntegration: (id, model) => call((s) => {
    if (!s.insurersList.some((entry) => entry.id === id)) throw new Error('Insurer was not found.');
    const integration = { ...model, activatedAt: new Date().toISOString() };
    s.updateInsurer(id, { integration });
    return integration;
  }),
  activate: (id, approval) => call((s) => {
    if (!approval?.effectiveFrom || !Number.isFinite(Date.parse(approval.effectiveFrom))) throw new Error('Provide a valid activation date.');
    return proposeApproval(s, 'INSURER_ACTIVATE', id, { effectiveFrom: approval.effectiveFrom, renewalDate: approval.renewalDate || null, conditions: approval.conditions || null }, approval.conditions || 'Activate insurer after evidence review.');
  }),
  remove: (id) => call((s) => proposeApproval(s, 'INSURER_DELETE', id, {}, 'Remove insurer from the platform.')),
  restore: (id) => call((s) => proposeApproval(s, 'INSURER_RESTORE', id, {}, 'Restore the deleted insurer as inactive.')),
  directory: () => call((s) => s.insurersList.filter((insurer) => !insurer.status || insurer.status === 'Active')),
};

/**
 * A faithful browser-storage version of the product workflow. It is separate
 * from `insurers.coverGuides`: the latter remains the existing B12 customer
 * prototype until customer product selection is moved to this API.
 */
export const products = {
  insurer: {
    list: () => call((s) => {
      assertInsurerEditor(s);
      return ownProducts(s).map(toProduct);
    }),
    get: (productId) => call((s) => {
      assertInsurerEditor(s);
      const product = ownProducts(s).find((entry) => entry.id === productId);
      if (!product) throw new Error('Product was not found.');
      return toProduct(product);
    }),
    create: (input) => call((s) => {
      assertInsurerEditor(s);
      assertProductStanding(s);
      const code = String(input?.code || '').trim().toUpperCase();
      if (!/^[A-Z0-9][A-Z0-9_-]{1,79}$/.test(code)) throw new Error('Use 2–80 uppercase letters, numbers, hyphens or underscores for the product code.');
      const records = seededProducts(s);
      const insurerId = insurerIdForSession();
      if (records.some((entry) => entry.insurerId === insurerId && entry.code === code)) throw new Error('This insurer already uses that product code.');
      const model = assertProductInput(input);
      const now = new Date().toISOString();
      const product = {
        id: newReference('PROD'), insurerId, code, coverType: model.coverType, createdAt: now, updatedAt: now,
        versions: [{
          id: newReference('PV'), versionNumber: 1, status: 'DRAFT',
          ...model, submittedAt: null, reviewedAt: null, reviewComment: null,
          withdrawnAt: null, withdrawalReason: null, createdAt: now, updatedAt: now,
        }],
      };
      saveProducts([...records, product]);
      return { product: { id: product.id, code: product.code, coverType: product.coverType }, ...product.versions[0] };
    }),
    updateDraft: (productId, versionId, input) => call((s) => {
      assertInsurerEditor(s);
      assertProductStanding(s);
      const records = seededProducts(s);
      const { product, version } = versionFor(s, productId, versionId);
      if (!product || product.insurerId !== insurerIdForSession() || !version) throw new Error('Product version was not found.');
      if (version.status !== 'DRAFT') throw new Error('Create a new draft to change a submitted or reviewed product version.');
      if (input.coverType !== undefined) throw new Error('Cover type is fixed for this product. Create a new product for a different cover type.');
      const model = assertProductInput(input, version);
      const now = new Date().toISOString();
      const updated = { ...version, ...model, updatedAt: now };
      const next = records.map((entry) => entry.id === productId
        ? { ...entry, updatedAt: now, versions: entry.versions.map((item) => item.id === versionId ? updated : item) }
        : entry);
      saveProducts(next);
      return { product: { id: product.id, code: product.code, coverType: product.coverType }, ...updated };
    }),
    revise: (productId, versionId) => call((s) => {
      assertInsurerEditor(s);
      assertProductStanding(s);
      const records = seededProducts(s);
      const { product, version } = versionFor(s, productId, versionId);
      if (!product || product.insurerId !== insurerIdForSession() || !version) throw new Error('Product version was not found.');
      if (version.status === 'DRAFT') throw new Error('This version is already a draft; update it instead of creating a copy.');
      const now = new Date().toISOString();
      const draft = {
        ...version, id: newReference('PV'), versionNumber: Math.max(...product.versions.map((item) => item.versionNumber)) + 1,
        status: 'DRAFT', submittedAt: null, reviewedAt: null, reviewComment: null,
        withdrawnAt: null, withdrawalReason: null, createdAt: now, updatedAt: now,
      };
      saveProducts(records.map((entry) => entry.id === productId ? { ...entry, updatedAt: now, versions: [...entry.versions, draft] } : entry));
      return { product: { id: product.id, code: product.code, coverType: product.coverType }, ...draft };
    }),
    submit: (productId, versionId) => call((s) => {
      assertInsurerEditor(s);
      assertProductStanding(s);
      const records = seededProducts(s);
      const { product, version } = versionFor(s, productId, versionId);
      if (!product || product.insurerId !== insurerIdForSession() || !version) throw new Error('Product version was not found.');
      if (version.status !== 'DRAFT') throw new Error('Only a draft product version can be submitted for review.');
      if (!completeProductGuide(version.coverGuide)) throw new Error('Complete the cover guide before submitting this product for review.');
      const now = new Date().toISOString();
      const submitted = { ...version, status: 'SUBMITTED', submittedAt: now, updatedAt: now };
      saveProducts(records.map((entry) => entry.id === productId ? { ...entry, updatedAt: now, versions: entry.versions.map((item) => item.id === versionId ? submitted : item) } : entry));
      return { product: { id: product.id, code: product.code, coverType: product.coverType }, ...submitted };
    }),
  },
  admin: {
    list: ({ status } = {}) => call((s) => {
      approvalActor(s);
      const records = seededProducts(s).flatMap((product) => product.versions.map((version) => toAdminProduct(s, product, version)));
      return records.filter((record) => !status || record.status === status).sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    }),
    approve: (productId, versionId, decision = {}) => call((s) => {
      approvalActor(s);
      const records = seededProducts(s);
      const { product, version } = versionFor(s, productId, versionId);
      if (!product || !version) throw new Error('Product version was not found.');
      if (version.status !== 'SUBMITTED') throw new Error('Only a submitted product version can be approved.');
      const effectiveFrom = decision.effectiveFrom || version.effectiveFrom;
      const effectiveUntil = decision.effectiveUntil === undefined ? version.effectiveUntil : decision.effectiveUntil || null;
      if (effectiveUntil && effectiveUntil < effectiveFrom) throw new Error('The end date cannot be before the start date.');
      const now = new Date().toISOString();
      const approved = { ...version, status: 'APPROVED', effectiveFrom, effectiveUntil, reviewedAt: now, reviewComment: decision.comment?.trim() || null, updatedAt: now };
      saveProducts(records.map((entry) => entry.id === productId ? { ...entry, updatedAt: now, versions: entry.versions.map((item) => item.id === versionId ? approved : item) } : entry));
      return toAdminProduct(s, product, approved);
    }),
    reject: (productId, versionId, decision = {}) => call((s) => {
      approvalActor(s);
      const comment = String(decision.comment || '').trim();
      if (comment.length < 3) throw new Error('Explain what the insurer must correct before rejecting this version.');
      const records = seededProducts(s);
      const { product, version } = versionFor(s, productId, versionId);
      if (!product || !version || version.status !== 'SUBMITTED') throw new Error('Only a submitted product version can be rejected.');
      const now = new Date().toISOString();
      const rejected = { ...version, status: 'REJECTED', reviewedAt: now, reviewComment: comment, updatedAt: now };
      saveProducts(records.map((entry) => entry.id === productId ? { ...entry, updatedAt: now, versions: entry.versions.map((item) => item.id === versionId ? rejected : item) } : entry));
      return toAdminProduct(s, product, rejected);
    }),
    withdraw: (productId, versionId, decision = {}) => call((s) => {
      approvalActor(s);
      const reason = String(decision.reason || '').trim();
      if (reason.length < 3) throw new Error('Give a withdrawal reason.');
      const records = seededProducts(s);
      const { product, version } = versionFor(s, productId, versionId);
      if (!product || !version || version.status !== 'APPROVED') throw new Error('Only an approved product version can be withdrawn.');
      const now = new Date().toISOString();
      const withdrawn = { ...version, status: 'WITHDRAWN', withdrawnAt: now, withdrawalReason: reason, updatedAt: now };
      saveProducts(records.map((entry) => entry.id === productId ? { ...entry, updatedAt: now, versions: entry.versions.map((item) => item.id === versionId ? withdrawn : item) } : entry));
      return toAdminProduct(s, product, withdrawn);
    }),
  },
  directory: ({ coverType, limit = 100 } = {}) => call((s) => seededProducts(s)
    .flatMap((product) => product.versions.map((version) => ({ product, version })))
    .filter(({ product, version }) => {
      const insurer = s.insurersList.find((entry) => entry.id === product.insurerId);
      return version.status === 'APPROVED' && (!coverType || version.coverType === coverType)
        && (!insurer?.status || insurer.status === 'Active')
        && version.effectiveFrom <= today() && (!version.effectiveUntil || version.effectiveUntil >= today());
    })
    .slice(0, Math.max(1, Math.min(Number(limit) || 100, 100)))
    .map(({ product, version }) => {
      const insurer = s.insurersList.find((entry) => entry.id === product.insurerId);
      return {
        insurer: { id: insurer?.id || product.insurerId, name: insurer?.name || 'Unknown insurer', tradingName: insurer?.tradingName || null, logoUrl: insurer?.logoUrl || null },
        product: { id: product.id, code: product.code, coverType: product.coverType },
        version: {
          id: version.id, number: version.versionNumber, name: version.name, coverType: version.coverType,
          coverGuide: version.coverGuide, inspection: version.inspection,
          effectiveFrom: version.effectiveFrom, effectiveUntil: version.effectiveUntil,
        },
      };
    })),
};

export const staff = {
  listUsers: () => call((s) => {
    const insurerId = insurerIdForSession();
    return s.staffSession?.role === 'insurer' ? s.staffUsers.filter((user) => user.insurerId === insurerId) : s.staffUsers;
  }),
  createUser: (user) => call((s) => {
    const insurerId = s.staffSession?.role === 'insurer' ? insurerIdForSession() : user.insurerId;
    const insurer = s.insurersList.find((entry) => entry.id === insurerId);
    if (s.staffUsers.some((entry) => entry.email.toLowerCase() === user.email.toLowerCase())) throw new Error('A staff member already uses that email address.');
    if (s.staffSession?.role === 'insurer' && !String(user.role || '').startsWith('INSURER_') && !['QUOTE_OFFICER', 'CLAIMS_OFFICER', 'SUPPORT', 'FINANCE', 'COMPLIANCE_READ_ONLY'].includes(user.role)) {
      throw new Error('An insurer administrator may assign only insurer roles.');
    }
    const team = s.staffTeams.find((entry) => entry.id === user.teamId);
    if (team && team.insurerId !== insurerId) throw new Error('Choose a team belonging to the same insurer.');
    const created = {
      id: newReference('STAFF'), fullName: user.fullName, email: user.email, role: user.role, insurerId: insurerId || null,
      insurerName: insurer?.name || null, isActive: true, team: team ? { id: team.id, name: team.name } : null, lastLoginAt: null, createdAt: new Date().toISOString(),
    };
    s.addStaffUser(created);
    return created;
  }),
  updateUser: (id, changes) => call((s) => {
    const target = s.staffUsers.find((entry) => entry.id === id);
    const insurerId = s.staffSession?.role === 'insurer' ? insurerIdForSession() : (changes.insurerId === undefined ? target?.insurerId : changes.insurerId);
    if (!target || (s.staffSession?.role === 'insurer' && target.insurerId !== insurerId)) throw new Error('Staff member was not found.');
    const insurer = s.insurersList.find((entry) => entry.id === insurerId);
    const team = changes.teamId === undefined ? target.team : s.staffTeams.find((entry) => entry.id === changes.teamId);
    if (team && team.insurerId !== insurerId) throw new Error('Choose a team belonging to the same insurer.');
    const updated = { ...target, ...changes, insurerId: insurerId || null, insurerName: insurer?.name || null, team: team ? { id: team.id, name: team.name } : null };
    delete updated.teamId;
    s.updateStaffUser(id, updated);
    return updated;
  }),
  resendInvitation: (id) => call((s) => {
    if (!s.staffUsers.some((entry) => entry.id === id)) throw new Error('Staff member was not found.');
    return { id, invitationSent: true };
  }),
  listTeams: () => call((s) => {
    const insurerId = insurerIdForSession();
    return s.staffSession?.role === 'insurer' ? s.staffTeams.filter((team) => team.insurerId === insurerId) : s.staffTeams;
  }),
  createTeam: (team) => call((s) => {
    const insurerId = s.staffSession?.role === 'insurer' ? insurerIdForSession() : team.insurerId;
    const insurer = s.insurersList.find((entry) => entry.id === insurerId);
    if (!insurer) throw new Error('Choose the insurer this team belongs to.');
    if (s.staffTeams.some((entry) => entry.insurerId === insurerId && entry.name.toLowerCase() === team.name.trim().toLowerCase())) throw new Error('A team with this name already exists for the insurer.');
    const created = { id: newReference('TEAM'), insurerId, insurerName: insurer.name, name: team.name.trim(), createdAt: new Date().toISOString() };
    s.addStaffTeam(created);
    return created;
  }),
  updateTeam: (id, changes) => call((s) => {
    const team = s.staffTeams.find((entry) => entry.id === id);
    if (!team || (s.staffSession?.role === 'insurer' && team.insurerId !== insurerIdForSession())) throw new Error('Team was not found.');
    s.updateStaffTeam(id, { name: changes.name.trim() });
    return { ...team, name: changes.name.trim() };
  }),
  removeTeam: (id) => call((s) => {
    const team = s.staffTeams.find((entry) => entry.id === id);
    if (!team || (s.staffSession?.role === 'insurer' && team.insurerId !== insurerIdForSession())) throw new Error('Team was not found.');
    if (s.staffUsers.some((user) => user.team?.id === id)) throw new Error('Move every staff member before deleting this team.');
    s.removeStaffTeam(id);
    return { id, deleted: true };
  }),
};

export const payments = {
  /** Simulated gateway round-trip: always confirms. */
  pay: ({ amount, method, quoteRequestId }) => call((s) => {
    const request = s.quoteRequests.find((item) => item.id === quoteRequestId);
    const selectedName = s.selectedQuote?.name;
    const reply = selectedName && request?.insurerQuotes?.[selectedName];
    if (reply?.unavailableAt || request?.unavailableInsurers?.some((entry) => entry.name === selectedName)) {
      throw new Error('This quotation is no longer available for payment. Request a fresh quote from an available insurer.');
    }
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
  setPia: ({ piaRatePercentage }) => call((s) => {
    if (!Number.isFinite(piaRatePercentage) || piaRatePercentage < 0 || piaRatePercentage > 100) throw new Error('Provide a valid PIA percentage between 0 and 100.');
    return proposeApproval(s, 'PIA_FLOOR_CHANGE', 'pia.minimum_rate_bps', { piaRatePercentage }, 'Update the PIA minimum rate.');
  }),
};

/**
 * Browser-storage equivalent of the protected administrator read endpoints.
 * It keeps prototype mode useful while HTTP mode always reads these figures
 * from the API rather than reusing persisted demo records.
 */
export const admin = {
  approvals: {
    list: () => call((s) => { approvalActor(s); return approvalRecords().map(approvalResponse); }),
    approve: (id, decision = {}) => call((s) => decideApproval(s, id, decision, true)),
    reject: (id, decision = {}) => call((s) => decideApproval(s, id, decision, false)),
  },
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
  requestCustomerPasswordReset: ({ customerId, confirmationEmail, reason }) => call((s) => {
    approvalActor(s);
    const account = s.registeredAccounts.find((item) => (item.id || item.email) === customerId);
    if (!account) throw new Error('Customer account was not found.');
    if (account.email.toLowerCase() !== String(confirmationEmail || '').trim().toLowerCase()) {
      throw new Error('Re-enter the customer email address exactly before requesting a reset.');
    }
    if (typeof reason !== 'string' || reason.trim().length < 10) {
      throw new Error('Enter a short reason of at least 10 characters.');
    }
    // Browser-storage mode never creates a token or reveals one. The live API
    // records the attempt and asks the configured mail provider to send it.
    return { id: newReference('RESET'), deliveryStatus: 'DELIVERED', requestedAt: new Date().toISOString() };
  }),
  // Audit history needs the server's append-only database. Prototype mode
  // states that boundary plainly rather than inventing compliance records.
  auditLogs: () => call(() => ({ items: [], nextCursor: null })),
};
