import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ClaimsPage from './ClaimsPage';
import { api } from '@/api';
import { useStore } from '@/store';

vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));
vi.mock('@/api/sync', () => ({ hydrateCustomer: vi.fn(), hydrateDirectory: vi.fn() }));
vi.mock('@/api', () => ({ api: { ncd: { rules: vi.fn(), apply: vi.fn(), submitEvidence: vi.fn() }, claims: { intakeRules: vi.fn() }, documents: { upload: vi.fn() } } }));
const rules = { tiers: [{ yearsClaimFree: 2, percentage: 17 }], validityDays: 90, provisional: true, declarationText: 'I confirm my claim-free history.' };
const application = { id: 'NCD-1', applicationNumber: 'NCD-001', policyNumber: 'POL-1', fullName: 'Customer', phone: '0970123456', yearsClaimFree: 2, discountPercentage: 17, status: 'Verification Required', verificationRevision: 3, decisionNote: 'Provide policy history', evidence: [], submittedAt: '2026-11-01T00:00:00Z' };
const showDetail = async (user, record = application) => {
  useStore.setState({ ncdApplications: [record] });
  render(<MemoryRouter><ClaimsPage /></MemoryRouter>);
  await user.click(screen.getByRole('tab', { name: /NCD|No-claim/i }));
  await user.click(screen.getByRole('button', { name: /NCD-001/ }));
};
beforeEach(() => {
  vi.resetAllMocks();
  api.ncd.rules.mockResolvedValue(rules);
  api.claims.intakeRules.mockResolvedValue({});
  useStore.setState({ customer: { id: 'customer-1', fullName: 'Customer', phone: '0970123456' }, claims: [], ncdApplications: [], policies: [
    { policyNumber: 'POL-1', status: 'Active', insurer: 'Insurer', vehicle: 'Toyota' },
    { policyNumber: 'POL-2', status: 'Awaiting insurer certificate', insurer: 'Insurer', vehicle: 'Nissan' },
  ] });
});
describe('HTTP NCD application', () => {
  it('uses issued policies, configured tiers and declaration without sending insurerId', async () => {
    const user = userEvent.setup();
    api.ncd.apply.mockRejectedValueOnce(new Error('Connection interrupted')).mockResolvedValueOnce(application);
    render(<MemoryRouter initialEntries={['/claims?action=ncd']}><ClaimsPage /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: '2 claim-free years, 17%' })).toBeInTheDocument());
    expect(screen.queryByRole('option', { name: /POL-2/ })).not.toBeInTheDocument();
    expect(screen.getByText(/valid for 90 days/)).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Full Name *' }), 'Customer');
    await user.type(screen.getByRole('textbox', { name: 'Mobile Number *' }), '0970123456');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Issued policy *' }), 'POL-1');
    await user.click(screen.getByRole('button', { name: '2 claim-free years, 17%' }));
    await user.click(screen.getByRole('checkbox', { name: rules.declarationText }));
    await user.click(screen.getByRole('button', { name: 'Submit NCD Application' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Connection interrupted');
    await user.click(screen.getByRole('button', { name: 'Submit NCD Application' }));
    expect(api.ncd.apply.mock.calls[0]).toEqual(api.ncd.apply.mock.calls[1]);
    await waitFor(() => expect(api.ncd.apply).toHaveBeenLastCalledWith({ policyNumber: 'POL-1', fullName: 'Customer', phone: '0970123456', yearsClaimFree: 2, declaration: true }, expect.any(String)));
    expect(await screen.findByRole('heading', { name: 'NCD application submitted' })).toBeInTheDocument();
  });

  it('blocks submission when rules fail and allows a retry', async () => {
    const user = userEvent.setup();
    api.ncd.rules.mockRejectedValueOnce(new Error('offline'));
    render(<MemoryRouter initialEntries={['/claims?action=ncd']}><ClaimsPage /></MemoryRouter>);
    await user.click(await screen.findByRole('button', { name: 'Retry NCD rules' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '2 claim-free years, 17%' })).toBeInTheDocument());
    expect(api.ncd.apply).not.toHaveBeenCalled();
  });

  it('uploads evidence once across a failed submission and sends the displayed revision', async () => {
    const user = userEvent.setup();
    api.documents.upload.mockResolvedValue({ id: 'DOC-1' });
    api.ncd.submitEvidence.mockRejectedValueOnce(new Error('Try again')).mockResolvedValueOnce({ ...application, status: 'Under Review', evidence: [{ id: 'DOC-1', name: 'history.pdf', url: '/documents/signed' }] });
    await showDetail(user);
    expect(screen.getByText('Potential Discount').parentElement).toHaveTextContent('17%');
    await waitFor(() => expect(screen.getByText(/Provide policy history/)).toBeInTheDocument());
    const file = new File(['proof'], 'history.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Verification evidence files'), file);
    await user.click(screen.getByRole('button', { name: 'Submit verification evidence' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again');
    await user.click(screen.getByRole('button', { name: 'Submit verification evidence' }));
    expect(await screen.findByRole('link', { name: 'history.pdf' })).toHaveAttribute('href', '/documents/signed');
    expect(api.documents.upload).toHaveBeenCalledExactlyOnceWith(file, 'NCD_EVIDENCE');
    expect(api.ncd.submitEvidence.mock.calls[0][2]).toBe(api.ncd.submitEvidence.mock.calls[1][2]);
    expect(api.ncd.submitEvidence).toHaveBeenLastCalledWith('NCD-1', { verificationRevision: 3, documentIds: ['DOC-1'] }, expect.any(String));
    expect(screen.queryByRole('button', { name: 'Submit verification evidence' })).not.toBeInTheDocument();
  });

  it('does not invent discounts for legacy approvals or expose unsafe evidence links', async () => {
    await showDetail(userEvent.setup(), { ...application, status: 'Approved', approvedCode: 'OLD', discountPercentage: null, evidence: [{ id: 'bad', name: 'unsafe', url: 'javascript:alert(1)' }] });
    await waitFor(() => expect(screen.getByText(/Legacy approval/)).toBeInTheDocument());
    expect(screen.getByText('Potential Discount').parentElement).toHaveTextContent('Insurer verification needed');
    expect(screen.queryByRole('button', { name: 'Copy Code' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'unsafe' })).not.toBeInTheDocument();
  });

  it.each(['Used', 'Unavailable', 'Expired'])('hides a %s code and shows its server status', async (codeStatus) => {
    await showDetail(userEvent.setup(), { ...application, status: 'Approved', approvedCode: 'DO-NOT-SHOW', codeStatus });
    expect(screen.getByText(`Code status: ${codeStatus}`)).toBeInTheDocument();
    expect(screen.queryByText('DO-NOT-SHOW')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy Code' })).not.toBeInTheDocument();
  });

  it('marks an expired code and removes the quote action', async () => {
    await showDetail(userEvent.setup(), { ...application, status: 'Approved', approvedCode: 'EXPIRED', expiresAt: '2020-01-01T00:00:00Z' });
    await waitFor(() => expect(screen.getByText(/This discount code has expired/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Get a Quote' })).not.toBeInTheDocument();
  });
});
