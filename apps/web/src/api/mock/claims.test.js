import { claims } from './index';
import { beforeEach, expect, it } from 'vitest';
import { useStore } from '@/store';
import { findClaim, timeline, recordUpdate, updateClaim, submitEvidence } from './claims';
const claim = { id: 'CLM-1', claimNumber: 'CLM-1', status: 'Notified', insurer: 'Insurer', email: 'customer@example.com' };
beforeEach(() => useStore.setState({ claims: [claim], customer: { email: claim.email }, staffSession: { name: 'Insurer' } }));
it('preserves acknowledgement and records the complete evidence lifecycle', () => {
  recordUpdate(findClaim('CLM-1', true), 'Received by insurer', 'INSURER', 'Received', { insurerClaimReference: 'INS-1' });
  updateClaim('CLM-1', { expectedRevision: timeline(findClaim('CLM-1', true)).revision, action: 'START_REVIEW', message: 'Reviewing' });
  updateClaim('CLM-1', { expectedRevision: timeline(findClaim('CLM-1', true)).revision, action: 'REQUEST_EVIDENCE', message: 'Please upload', evidenceRequest: 'Photos' });
  expect(submitEvidence('CLM-1', { expectedRevision: timeline(findClaim('CLM-1')).revision, documentIds: ['DOC-1'] }).status).toBe('Under review');
  expect(() => submitEvidence('CLM-1', { expectedRevision: timeline(findClaim('CLM-1')).revision, documentIds: ['DOC-1'] })).toThrow('no open');
  updateClaim('CLM-1', { expectedRevision: timeline(findClaim('CLM-1', true)).revision, action: 'APPROVE', message: 'Approved' });
  const result = updateClaim('CLM-1', { expectedRevision: timeline(findClaim('CLM-1', true)).revision, action: 'CLOSE', message: 'Closed' });
  expect(result.insurerClaimReference).toBe('INS-1');
  expect(result.updates).toHaveLength(6);
  expect(result.updates[3].documents[0].id).toBe('DOC-1');
  expect(() => updateClaim('CLM-1', { expectedRevision: timeline(findClaim('CLM-1', true)).revision, action: 'CLOSE', message: 'Again' })).toThrow();
});
it('rejects another customer or insurer', () => {
  useStore.setState({ customer: { email: 'other@example.com' }, staffSession: { name: 'Other' } });
  expect(() => findClaim('CLM-1')).toThrow('not found');
  expect(() => findClaim('CLM-1', true)).toThrow('not found');
});

it('supports owned-policy intake and the legacy prototype fallback', async () => {
  useStore.setState({ policies: [{ policyNumber: 'POL-1', customerEmail: claim.email, insurer: 'Insurer', vehicle: 'Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' } }] });
  const linked = await claims.notify({ policyNumber: 'POL-1', email: claim.email, plate: 'wrong', vehicle: 'wrong' });
  expect(linked).toMatchObject({ policyNumber: 'POL-1', plate: 'BAA 1234', vehicle: 'Toyota Hilux', insurer: 'Insurer' });
  const prototype = await claims.notify({ email: claim.email, insurer: 'Insurer', plate: 'ABC 999' });
  expect(prototype).toMatchObject({ plate: 'ABC 999', status: 'Notified' });
  await expect(claims.notify({ policyNumber: 'OTHER', email: claim.email })).rejects.toThrow('Choose one of your policies');
});

it('exposes stable synthetic revisions and rejects missing or stale revisions', () => {
  expect(timeline(claim).revision).toBe('CLM-1:submitted');
  expect(timeline({ ...claim, receivedAt: '2026-01-01', status: 'Received by insurer' }).revision).toBe('CLM-1:acknowledged');
  expect(() => updateClaim('CLM-1', { action: 'START_REVIEW', message: 'Review' })).toThrow(expect.objectContaining({ code: 'CLAIM_REVISION_CHANGED' }));
});
it('replays unchanged commands once and rejects stale evidence when a new request has the same status', () => {
  recordUpdate(findClaim('CLM-1', true), 'Under review', 'INSURER', 'Review');
  const first = { expectedRevision: timeline(findClaim('CLM-1')).revision, action: 'REQUEST_EVIDENCE', message: 'Photos', evidenceRequest: 'Photos' };
  const requested = updateClaim('CLM-1', first, 'request-key');
  expect(updateClaim('CLM-1', first, 'request-key')).toEqual(requested);
  expect(findClaim('CLM-1').updates).toHaveLength(2);
  expect(() => updateClaim('CLM-1', { ...first, message: 'Changed' }, 'request-key')).toThrow(expect.objectContaining({ code: 'IDEMPOTENCY_KEY_REUSED' }));
  const evidence = { expectedRevision: requested.revision, documentIds: ['DOC-1'] };
  const reviewed = submitEvidence('CLM-1', evidence, 'evidence-key');
  expect(submitEvidence('CLM-1', evidence, 'evidence-key')).toEqual(reviewed);
  updateClaim('CLM-1', { ...first, expectedRevision: reviewed.revision }, 'new-request-key');
  expect(() => submitEvidence('CLM-1', evidence, 'new-evidence-key')).toThrow(expect.objectContaining({ code: 'CLAIM_REVISION_CHANGED' }));
  expect(findClaim('CLM-1').updates).toHaveLength(4);
});
