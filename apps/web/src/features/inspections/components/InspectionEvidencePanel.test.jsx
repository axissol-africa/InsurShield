import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store';
import InspectionEvidencePanel from './InspectionEvidencePanel';
import ClaimInspection from './ClaimInspection';

const requestInspection = vi.hoisted(() => vi.fn());
vi.mock('@/api', () => ({ api: { claims: { requestInspection } } }));
const row = { id: 'INS-1', purpose: 'CLAIM_ASSESSMENT', status: 'REQUESTED', method: 'SELF_CAPTURE', photos: [], report: null };
const file = (name = 'front.png') => new File(['image'], name, { type: 'image/png' });
const fakeApi = () => ({ documents: { upload: vi.fn().mockResolvedValue({ id: 'doc-1' }) }, inspections: {
  submitEvidence: vi.fn().mockResolvedValue({}), submitInsurerEvidence: vi.fn().mockResolvedValue({}),
  evidence: vi.fn().mockResolvedValue({ preLoss: [], postLoss: [], report: null }), attachReport: vi.fn().mockResolvedValue({}),
} });
beforeEach(() => { useStore.setState({ leaving: false, customer: { email: 'owner@example.com' }, staffSession: null }); vi.clearAllMocks(); });

it('submits canonical slots and keeps successful uploads for a retry', async () => {
  const user = userEvent.setup(); const api = fakeApi();
  api.inspections.submitEvidence.mockRejectedValueOnce(new Error('Connection lost'));
  render(<InspectionEvidencePanel inspection={row} api={api} />);
  await user.upload(screen.getByLabelText('Engine bay'), file());
  await user.click(screen.getByRole('button', { name: 'Submit inspection photos' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  await user.click(screen.getByRole('button', { name: 'Submit inspection photos' }));
  await screen.findByText('Evidence submitted to the insurer.');
  expect(api.documents.upload).toHaveBeenCalledTimes(1);
  expect(api.documents.upload).toHaveBeenCalledWith(expect.any(File), 'CLAIM_ATTACHMENT');
  expect(api.inspections.submitEvidence).toHaveBeenLastCalledWith('INS-1', { photos: [{ slot: 'engine_bay', documentId: 'doc-1' }] });
});

it('requires all six saved slots for self capture, but allows a scheduled physical report without photos', async () => {
  const user = userEvent.setup(); const api = fakeApi();
  const view = render(<InspectionEvidencePanel inspection={row} staff api={api} />);
  await user.upload(await screen.findByLabelText('Final inspection report'), file('report.png'));
  expect(screen.getByRole('button', { name: 'Publish final report' })).toBeDisabled();
  view.rerender(<InspectionEvidencePanel inspection={{ ...row, purpose: 'AFTER_PAYMENT', method: 'PHYSICAL', status: 'SCHEDULED' }} staff api={api} />);
  await user.click(screen.getByRole('button', { name: 'Publish final report' }));
  await waitFor(() => expect(api.inspections.attachReport).toHaveBeenCalledWith('INS-1', 'doc-1'));
  expect(api.documents.upload).toHaveBeenCalledWith(expect.any(File), 'INSPECTION_REPORT');
});

it('renders immutable evidence with secure links and reference, without upload controls', async () => {
  const api = fakeApi();
  api.inspections.evidence.mockResolvedValue({ preLoss: [{ slot: 'report', reference: 'POL-1', document: { id: 'pre', name: 'before.png', url: 'https://files.example/before' } }], postLoss: [{ slot: 'rear', reference: 'CL-1', document: { id: 'post', name: 'unsafe.png', url: 'javascript:alert(1)' } }], report: { id: 'report', name: 'report.pdf', url: '/documents/report' } });
  render(<InspectionEvidencePanel inspection={{ ...row, status: 'REPORT_READY' }} staff api={api} />);
  const link = await screen.findByRole('link', { name: 'before.png' });
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.getByText(/POL-1/)).toBeVisible();
  expect(screen.getByText(/Inspection report ·/)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'unsafe.png' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Front view')).not.toBeInTheDocument();
});

it('does not submit an uploaded file after identity changes', async () => {
  const user = userEvent.setup(); const api = fakeApi(); let finish;
  api.documents.upload.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  render(<InspectionEvidencePanel inspection={row} api={api} />);
  await user.upload(screen.getByLabelText('Front view'), file());
  await user.click(screen.getByRole('button', { name: 'Submit inspection photos' }));
  useStore.setState({ customer: { email: 'other@example.com' } });
  finish({ id: 'old-owner-document' });
  await waitFor(() => expect(api.documents.upload).toHaveBeenCalledTimes(1));
  expect(api.inspections.submitEvidence).not.toHaveBeenCalled();
});

it('uses the timeline assessment link and does not offer a duplicate start', () => {
  render(<ClaimInspection claimNumber="CL-1" status="Under review" staff inspection={{ id: 'INS-1', status: 'Report ready', method: 'SELF_CAPTURE' }} />);
  expect(screen.getByRole('link', { name: /Find this claim/ })).toHaveAttribute('href', '/insurer?view=inspections#inspection-INS-1');
  expect(screen.getByRole('status')).toHaveTextContent('Report ready');
  expect(screen.queryByRole('button', { name: 'Request claim inspection' })).not.toBeInTheDocument();
});

it('requests the chosen assessment method and links to its returned attempt', async () => {
  requestInspection.mockResolvedValue({ id: 'INS-2', status: 'REQUESTED', statusLabel: 'Requested' });
  const user = userEvent.setup();
  render(<ClaimInspection claimNumber="CL-1" status="Under review" staff />);
  await user.selectOptions(screen.getByLabelText('Assessment method'), 'SELF_CAPTURE');
  await user.click(screen.getByRole('button', { name: 'Request claim inspection' }));
  expect(requestInspection).toHaveBeenCalledWith('CL-1', 'SELF_CAPTURE');
  await waitFor(() => expect(screen.getByRole('link', { name: /Find this claim/ })).toHaveAttribute('href', '/insurer?view=inspections#inspection-INS-2'));
});

it('keeps saved photo slots disabled while missing slots remain available', () => {
  render(<InspectionEvidencePanel inspection={{ ...row, photos: [{ slot: 'front', document: { id: 'saved', name: 'front.png' } }] }} api={fakeApi()} />);
  expect(screen.getByLabelText('Front view — saved')).toBeDisabled();
  expect(screen.getByLabelText('Rear view')).toBeEnabled();
});
