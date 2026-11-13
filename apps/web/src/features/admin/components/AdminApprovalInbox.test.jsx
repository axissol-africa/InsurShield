import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store';
import AdminApprovalInbox from './AdminApprovalInbox';

const request = {
  id: 'approval-1', action: 'PIA_FLOOR_CHANGE', status: 'PENDING', targetId: 'pia.minimum_rate_bps',
  requestedByStaffId: 'maker', requestedByName: 'Maker Admin', requestedReason: 'Rate review',
  createdAt: '2026-11-12T12:00:00Z', expiresAt: '2099-01-01T12:00:00Z',
  proposal: { piaRatePercentage: 5, secret: 'HIDDEN-PROPOSAL' },
  payload: { secret: 'HIDDEN-RAW' }, document: { dataUrl: 'HIDDEN-DOCUMENT' }, integration: { clientSecret: 'HIDDEN-INTEGRATION' },
};
let api;
beforeEach(() => {
  useStore.setState({ staffSession: { id: 'checker', role: 'admin', staffRole: 'SUPER_ADMIN' } });
  api = { admin: { approvals: { list: vi.fn().mockResolvedValue([request]), approve: vi.fn(), reject: vi.fn() } } };
});

describe('AdminApprovalInbox', () => {
  it('renders safe proposal details and records a decision with history', async () => {
    api.admin.approvals.approve.mockResolvedValue({ ...request, status: 'EXECUTED', decisionReason: 'Verified', decidedByStaffId: 'checker', decidedAt: '2026-11-12T13:00:00Z', executedAt: '2026-11-12T13:00:00Z' });
    const onChanged = vi.fn();
    render(<AdminApprovalInbox api={api} onChanged={onChanged} />);
    expect(await screen.findByText('5%')).toBeVisible();
    expect(screen.getByText('Maker Admin')).toBeVisible();
    expect(screen.getByText('Rate review')).toBeVisible();
    expect(document.body.textContent).not.toContain('HIDDEN');
    await userEvent.type(screen.getByRole('textbox', { name: /Decision reason/ }), 'Verified');
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(api.admin.approvals.approve).toHaveBeenCalledWith('approval-1', { reason: 'Verified' });
    expect(await screen.findByText('Approved and executed')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Decision history' })).toBeVisible();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('supports loading, failure, retry and empty states', async () => {
    let reject;
    api.admin.approvals.list.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })).mockResolvedValueOnce([]);
    render(<AdminApprovalInbox api={api} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    reject(new Error('HIDDEN-SERVER-DETAILS'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(await screen.findByText('No approval requests are waiting for review.')).toBeVisible();
    expect(document.body.textContent).not.toContain('HIDDEN');
  });

  it('retains decision input after failure and prevents duplicate submissions', async () => {
    let reject;
    api.admin.approvals.reject.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    render(<AdminApprovalInbox api={api} />);
    await screen.findByText('5%');
    await userEvent.type(screen.getByRole('textbox'), 'Needs evidence');
    await userEvent.dblClick(screen.getByRole('button', { name: 'Reject' }));
    expect(api.admin.approvals.reject).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Recording decision…' })).toBeDisabled();
    reject(new Error('HIDDEN-ERROR'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Decision could not be confirmed');
    expect(screen.getByRole('textbox')).toHaveValue('Needs evidence');
    await waitFor(() => expect(api.admin.approvals.list).toHaveBeenCalledTimes(2));
  });

  it.each([
    [{ requestedByStaffId: 'checker' }, 'A different administrator must review your request.'],
    [{ expiresAt: '2020-01-01' }, 'Expired'],
    [{ status: 'REJECTED', decisionReason: 'Not justified' }, 'Rejected'],
  ])('prevents decisions for unavailable requests', async (changes, message) => {
    api.admin.approvals.list.mockResolvedValue([{ ...request, ...changes }]);
    render(<AdminApprovalInbox api={api} />);
    expect(await screen.findByText(message)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('does not load records for an insurer session', () => {
    useStore.setState({ staffSession: { id: 'insurer-user', staffRole: 'INSURER_ADMIN' } });
    render(<AdminApprovalInbox api={api} />);
    expect(screen.getByRole('alert')).toHaveTextContent('administrator session');
    expect(api.admin.approvals.list).not.toHaveBeenCalled();
  });

  it('allows an ordinary administrator to reject but not approve deletion', async () => {
    useStore.setState({ staffSession: { id: 'checker', staffRole: 'ADMIN' } });
    api.admin.approvals.list.mockResolvedValue([{ ...request, action: 'INSURER_DELETE' }]);
    api.admin.approvals.reject.mockResolvedValue({ ...request, action: 'INSURER_DELETE', status: 'REJECTED' });
    render(<AdminApprovalInbox api={api} />);
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    expect(api.admin.approvals.reject).toHaveBeenCalledWith(request.id, { reason: '' });
    expect(await screen.findByText('Rejected')).toBeVisible();
  });
});
