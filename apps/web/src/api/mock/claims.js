import { inspectionClosed } from '@/domain/inspectionWorkflow';
import { useStore, belongsToCustomer } from '@/store';
import { newIdempotencyKey } from '../shared';

export const claimIntakeRules = {
  reportingDays: 14, responseDays: 7,
  excludedTypes: { COMPREHENSIVE: [], THIRD_PARTY: ['Theft', 'Fire Damage', 'Natural Disaster', 'Windscreen Damage'] },
  requireAttachmentsFor: ['Theft'], requirePoliceReportFor: ['Theft'], provisional: true,
};

export function findClaim(number, insurer = false) {
  const state = useStore.getState();
  const claim = state.claims.find((entry) => (entry.claimNumber || entry.id) === number && (insurer ? entry.insurer === state.staffSession?.name : belongsToCustomer(state.customer)(entry)));
  if (!claim) throw new Error('Claim not found.');
  return claim;
}
export function timeline(claim) {
  const inspection = useStore.getState().inspections.find((item) => item.purpose === 'CLAIM_ASSESSMENT' && item.claimNumber === (claim.claimNumber || claim.id));
  return { inspection: inspection ? { id: inspection.id, status: inspection.status, method: inspection.method } : null, revision: claim.updates?.at(-1)?.id || `${claim.claimNumber || claim.id}:${claim.receivedAt || claim.status !== 'Notified' ? 'acknowledged' : 'submitted'}`, claimNumber: claim.claimNumber || claim.id, status: claim.status, responseDueOn: claim.responseDueOn || null, lateSubmission: !!claim.lateSubmission, insurerClaimReference: claim.insurerClaimReference || null, updates: claim.updates || [] };
}
export function recordUpdate(claim, status, actorKind, message, extra = {}) {
  const next = { ...claim, ...extra, status, updates: [...(claim.updates || []), { id: crypto.randomUUID(), status, actorKind, message, createdAt: new Date().toISOString(), evidenceRequest: extra.evidenceRequest || null, documents: extra.documents || [] }] };
  useStore.setState((state) => ({ claims: state.claims.map((entry) => entry.id === claim.id ? next : entry) }));
  return timeline(next);
}
function applyUpdate(number, payload) {
  const claim = findClaim(number, true);
  if (['APPROVE', 'DECLINE', 'CLOSE'].includes(payload.action) && useStore.getState().inspections.some((item) => item.claimNumber === number && item.purpose === 'CLAIM_ASSESSMENT' && !inspectionClosed(item))) throw new Error('Complete the open claim inspection before approving, declining or closing this claim.');
  const transitions = { START_REVIEW: ['Received by insurer', 'Under review'], REQUEST_EVIDENCE: ['Under review', 'Additional information required'], APPROVE: ['Under review', 'Approved'], DECLINE: ['Under review', 'Declined'] };
  const transition = payload.action === 'CLOSE' && ['Approved', 'Declined'].includes(claim.status) ? [claim.status, 'Closed'] : transitions[payload.action];
  if (!transition || transition[0] !== claim.status) throw new Error('This claim has changed. Refresh its updates.');
  if (!payload.message?.trim()) throw new Error('Enter a message for the customer.');
  if (payload.action === 'REQUEST_EVIDENCE' && !payload.evidenceRequest?.trim()) throw new Error('Describe the evidence needed.');
  return recordUpdate(claim, transition[1], 'INSURER', payload.message, { evidenceRequest: payload.evidenceRequest });
}
function applyEvidence(number, payload) {
  const claim = findClaim(number);
  if (claim.status !== 'Additional information required') throw new Error('There is no open evidence request.');
  if (!payload.documentIds?.length || new Set(payload.documentIds).size !== payload.documentIds.length) throw new Error('Upload the requested evidence.');
  return recordUpdate(claim, 'Under review', 'CUSTOMER', 'Requested evidence submitted.', { documents: payload.documentIds.map((id) => ({ id, name: 'Evidence document' })) });
}

// Receipts live with the mock claim so a replay after reload cannot append another event.
function command(number, payload, key, insurer, apply) {
  const claim = findClaim(number, insurer);
  const actor = insurer ? 'INSURER' : 'CUSTOMER';
  const fingerprint = JSON.stringify(payload);
  const receipt = claim.commandReceipts?.find((entry) => entry.key === key && entry.actor === actor);
  if (receipt) {
    if (receipt.fingerprint !== fingerprint) throw Object.assign(new Error('This command key was already used for different input.'), { code: 'IDEMPOTENCY_KEY_REUSED' });
    return receipt.result;
  }
  if (!payload.expectedRevision || payload.expectedRevision !== timeline(claim).revision) {
    throw Object.assign(new Error('This claim has changed. Refresh its updates.'), { code: 'CLAIM_REVISION_CHANGED' });
  }
  const result = apply(number, payload);
  useStore.setState((state) => ({ claims: state.claims.map((entry) => entry.id === claim.id ? { ...entry, commandReceipts: [...(entry.commandReceipts || []), { key, actor, fingerprint, result }] } : entry) }));
  return result;
}
export function updateClaim(number, payload, key = newIdempotencyKey()) {
  return command(number, payload, key, true, applyUpdate);
}
export function submitEvidence(number, payload, key = newIdempotencyKey()) {
  return command(number, payload, key, false, applyEvidence);
}
