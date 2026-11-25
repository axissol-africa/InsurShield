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
import { newIdempotencyKey, wait } from '../shared';
import { documentToRecord } from '@/lib/files';
import { canAskCustomer, canDecline, CUSTOMER_STATUS_LABELS, openQuestion, PROTOTYPE_DECLINE_REASONS } from '@/domain/quoteWorkflow';

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
const RULE_SETTINGS_STORAGE = 'insurshield.mock.rule-settings.v1';
const TAXONOMY_STORAGE = 'insurshield.mock.comparison-taxonomy.v1';
const INTEGRATION_DELIVERIES_STORAGE = 'insurshield.mock.integration-deliveries.v1';
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
const ruleRecords = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(RULE_SETTINGS_STORAGE) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};
const saveRules = (records) => localStorage.setItem(RULE_SETTINGS_STORAGE, JSON.stringify(records));
const integrationDeliveries = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(INTEGRATION_DELIVERIES_STORAGE) || '[]');
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};
const saveIntegrationDeliveries = (records) => localStorage.setItem(INTEGRATION_DELIVERIES_STORAGE, JSON.stringify(records));
const defaultTaxonomy = () => [
  { id: 'mock-taxonomy-third-party', code: 'THIRD_PARTY_DAMAGE', label: 'Third-party property damage', description: 'Damage to someone else’s property.', category: 'COVERAGE', versionNumber: 1, dataType: 'BOOLEAN', unit: null, allowedValues: [], displayRule: 'ALWAYS_SHOW', status: 'ACTIVE', displayOrder: 10 },
  { id: 'mock-taxonomy-medical-limit', code: 'MEDICAL_LIMIT', label: 'Medical expenses limit', description: 'Maximum medical benefit per claim.', category: 'LIMIT', versionNumber: 1, dataType: 'CURRENCY', unit: 'ZMW', allowedValues: [], displayRule: 'SHOW_WHEN_PROVIDED', status: 'ACTIVE', displayOrder: 20 },
  { id: 'mock-taxonomy-excess', code: 'EXCESS', label: 'Policy excess', description: 'Amount the customer contributes when claiming.', category: 'EXCESS', versionNumber: 1, dataType: 'CURRENCY', unit: 'ZMW', allowedValues: [], displayRule: 'ALWAYS_SHOW', status: 'ACTIVE', displayOrder: 30 },
  { id: 'mock-taxonomy-roadside', code: 'ROADSIDE_ASSISTANCE', label: 'Roadside assistance', description: 'Help available after a roadside breakdown.', category: 'ADD_ON', versionNumber: 1, dataType: 'BOOLEAN', unit: null, allowedValues: [], displayRule: 'SHOW_WHEN_PROVIDED', status: 'ACTIVE', displayOrder: 40 },
];
const taxonomyRecords = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(TAXONOMY_STORAGE) || 'null');
    if (Array.isArray(stored)) return stored;
  } catch {
    // Start clean below.
  }
  const initial = defaultTaxonomy().map((item) => ({ ...item, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }));
  localStorage.setItem(TAXONOMY_STORAGE, JSON.stringify(initial));
  return initial;
};
const saveTaxonomy = (records) => localStorage.setItem(TAXONOMY_STORAGE, JSON.stringify(records));
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
        rateBps: Math.round(Number(insurer.ratePercentage || 4.5) * 100),
        showEstimate: true,
        allowedDurations: ['Q1', 'Q2', 'Q3', 'Q4'],
        comparisonItems: [],
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
const publicProductDirectory = (s, { coverType, limit = 100 } = {}) => seededProducts(s)
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
        showEstimate: Boolean(version.showEstimate), allowedDurations: version.allowedDurations || ['Q1', 'Q2', 'Q3', 'Q4'],
        comparisonItems: version.comparisonItems || [],
        effectiveFrom: version.effectiveFrom, effectiveUntil: version.effectiveUntil,
      },
    };
  });
