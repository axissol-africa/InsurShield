import { beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import * as mock from './index';
import { rememberInspectionDocument } from './inspectionEvidence';
import { INSPECTION_PHOTO_SLOTS } from '@/domain/inspectionWorkflow';
vi.mock('@/config/env', () => ({ env: { apiMode: 'mock', mockLatencyMs: 0 } }));
const initial = useStore.getInitialState();
const row = { id: 'INS-1', purpose: 'CLAIM_ASSESSMENT', claimNumber: 'CL-1', policyNumber: null, status: 'Requested', method: 'SELF_CAPTURE', insurer: 'Prestige Assurance', email: 'owner@example.com', photos: [], report: null };
beforeEach(() => {
  useStore.setState({ ...initial, leaving: false, customer: { email: row.email }, staffSession: { role: 'insurer', name: row.insurer }, inspections: [{ ...row }], claims: [{ id: 'CL-1', claimNumber: 'CL-1', status: 'Under review', insurer: row.insurer, email: row.email }], policies: [], quoteRequests: [] }, true);
  rememberInspectionDocument({ id: 'photo', name: 'photo.png' }, 'CLAIM_ATTACHMENT');
  rememberInspectionDocument({ id: 'report', name: 'report.pdf' }, 'CLAIM_ATTACHMENT');
});
it('requires six saved slots before immutable report publication and then permits approval', async () => {
  await expect(mock.inspections.approve(row.id)).rejects.toThrow('report');
  await expect(mock.inspections.attachReport(row.id, 'report')).rejects.toThrow('six');
  await mock.inspections.submitEvidence(row.id, { photos: INSPECTION_PHOTO_SLOTS.map(([slot]) => ({ slot, documentId: 'photo' })) });
  expect((await mock.inspections.evidence(row.id)).postLoss).toHaveLength(6);
  await mock.inspections.attachReport(row.id, 'report');
  await expect(mock.inspections.attachReport(row.id, 'report')).resolves.toHaveProperty('report.id', 'report');
  rememberInspectionDocument({ id: 'replacement', name: 'new.pdf' }, 'CLAIM_ATTACHMENT');
  await expect(mock.inspections.attachReport(row.id, 'replacement')).rejects.toThrow('read-only');
  await expect(mock.inspections.submitEvidence(row.id, { photos: [{ slot: 'front', documentId: 'replacement' }] })).rejects.toThrow('already recorded');
  expect(await mock.inspections.approve(row.id)).toMatchObject({ status: 'APPROVED' });
});
it('blocks claim decisions while open and returns latest inspection in timeline', async () => {
  const timeline = await mock.claims.insurerTimeline('CL-1');
  expect(timeline.inspection).toEqual({ id: row.id, status: 'Requested', method: 'SELF_CAPTURE' });
  await expect(mock.claims.update('CL-1', { expectedRevision: timeline.revision, action: 'APPROVE', message: 'Approved' })).rejects.toThrow('open claim inspection');
  expect(await mock.claims.requestInspection('CL-1', 'PHYSICAL')).toMatchObject({ id: row.id });
});
it('schedules physical reports without photos and preserves ended attempts on repeat', async () => {
  useStore.setState({ inspections: [{ ...row, method: 'PHYSICAL' }] });
  await expect(mock.inspections.attachReport(row.id, 'report')).rejects.toThrow('Schedule');
  await mock.inspections.schedule(row.id, { scheduledDate: '2026-12-01T09:00:00Z' });
  await mock.inspections.attachReport(row.id, 'report');
  await mock.inspections.fail(row.id, 'Damage requires reassessment');
  const next = await mock.inspections.reinspect(row.id);
  expect(next.id).not.toBe(row.id);
  expect(await mock.inspections.reinspect(row.id)).toEqual(next);
  expect(useStore.getState().inspections.find((item) => item.id === row.id)).toMatchObject({ status: 'Failed', report: { id: 'report' } });
  expect(useStore.getState().inspections.find((item) => item.id === next.id)).toMatchObject({ predecessorId: row.id, report: null, photos: [] });
});
it('respects product repeat refusal, allows missed rebooking and rejects another owner', async () => {
  useStore.setState({ inspections: [{ ...row, purpose: 'AFTER_PAYMENT', status: 'Failed' }] });
  await expect(mock.inspections.reinspect(row.id)).rejects.toThrow('product terms');
  useStore.setState({ inspections: [{ ...row, status: 'Missed' }] });
  await expect(mock.inspections.reinspect(row.id)).resolves.toHaveProperty('id');
  useStore.setState({ customer: { email: 'stranger@example.com' } });
  await expect(mock.inspections.submitEvidence(row.id, { photos: [{ slot: 'front', documentId: 'photo' }] })).rejects.toThrow('not found');
});

it('includes approved paid inspection reports in the pre-loss group', async () => {
  useStore.setState({ inspections: [{ ...row, policyNumber: 'POL-1' }, { ...row, id: 'PAID-1', policyNumber: 'POL-1', claimNumber: null, purpose: 'AFTER_PAYMENT', status: 'Approved', report: { id: 'paid-report', name: 'paid.pdf', url: '/documents/paid-report' } }] });
  expect((await mock.inspections.evidence(row.id)).preLoss).toContainEqual({ slot: 'report', reference: 'PAID-1', document: { id: 'paid-report', name: 'paid.pdf', url: '/documents/paid-report' } });
});
