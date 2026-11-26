import { useStore, belongsToCustomer } from '@/store';
import { INSPECTION_PHOTO_SLOTS, inspectionStatus, inspectionClosed } from '@/domain/inspectionWorkflow';

const documents = new Map();
export const rememberInspectionDocument = (document, kind) => documents.set(document.id, { document, kind });
const state = () => useStore.getState();
const staffName = () => state().staffSession?.name;
const find = (id, staff) => {
  const inspection = state().inspections.find((item) => item.id === id && (staff ? item.insurer === staffName() : belongsToCustomer(state().customer)(item)));
  if (!inspection) throw new Error('Inspection was not found.');
  return inspection;
};
const change = (inspection, values) => {
  const updated = { ...inspection, ...values };
  state().setInspections(state().inspections.map((item) => item.id === inspection.id ? updated : item));
  return updated;
};
const requireDocument = (id, kind) => {
  const entry = documents.get(id);
  if (!entry || entry.kind !== kind) throw new Error('Upload the correct evidence document before submitting.');
  return entry.document;
};
const editable = (inspection) => {
  if (inspectionClosed(inspection) || inspection.report) throw new Error('This attempt is read-only. Its published evidence and report cannot be replaced.');
};
const created = (inspection) => ({ id: inspection.id, status: inspectionStatus(inspection), statusLabel: inspection.status });
const newAttempt = (values) => {
  const inspection = { ...values, id: `INS-${crypto.randomUUID()}`, status: 'Requested', createdAt: new Date().toISOString(), photos: [], report: null, result: null, resultReason: null, scheduledDate: null, inspectorName: null, inspectorPhone: null };
  state().setInspections([inspection, ...state().inspections]);
  return created(inspection);
};

export function requestClaimInspection(number, method) {
  const claim = state().claims.find((item) => (item.claimNumber || item.id) === number && item.insurer === staffName());
  if (!claim) throw new Error('Claim was not found.');
  if (['Closed', 'Approved', 'Declined'].includes(claim.status)) throw new Error('This claim no longer accepts an inspection.');
  const open = state().inspections.find((item) => item.claimNumber === number && !inspectionClosed(item));
  if (open) return created(open);
  return newAttempt({ purpose: 'CLAIM_ASSESSMENT', method, stage: null, policyNumber: claim.policyNumber || null, claimNumber: number, insurer: claim.insurer, vehicleLabel: claim.vehicle, vehiclePlate: claim.plate, fullName: claim.fullName, phone: claim.phone, email: claim.email });
}

export function submitInspectionEvidence(id, { photos }, staff = false) {
  const inspection = find(id, staff);
  if (!photos.length) throw new Error('Select at least one photo.');
  const kind = inspection.purpose === 'CLAIM_ASSESSMENT' ? 'CLAIM_ATTACHMENT' : 'INSPECTION_PHOTO';
  const entries = photos.map(({ slot, documentId }) => {
    if (!INSPECTION_PHOTO_SLOTS.some(([name]) => name === slot)) throw new Error('Choose a supported photo slot.');
    return { slot, document: requireDocument(documentId, kind) };
  });
  const additions = entries.filter((entry) => {
    const previous = inspection.photos?.find((photo) => photo.slot === entry.slot);
    if (previous && previous.document.id !== entry.document.id) throw new Error('This view is already recorded. A new inspection can collect fresh evidence.');
    return !previous;
  });
  if (!additions.length) return inspection;
  editable(inspection);
  return change(inspection, { photos: [...(inspection.photos || []), ...additions] });
}

export function inspectionEvidence(id) {
  const inspection = find(id, true);
  const reference = inspection.claimNumber || inspection.policyNumber || inspection.id;
  const policy = state().policies.find((item) => item.policyNumber === inspection.policyNumber);
  const request = state().quoteRequests.find((item) => item.id === policy?.quoteRequestId);
  const before = Array.isArray(request?.photos) ? request.photos.filter((item) => item.document) : [];
  const paid = inspection.purpose === 'CLAIM_ASSESSMENT' ? state().inspections.filter((item) => item.purpose === 'AFTER_PAYMENT' && item.policyNumber === inspection.policyNumber && item.insurer === inspection.insurer && inspectionStatus(item) === 'APPROVED') : [];
  const paidEvidence = paid.flatMap((item) => [...(item.photos || []).map((photo) => ({ ...photo, reference: item.id })), ...(item.report ? [{ slot: 'report', document: item.report, reference: item.id }] : [])]);
  return { preLoss: [...before.map((item) => ({ ...item, reference: policy.policyNumber })), ...paidEvidence], postLoss: (inspection.photos || []).map((item) => ({ ...item, reference })), report: inspection.report || null };
}

export function publishInspectionReport(id, documentId) {
  const inspection = find(id, true);
  if (inspection.report?.id === documentId) return inspection;
  editable(inspection);
  const ready = inspection.method === 'SELF_CAPTURE'
    ? INSPECTION_PHOTO_SLOTS.every(([slot]) => inspection.photos?.some((item) => item.slot === slot))
    : ['SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED'].includes(inspectionStatus(inspection));
  if (!ready) throw new Error(inspection.method === 'SELF_CAPTURE' ? 'Submit all six photo slots before publishing the report.' : 'Schedule the physical inspection first.');
  const report = requireDocument(documentId, inspection.purpose === 'CLAIM_ASSESSMENT' ? 'CLAIM_ATTACHMENT' : 'INSPECTION_REPORT');
  return change(inspection, { report, status: 'Report ready' });
}

export function reinspect(id, reinspectionAllowed = false) {
  const inspection = find(id, true);
  const successor = state().inspections.find((item) => item.predecessorId === id);
  if (successor) return created(successor);
  if (!['FAILED', 'CANCELLED', 'NO_SHOW', 'MISSED'].includes(inspectionStatus(inspection))) throw new Error('Only ended attempts can be repeated.');
  if (inspection.purpose === 'AFTER_PAYMENT' && inspectionStatus(inspection) === 'FAILED' && !reinspectionAllowed) throw new Error('The stored product terms do not allow another attempt after failure.');
  return newAttempt({ ...inspection, predecessorId: inspection.id });
}