const selectedProductSnapshot = (product) => ({
  productVersionId: product.version.id,
  insurerId: product.insurer.id,
  insurerName: product.insurer.name,
  productCode: product.product.code,
  productVersionNumber: product.version.number,
  productName: product.version.name,
  coverType: product.version.coverType === 'THIRD_PARTY' ? 'ThirdParty' : 'Comprehensive',
  coverGuide: product.version.coverGuide,
  inspection: product.version.inspection,
  unavailableAt: null,
  status: product.version.inspection?.rule === 'REQUIRED' && product.version.inspection?.timing === 'BEFORE_QUOTATION'
    ? 'INSPECTION_REQUIRED'
    : 'SUBMITTED',
  statusLabel: product.version.inspection?.rule === 'REQUIRED' && product.version.inspection?.timing === 'BEFORE_QUOTATION'
    ? CUSTOMER_STATUS_LABELS.INSPECTION_REQUIRED
    : CUSTOMER_STATUS_LABELS.SUBMITTED,
  replyDueAt: null,
  decline: null,
  informationRequests: [],
});
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
    rateBps: input.rateBps ?? existing.rateBps ?? 450,
    showEstimate: input.showEstimate ?? existing.showEstimate ?? false,
    allowedDurations: input.allowedDurations ?? existing.allowedDurations ?? ['Q1', 'Q2', 'Q3', 'Q4'],
    comparisonItems: input.comparisonItems === undefined ? existing.comparisonItems || [] : normaliseComparisonItems(input.comparisonItems),
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
  if (!Number.isInteger(next.rateBps) || next.rateBps < 0 || next.rateBps > 10_000) throw new Error('Enter an annual rate from 0% to 100%.');
  if (!Array.isArray(next.allowedDurations) || next.allowedDurations.length === 0 || next.allowedDurations.some((duration) => !['Q1', 'Q2', 'Q3', 'Q4'].includes(duration))) throw new Error('Choose at least one available cover period.');
  return { ...next, name: next.name.trim() };
};
const normaliseComparisonItems = (items) => {
  if (!Array.isArray(items)) throw new Error('Comparison mappings must be a list.');
  const active = taxonomyRecords().filter((item) => item.status === 'ACTIVE');
  const byId = new Map(active.map((item) => [item.id, item]));
  const seen = new Set();
  return items.map((entry) => {
    const term = byId.get(entry?.taxonomyItemId);
    if (!term || seen.has(term.id)) throw new Error('Each comparison mapping must use an active platform term once.');
    seen.add(term.id);
    const valueText = String(entry.valueText || '').trim() || null;
    if ((term.dataType === 'NUMBER' || term.dataType === 'CURRENCY') && valueText && !/^\d+(?:\.\d{1,2})?$/.test(valueText)) throw new Error(`${term.label} needs a numeric value.`);
    if (term.dataType === 'BOOLEAN' && valueText && !/^(yes|no|true|false)$/i.test(valueText)) throw new Error(`${term.label} must be Yes or No.`);
    if (term.dataType === 'LIST' && valueText && !term.allowedValues.includes(valueText)) throw new Error(`${term.label} must use one of the allowed values.`);
    return { taxonomyItemId: term.id, taxonomyVersion: term.versionNumber, code: term.code, label: term.label, description: term.description, category: term.category, dataType: term.dataType, unit: term.unit, allowedValues: term.allowedValues, displayRule: term.displayRule, included: entry.included !== false, valueText };
  });
};
const completeProductGuide = (guide) => [
  'planName', 'summary', 'coveredItems', 'exclusions', 'notifyWithinDays', 'howToNotify', 'documentsRequired', 'claimsContact', 'settlementTime', 'territorialLimit', 'ncdAccepted', 'quoteValidityDays',
].every((key) => Array.isArray(guide?.[key]) ? guide[key].some(Boolean) : guide?.[key] !== '' && guide?.[key] !== undefined && guide?.[key] !== null);
const hasCompleteComparisonMappings = (version) => {
  const activeIds = taxonomyRecords().filter((item) => item.status === 'ACTIVE').map((item) => item.id);
  const mappedIds = new Set((version.comparisonItems || []).map((item) => item.taxonomyItemId));
  return activeIds.every((id) => mappedIds.has(id));
};

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
  submitRequest: ({ customer, policyDates, selectedProductVersionIds }) => call((s) => {
    const selectedIds = [...new Set(selectedProductVersionIds || [])];
    if (selectedIds.length < 1 || selectedIds.length > 5) {
      throw new Error('Choose one to five published insurance products.');
    }
    const available = publicProductDirectory(s);
    const selectedProducts = selectedIds.map((id) => available.find((product) => product.version.id === id)).filter(Boolean);
    if (selectedProducts.length !== selectedIds.length) {
      throw new Error('One or more selected products are no longer available. Reload the product list and try again.');
    }
    const rtsaAnniversaryFee = s.matchRtsaAnniversary ? MOCK_RTSA_ANNIVERSARY_FEE : 0;
    const id = s.submitQuoteRequest({
      customer,
      policyDates,
      rtsaAnniversaryFee,
      selectedProducts: selectedProducts.map(selectedProductSnapshot),
    });
    return state().quoteRequests.find((r) => r.id === id);
  }),
  listMine: () => call((s) => mine(s.quoteRequests)),
  get: (id) => call((s) => s.quoteRequests.find((r) => r.id === id) || null),
  requote: (id) => call((s) => ({ ok: s.requoteFromRequest(id) })),
  listForInsurer: () => call((s) => s.quoteRequests.filter((r) => r.insurers?.includes(insurerName()))),
  reply: (id, quote) => call((s) => { s.addInsurerQuote(id, insurerName(), quote); return state().quoteRequests.find((r) => r.id === id); }),
  extend: (id, extraDays, productVersionId) => call((s) => { s.extendInsurerQuote(id, insurerName(), extraDays, productVersionId); return state().quoteRequests.find((r) => r.id === id); }),
  declineReasons: () => call(() => PROTOTYPE_DECLINE_REASONS),
  decline: (id, productVersionId, { reasonCode, customerNote, internalNote }) => call((s) => {
    const product = ownSelectedProduct(s, id, productVersionId);
    if (!canDecline(product.status)) throw new Error('This product can no longer be declined.');
    const reason = PROTOTYPE_DECLINE_REASONS.find((candidate) => candidate.code === reasonCode);
    if (!reason) throw new Error('Choose one of the listed reasons for declining.');
    s.updateSelectedProduct(id, productVersionId, (current) => ({
      status: 'DECLINED',
      statusLabel: CUSTOMER_STATUS_LABELS.DECLINED,
      decline: { reason: reason.customerText, note: customerNote?.trim() || null },
      informationRequests: (current.informationRequests || []).map((asked) => ({ ...asked, open: false })),
    }));
    if (internalNote?.trim()) addPrototypeNote(s, id, productVersionId, internalNote.trim());
    return { productVersionId, status: 'DECLINED' };
  }),
  requestInformation: (id, productVersionId, { message, dueInDays }) => call((s) => {
    const product = ownSelectedProduct(s, id, productVersionId);
    if (product.status === 'VERIFICATION_REQUIRED') throw new Error('You have already asked the customer for information about this product. Wait for their answer.');
    if (!canAskCustomer(product.status)) throw new Error('This product can no longer be asked about.');
    const askedAt = new Date();
    const asked = { id: newReference('INFO'), message: message.trim(), dueAt: new Date(askedAt.getTime() + dueInDays * 86_400_000).toISOString(), askedAt: askedAt.toISOString(), answeredAt: null, answer: null, open: true };
    s.updateSelectedProduct(id, productVersionId, (current) => ({
      status: 'VERIFICATION_REQUIRED',
      statusLabel: CUSTOMER_STATUS_LABELS.VERIFICATION_REQUIRED,
      informationRequests: [...(current.informationRequests || []), asked],
    }));
    return { productVersionId, status: 'VERIFICATION_REQUIRED', informationRequest: asked };
  }),
  notes: (id, productVersionId) => call((s) => {
    ownSelectedProduct(s, id, productVersionId);
    return [...(prototypeNotes.get(`${id}~${productVersionId}`) || [])].reverse();
  }),
  addNote: (id, productVersionId, body) => call((s) => {
    ownSelectedProduct(s, id, productVersionId);
    if (!body?.trim()) throw new Error('Write the note before saving it.');
    return addPrototypeNote(s, id, productVersionId, body.trim());
  }),
  withdraw: (id, productVersionId, reason) => call((s) => {
    const product = ownSelectedProduct(s, id, productVersionId);
    const request = s.quoteRequests.find((entry) => entry.id === id);
    const quote = request.productQuotes?.find((entry) => entry.productVersionId === productVersionId);
    if (!quote) throw new Error('There is no current quote for this product to change.');
    if (request.selection?.insurerQuoteId === quote.id) throw new Error('The customer has chosen this quote. It can change only if they choose another.');
    if (!reason?.trim()) throw new Error('Say why you are withdrawing this quote.');
    s.removeProductQuote(id, productVersionId);
    s.updateSelectedProduct(id, productVersionId, () => ({ status: 'INSURER_PROCESSING', statusLabel: CUSTOMER_STATUS_LABELS.INSURER_PROCESSING }));
    return { productVersionId, status: product.status === 'QUOTED' ? 'INSURER_PROCESSING' : product.status };
  }),
  replace: (id, productVersionId, quote) => call((s) => {
    ownSelectedProduct(s, id, productVersionId);
    const request = s.quoteRequests.find((entry) => entry.id === id);
    const current = request.productQuotes?.find((entry) => entry.productVersionId === productVersionId);
    if (!current) throw new Error('There is no current quote for this product to change.');
    if (request.selection?.insurerQuoteId === current.id) throw new Error('The customer has chosen this quote. It can change only if they choose another.');
    s.addInsurerQuote(id, insurerName(), { ...quote, productVersionId });
    return state().quoteRequests.find((entry) => entry.id === id).productQuotes.find((entry) => entry.productVersionId === productVersionId);
  }),
  select: (id, insurerQuoteId, acceptedConditionCodes = [], addOnCodes = []) => call((s) => {
    const request = mine(s.quoteRequests).find((entry) => entry.id === id);
    const quote = request?.productQuotes?.find((entry) => entry.id === insurerQuoteId);
    if (!quote) throw new Error('This quote is no longer available. Reload your quotes.');
    const missing = (quote.conditions || []).filter((condition) => condition.purchaseCritical && !acceptedConditionCodes.includes(condition.code));
    if (missing.length) throw new Error('Accept every condition marked as required before choosing this quote.');
    const optional = (quote.addOns || []).filter((addOn) => !addOn.included).map((addOn) => addOn.code);
    if (addOnCodes.some((code) => !optional.includes(code))) throw new Error('Choose only optional extras this quote offers.');
    s.setQuoteSelection(id, { insurerQuoteId, acceptedConditionCodes, selectedAddOnCodes: addOnCodes, selectedAt: new Date().toISOString() });
    return state().quoteRequests.find((entry) => entry.id === id);
  }),
  claim: (id, productVersionId) => call((s) => {
    const product = ownSelectedProduct(s, id, productVersionId);
    const me = { id: s.staffSession?.id || 'prototype-staff', name: s.staffSession?.name || 'You' };
    if (product.owner && product.owner.id !== me.id) throw new Error('A colleague already owns this product. Ask your administrator to reassign it.');
    s.updateSelectedProduct(id, productVersionId, (current) => ({
      owner: me,
      ...(current.status === 'SUBMITTED' ? { status: 'INSURER_PROCESSING', statusLabel: CUSTOMER_STATUS_LABELS.INSURER_PROCESSING } : {}),
    }));
    return { productVersionId, ownerStaffId: me.id };
  }),
  assign: (id, productVersionId, staffId) => call((s) => {
    ownSelectedProduct(s, id, productVersionId);
    const member = staffId ? s.staffUsers.find((user) => user.id === staffId) : null;
    if (staffId && !member) throw new Error('Choose an active member of your quoting team.');
    s.updateSelectedProduct(id, productVersionId, () => ({ owner: member ? { id: member.id, name: member.fullName } : null }));
    return { productVersionId, ownerStaffId: staffId };
  }),
  setPriority: (id, productVersionId, priority) => call((s) => {
    ownSelectedProduct(s, id, productVersionId);
    s.updateSelectedProduct(id, productVersionId, () => ({ priority }));
    return { productVersionId, priority };
  }),
  answerInformation: (id, productVersionId, answer) => call((s) => {
    const request = mine(s.quoteRequests).find((entry) => entry.id === id);
    const product = request?.selectedProducts?.find((entry) => entry.productVersionId === productVersionId);
    if (!product) throw new Error('Quote request was not found.');
    if (!openQuestion(product)) throw new Error('The insurer is not waiting for an answer about this product.');
    if (!answer?.trim()) throw new Error('Write your answer before sending it.');
    const answeredAt = new Date().toISOString();
    s.updateSelectedProduct(id, productVersionId, (current) => ({
      status: 'INSURER_PROCESSING',
      statusLabel: CUSTOMER_STATUS_LABELS.INSURER_PROCESSING,
      informationRequests: current.informationRequests.map((asked) => (asked.open ? { ...asked, open: false, answer: answer.trim(), answeredAt } : asked)),
    }));
    return state().quoteRequests.find((entry) => entry.id === id);
  }),
};

/**
 * Internal notes exist only for this browser session in the prototype; the
 * API keeps them append-only and never shows them to a customer.
 */
const prototypeNotes = new Map();
const addPrototypeNote = (s, id, productVersionId, body) => {
  const key = `${id}~${productVersionId}`;
  const note = { id: newReference('NOTE'), body, author: s.staffSession?.name || null, createdAt: new Date().toISOString() };
  prototypeNotes.set(key, [...(prototypeNotes.get(key) || []), note]);
  return note;
};
const ownSelectedProduct = (s, id, productVersionId) => {
  const request = s.quoteRequests.find((entry) => entry.id === id && entry.insurers?.includes(insurerName()));
  const product = request?.selectedProducts?.find((entry) => entry.productVersionId === productVersionId && entry.insurerName === insurerName());
  if (!product) throw new Error('Quote request was not found.');
  return product;
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
    comparisonTaxonomy: () => call((s) => {
      assertInsurerEditor(s);
      return taxonomyRecords().filter((item) => item.status === 'ACTIVE').sort((first, second) => first.displayOrder - second.displayOrder);
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
      if (!hasCompleteComparisonMappings(version)) throw new Error('Map every active comparison term before submitting this product for review.');
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
  directory: (query = {}) => call((s) => publicProductDirectory(s, query)),
  estimate: (productId, versionId, input = {}) => call((s) => {
    const { product, version } = versionFor(s, productId, versionId);
    const insurer = product && s.insurersList.find((entry) => entry.id === product.insurerId);
    if (!product || !version || version.status !== 'APPROVED' || insurer?.status !== 'Active') throw new Error('Product version was not found.');
    if (!version.showEstimate) throw new Error('This insurer has not enabled an estimate for this product.');
    if (!version.allowedDurations?.includes(input.coverageDuration)) throw new Error('This product is not offered for the selected cover period.');
    const value = Number(input.vehicleValue);
    if (!Number.isFinite(value) || value <= 0) throw new Error('Enter a valid vehicle value for an estimate.');
    const loading = ({
      Individual: 1, 'Individual (Motorcycles)': 1.05, 'Commercial (Motorcycles)': 1.18,
      'Commercial (Cars for Hire)': 1.2, 'Commercial (Small Public Buses)': 1.25,
      'Commercial (Trucks, Horses & Trailers)': 1.22, 'Commercial (Taxis & Yangos)': 1.28,
    })[input.vehicleUsage] || 1;
    const quarters = { Q1: 1, Q2: 2, Q3: 3, Q4: 4 }[input.coverageDuration];
    const indicative = value * ((version.rateBps || 0) / 10_000) * loading * (quarters / 4);
    const floor = value * 0.04 * (quarters / 4);
    const floorApplied = indicative < floor;
    return {
      insurer: { id: insurer.id, name: insurer.name, tradingName: insurer.tradingName || null, logoUrl: insurer.logoUrl || null },
      product: { id: product.id, code: product.code, name: version.name, coverType: version.coverType },
      versionId: version.id, coverageDuration: input.coverageDuration, vehicleValue: value, vehicleUsage: input.vehicleUsage,
      estimatedPremium: Number(Math.max(indicative, floor).toFixed(2)), currency: 'ZMW', floorApplied, provisionalInputs: true,
      notice: 'This is an estimate. The insurer confirms the final premium after reviewing your request.',
    };
  }),
};

export const settings = {
  rules: {
    list: () => call((s) => { approvalActor(s); return ruleRecords().sort((first, second) => `${first.key}:${second.versionNumber}`.localeCompare(`${second.key}:${first.versionNumber}`)); }),
    history: (key) => call((s) => { approvalActor(s); return ruleRecords().filter((item) => item.key === key).sort((first, second) => second.versionNumber - first.versionNumber); }),
    create: (key, input = {}) => call((s) => {
      const actor = approvalActor(s);
      if (key === 'PIA_FLOOR') throw new Error('Use the PIA rate approval process for a minimum-rate change.');
      if (!input.value || typeof input.value !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom || '')) throw new Error('Enter a valid rule value and effective date.');
      const records = ruleRecords();
      const versionNumber = Math.max(0, ...records.filter((item) => item.key === key).map((item) => item.versionNumber)) + 1;
      const createdAt = new Date().toISOString();
      const record = { id: newReference('RULE'), key, versionNumber, state: 'PROVISIONAL', value: input.value, effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil || null, createdByStaffId: actor.id, confirmedByStaffId: null, confirmedAt: null, createdAt };
      saveRules([...records, record]);
      return record;
    }),
    confirm: (key, id) => call((s) => {
      const actor = approvalActor(s);
      if (key === 'PIA_FLOOR') throw new Error('Use the PIA rate approval process for a minimum-rate change.');
      const records = ruleRecords();
      const candidate = records.find((item) => item.id === id && item.key === key);
      if (!candidate || candidate.state !== 'PROVISIONAL') throw new Error('Only a provisional rule version can be confirmed.');
      const versionNumber = Math.max(0, ...records.filter((item) => item.key === key).map((item) => item.versionNumber)) + 1;
      const record = { ...candidate, id: newReference('RULE'), versionNumber, state: 'CONFIRMED', confirmedByStaffId: actor.id, confirmedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
      saveRules([...records, record]);
      return record;
    }),
  },
  taxonomy: {
    list: () => call((s) => { approvalActor(s); return taxonomyRecords().sort((first, second) => first.displayOrder - second.displayOrder); }),
    create: (input = {}) => call((s) => {
      approvalActor(s);
      const code = String(input.code || '').trim().toUpperCase();
      const label = String(input.label || '').trim();
      const dataType = String(input.dataType || 'TEXT');
      const allowedValues = Array.isArray(input.allowedValues) ? input.allowedValues.map((value) => String(value).trim()).filter(Boolean) : [];
      if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(code) || !label) throw new Error('Enter a valid comparison code and label.');
      if (!['TEXT', 'NUMBER', 'BOOLEAN', 'CURRENCY', 'LIST'].includes(dataType)) throw new Error('Choose a valid comparison value type.');
      if (dataType === 'LIST' && !allowedValues.length) throw new Error('Add allowed values for a list comparison field.');
      if (dataType !== 'LIST' && allowedValues.length) throw new Error('Allowed values are only used for a list comparison field.');
      const records = taxonomyRecords();
      if (records.some((item) => item.code === code)) throw new Error('That comparison code already exists.');
      const timestamp = new Date().toISOString();
      const item = { id: newReference('TERM'), code, label, description: String(input.description || '').trim() || null, category: input.category || 'COVERAGE', versionNumber: 1, dataType, unit: String(input.unit || '').trim() || null, allowedValues, displayRule: input.displayRule || 'SHOW_WHEN_PROVIDED', status: 'ACTIVE', displayOrder: Number.isInteger(input.displayOrder) ? input.displayOrder : 0, createdAt: timestamp, updatedAt: timestamp };
      saveTaxonomy([...records, item]);
      return item;
    }),
    update: (id, input = {}) => call((s) => {
      approvalActor(s);
      const records = taxonomyRecords();
      const item = records.find((entry) => entry.id === id);
      if (!item) throw new Error('Comparison taxonomy item was not found.');
      const allowedValues = input.allowedValues === undefined ? item.allowedValues : input.allowedValues.map((value) => String(value).trim()).filter(Boolean);
      const dataType = input.dataType || item.dataType;
      if (dataType === 'LIST' && !allowedValues.length) throw new Error('Add allowed values for a list comparison field.');
      if (dataType !== 'LIST' && allowedValues.length) throw new Error('Allowed values are only used for a list comparison field.');
      const updated = { ...item, ...input, unit: input.unit === undefined ? item.unit : String(input.unit || '').trim() || null, allowedValues, versionNumber: item.versionNumber + 1, updatedAt: new Date().toISOString() };
      saveTaxonomy(records.map((entry) => entry.id === id ? updated : entry));
      return updated;
    }),
  },
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

/**
 * The browser's stand-in for the payment provider, with the API stand-in's
 * test wallets: a number ending 0002 is declined, 0003 waits until its
 * deadline, anything else is confirmed on the first status check. A card
 * attempt is confirmed the same way, as if the customer finished checkout.
 */
const mockAttempts = new Map();
const MOCK_PENDING_MINUTES = 15;
const OPEN_STATUSES = ['Initiated', 'Pending'];
const FAILURE_WORDING = {
  Failed: 'The payment was declined. No money was taken.',
  Cancelled: 'The payment was cancelled. No money was taken.',
  Expired: 'The payment was not approved in time. No money was taken.',
};

/** What the API would answer: never the full wallet number or the key. */
const publicAttempt = (attempt) => {
  const answer = { ...attempt };
  delete answer.mobileNumber;
  delete answer.idempotencyKey;
  return answer;
};

function settleMockAttempt(s, attempt) {
  if (!OPEN_STATUSES.includes(attempt.status)) return attempt;
  const wallet = (attempt.mobileNumber || '').replaceAll(/\D/g, '');
  const overdue = Date.now() >= new Date(attempt.pendingUntil).getTime();
  let status = 'Confirmed';
  if (wallet.endsWith('0002')) status = 'Failed';
  else if (wallet.endsWith('0003')) status = overdue ? 'Expired' : 'Pending';
  if (status === 'Pending') return attempt;
  const settled = { ...attempt, status, failure: FAILURE_WORDING[status] ?? null, checkoutUrl: null };
  if (status === 'Confirmed') {
    settled.confirmedAt = new Date().toISOString();
    settled.policyNumber = `POL-${Date.now().toString(36).toUpperCase()}`;
    settled.policyStatus = 'Policy issuing';
    s.recordPayment(publicAttempt(settled));
  }
  return settled;
}

export const payments = {
  pay: ({ amount, method, quoteRequestId, insurerQuoteId, mobileNumber }, idempotencyKey = newIdempotencyKey()) => call((s) => {
    const replayed = [...mockAttempts.values()].find((attempt) => attempt.idempotencyKey === idempotencyKey);
    if (replayed) return publicAttempt(replayed);
    const request = s.quoteRequests.find((item) => item.id === quoteRequestId);
    if (!request || !insurerQuoteId) {
      throw new Error('This quote needs to be refreshed before payment.');
    }
    const productQuote = request.productQuotes?.find((quote) => quote.id === insurerQuoteId);
    const legacyEntry = Object.entries(request.insurerQuotes || {}).find(([name, quote]) =>
      quote?.id === insurerQuoteId || `IQ-${request.id}-${name.replaceAll(/[^A-Za-z0-9]/g, '-')}` === insurerQuoteId,
    );
    const legacyQuote = legacyEntry?.[1];
    const reply = productQuote || legacyQuote;
    if (!reply) throw new Error('This quote is no longer available. Return to your quotes and choose a current final quotation.');
    const insurer = productQuote?.insurer?.name || legacyEntry?.[0] || '';
    if (reply.unavailableAt || request.unavailableInsurers?.some((entry) => entry.name === insurer)) {
      throw new Error('This quotation is no longer available for payment. Request a fresh quote from an available insurer.');
    }
    const open = [...mockAttempts.values()].find((attempt) => attempt.quoteRequestId === quoteRequestId && (OPEN_STATUSES.includes(attempt.status) || attempt.status === 'Confirmed'));
    if (open?.status === 'Confirmed') throw new Error('This request is already paid for.');
    if (open) throw new Error('A payment for this request is already under way.');
    const rtsaAnniversaryFee = request?.rtsaAnniversaryFee ?? 0;
    const now = new Date();
    const digits = (mobileNumber || '').replaceAll(/\D/g, '');
    const attempt = {
      transactionId: `TXN-${Date.now().toString(36).toUpperCase()}`,
      status: 'Pending',
      method,
      amount,
      rtsaAnniversaryFee,
      breakdown: [
        { kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amount: Math.round((amount - rtsaAnniversaryFee) * 100) / 100 },
        ...(rtsaAnniversaryFee > 0 ? [{ kind: 'CHARGE', code: 'RTSA_ANNIVERSARY_FEE', label: 'RTSA anniversary fee', amount: rtsaAnniversaryFee }] : []),
      ],
      currency: 'ZMW',
      payer: method === 'Mobile money' && digits ? `*******${digits.slice(-3)}` : null,
      initiatedAt: now.toISOString(),
      pendingUntil: new Date(now.getTime() + MOCK_PENDING_MINUTES * 60_000).toISOString(),
      confirmedAt: null,
      checkoutUrl: null,
      failure: null,
      quoteRequestId,
      insurerQuoteId,
      insurer,
      policyNumber: null,
      policyStatus: null,
      mobileNumber,
      idempotencyKey,
    };
    mockAttempts.set(attempt.transactionId, attempt);
    return publicAttempt(attempt);
  }),
  status: (transactionId) => call((s) => {
    const attempt = mockAttempts.get(transactionId);
    if (!attempt) return s.paymentReceipt?.transactionId === transactionId ? s.paymentReceipt : null;
    const settled = settleMockAttempt(s, attempt);
    mockAttempts.set(transactionId, settled);
    return publicAttempt(settled);
  }),
  cancel: (transactionId) => call(() => {
    const attempt = mockAttempts.get(transactionId);
    if (!attempt) throw new Error('Payment was not found.');
    if (!OPEN_STATUSES.includes(attempt.status)) throw new Error('This payment has already finished, so it cannot be cancelled.');
    const cancelled = { ...attempt, status: 'Cancelled', failure: FAILURE_WORDING.Cancelled };
    mockAttempts.set(transactionId, cancelled);
    return publicAttempt(cancelled);
  }),
};

export const policies = {
  listMine: () => call((s) => mine(s.policies)),
  get: (policyNumber) => call((s) => s.policies.find((p) => p.policyNumber === policyNumber) || null),
  renew: (policyNumber) => call((s) => ({ ok: s.renewFromPolicy(policyNumber) })),
  listForInsurer: () => call((s) => s.policies.filter((p) => p.insurer === insurerName())),
  issueCertificate: (policyNumber, issuance) => call((s) => {
    const policy = ownIssuingPolicy(s, policyNumber);
    if (policy.status === 'Issuance failed') throw new Error('This policy could not be issued and is being refunded, so it cannot be issued now.');
    s.issuePolicyCertificate(policyNumber, issuance);
    return state().policies.find((p) => p.policyNumber === policyNumber);
  }),
  acceptIssuance: (policyNumber, insurerPolicyNumber) => call((s) => {
    const policy = ownIssuingPolicy(s, policyNumber);
    if (policy.status !== 'Awaiting insurer certificate') throw new Error('This policy is no longer waiting to be issued.');
    const acceptedAt = policy.issuance?.acceptedAt || new Date().toISOString();
    s.updatePolicy(policyNumber, (current) => ({
      insurerPolicyNumber: insurerPolicyNumber || current.insurerPolicyNumber || null,
      issuance: { ...current.issuance, acceptedAt },
    }));
    return { policyNumber, issuanceAcceptedAt: acceptedAt, insurerPolicyNumber: insurerPolicyNumber || policy.insurerPolicyNumber || null };
  }),
  reportIssuanceFailure: (policyNumber, { reasonCode, customerMessage }) => call((s) => {
    const policy = ownIssuingPolicy(s, policyNumber);
    if (policy.status !== 'Awaiting insurer certificate') throw new Error('This policy is no longer waiting to be issued.');
    if (!reasonCode || (customerMessage || '').trim().length < 10) throw new Error('Tell the customer why, in at least 10 characters.');
    const failedAt = new Date().toISOString();
    s.updatePolicy(policyNumber, (current) => ({
      status: 'Issuance failed',
      issuance: { ...current.issuance, overdue: false, failedAt, failureReason: customerMessage.trim() },
    }));
    return { policyNumber, status: 'Issuance failed', issuanceFailedAt: failedAt, reason: customerMessage.trim() };
  }),
};

/** The signed-in insurer's own policy, as the API scopes it. */
function ownIssuingPolicy(s, policyNumber) {
  const policy = s.policies.find((entry) => entry.policyNumber === policyNumber);
  if (!policy || policy.insurer !== insurerName()) throw new Error('Policy was not found.');
  return policy;
}

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
  listForInsurer: () => call((s) => s.inspections.filter((inspection) => inspection.insurer === insurerName()).map(toPortalInspection)),
  schedule: (id, { scheduledDate, location }) => call((s) => prototypeInspectionStep(s, id, 'SCHEDULE', { scheduledDate, location: location || null })),
  assignInspector: (id, { inspectorName, inspectorPhone }) => call((s) => prototypeInspectionStep(s, id, 'ASSIGN', { inspectorName, inspectorPhone: inspectorPhone || null })),
  approve: (id) => call((s) => prototypeInspectionStep(s, id, 'APPROVE', { result: 'PASSED' })),
  fail: (id, reason) => call((s) => prototypeInspectionStep(s, id, 'FAIL', { result: 'FAILED', resultReason: reason })),
  noShow: (id, reason) => call((s) => prototypeInspectionStep(s, id, 'NO_SHOW', { resultReason: reason })),
  cancel: (id, reason) => call((s) => prototypeInspectionStep(s, id, 'CANCEL', { resultReason: reason })),
};

/** The prototype keeps an inspection's status as its label; the portal reads the API's codes. */
const INSPECTION_CODES = {
  Requested: 'REQUESTED', Scheduled: 'SCHEDULED', 'Inspector assigned': 'INSPECTOR_ASSIGNED', 'In progress': 'IN_PROGRESS',
  Completed: 'COMPLETED', 'Report ready': 'REPORT_READY', Approved: 'APPROVED', Failed: 'FAILED', Cancelled: 'CANCELLED', Missed: 'NO_SHOW',
};
const INSPECTION_LABELS = Object.fromEntries(Object.entries(INSPECTION_CODES).map(([label, code]) => [code, label]));
const toPortalInspection = (inspection) => ({
  purpose: 'GENERAL',
  method: 'PHYSICAL',
  stage: null,
  products: [],
  result: null,
  resultReason: null,
  ...inspection,
  status: INSPECTION_CODES[inspection.status] || inspection.status,
  statusLabel: INSPECTION_LABELS[INSPECTION_CODES[inspection.status]] || inspection.status,
});
const prototypeInspectionStep = (s, id, event, changes) => {
  const inspection = s.inspections.find((entry) => entry.id === id && entry.insurer === insurerName());
  if (!inspection) throw new Error('Inspection was not found.');
  const current = toPortalInspection(inspection);
  const next = nextPrototypeInspectionStatus(current.status, current.method, event);
  if (!next) throw new Error('Book the inspection before recording that step.');
  s.updateInspectionStatus(id, INSPECTION_LABELS[next], changes);
  return toPortalInspection(state().inspections.find((entry) => entry.id === id));
};
const nextPrototypeInspectionStatus = (status, method, event) => {
  if (['APPROVED', 'FAILED', 'CANCELLED', 'NO_SHOW'].includes(status)) return null;
  const decidable = ['SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'REPORT_READY'].includes(status)
    || (method === 'SELF_CAPTURE' && status === 'REQUESTED');
  return {
    SCHEDULE: ['REQUESTED', 'SCHEDULED'].includes(status) ? 'SCHEDULED' : null,
    ASSIGN: ['SCHEDULED', 'INSPECTOR_ASSIGNED'].includes(status) ? 'INSPECTOR_ASSIGNED' : null,
    APPROVE: decidable ? 'APPROVED' : null,
    FAIL: decidable ? 'FAILED' : null,
    NO_SHOW: ['SCHEDULED', 'INSPECTOR_ASSIGNED'].includes(status) ? 'NO_SHOW' : null,
    CANCEL: 'CANCELLED',
  }[event];
};

export const config = {
  getPia: () => call((s) => s.piaConfig),
  setPia: ({ piaRatePercentage }) => call((s) => {
    if (!Number.isFinite(piaRatePercentage) || piaRatePercentage < 0 || piaRatePercentage > 100) throw new Error('Provide a valid PIA percentage between 0 and 100.');
    return proposeApproval(s, 'PIA_FLOOR_CHANGE', 'pia.minimum_rate_bps', { piaRatePercentage }, 'Update the PIA minimum rate.');
  }),
};

/**
 * Browser-storage equivalent of safe delivery metadata. It deliberately has
 * no seeded rows: a prototype must not imply that an external provider was
 * contacted. Test/demo tooling may persist only these non-sensitive fields.
 */
export const integrations = {
  list: () => call(() => integrationDeliveries()),
  listForInsurer: () => call(() => integrationDeliveries().filter((delivery) => delivery.insurerId === insurerIdForSession())),
  manualFallback: (id, note) => call((s) => {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(s.staffSession?.role)) {
      throw new Error('Only an authorised administrator can record a manual fallback.');
    }
    const cleanedNote = String(note || '').trim();
    if (cleanedNote.length < 3) throw new Error('Explain how the integration exception was completed manually.');
    const deliveries = integrationDeliveries();
    const position = deliveries.findIndex((delivery) => delivery.id === id);
    if (position < 0) throw new Error('Integration delivery was not found.');
    if (deliveries[position].status !== 'FAILED') throw new Error('Only a failed integration delivery can be completed manually.');
    const resolved = {
      ...deliveries[position],
      status: 'MANUAL_FALLBACK',
      resolvedAt: new Date().toISOString(),
      resolvedByStaffId: s.staffSession?.id || null,
      resolutionNote: cleanedNote,
    };
    const next = [...deliveries];
    next[position] = resolved;
    saveIntegrationDeliveries(next);
    return resolved;
  }),
};

/**
 * Browser-storage equivalent of the protected administrator read endpoints.
 * It keeps prototype mode useful while HTTP mode always reads these figures
 * from the API rather than reusing persisted demo records.
 */
/** Reconciliation, refunds and settlements need real payments, so the browser prototype has none to show. */
const NEEDS_API = 'Reconciliation, refunds and settlements need the InsurShield API. Run the app against it to use them.';

export const settlements = {
  listForInsurer: () => call(() => []),
  getForInsurer: () => call(() => { throw new Error(NEEDS_API); }),
  exportCsv: () => call(() => { throw new Error(NEEDS_API); }),
};

export const admin = {
  reconciliation: {
    list: () => call(() => ({ items: [], next: null })),
    assign: () => call(() => { throw new Error(NEEDS_API); }),
    resolve: () => call(() => { throw new Error(NEEDS_API); }),
    proposeRefund: () => call(() => { throw new Error(NEEDS_API); }),
    proposeAdjustment: () => call(() => { throw new Error(NEEDS_API); }),
    importStatement: () => call(() => { throw new Error(NEEDS_API); }),
    listStatements: () => call(() => []),
    standInStatement: () => call(() => { throw new Error(NEEDS_API); }),
  },
  settlements: {
    list: () => call(() => []),
    draft: () => call(() => { throw new Error(NEEDS_API); }),
    get: () => call(() => { throw new Error(NEEDS_API); }),
    finalise: () => call(() => { throw new Error(NEEDS_API); }),
    exportCsv: () => call(() => { throw new Error(NEEDS_API); }),
  },
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
