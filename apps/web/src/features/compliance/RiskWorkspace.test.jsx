import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RiskWorkspace from './RiskWorkspace';

const staffId = '11111111-1111-4111-8111-111111111111';
const workflowId = '22222222-2222-4222-8222-222222222222';
const item = {
  id: '33333333-3333-4333-8333-333333333333', workflowType: 'QUOTE', workflowId,
  evidenceReference: `quote:${workflowId}`, severity: 'HIGH', reason: 'Check the quoted evidence.',
  nextAction: 'Review supporting documents', status: 'OPEN', version: 3, ownerStaffId: null,
};
function transport(items = [item]) {
  return { list: vi.fn().mockResolvedValue({ items, next: null }), refer: vi.fn().mockResolvedValue(item), assign: vi.fn().mockResolvedValue({ ...item, version: 4 }), resolve: vi.fn().mockResolvedValue({ ...item, version: 4, status: 'RESOLVED' }) };
}

async function fill(user, input, value) {
  await user.click(input);
  await user.paste(value);
}

async function openActions(user) {
  await user.click(await screen.findByRole('button', { name: /Review actions/ }));
}

describe('RiskWorkspace', () => {
  it('creates a referral with canonical workflow evidence and trimmed reasons', async () => {
    const api = transport([]);
    const user = userEvent.setup();
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    await user.selectOptions(await screen.findByLabelText('Workflow type'), 'RECONCILIATION_ITEM');
    await fill(user, screen.getByLabelText('Workflow ID'), workflowId);
    expect(screen.getByLabelText('Evidence reference')).toHaveValue(`reconciliation:${workflowId}`);
    await user.selectOptions(screen.getByLabelText('Severity'), 'HIGH');
    await fill(user, screen.getByLabelText('Referral reason'), '  Review the payment evidence.  ');
    await fill(user, screen.getByLabelText('Referral next action'), '  Check supporting records  ');
    await user.click(screen.getByRole('button', { name: 'Create referral' }));
    await waitFor(() => expect(api.refer).toHaveBeenCalledWith({ workflowType: 'RECONCILIATION_ITEM', workflowId, evidenceReference: `reconciliation:${workflowId}`, severity: 'HIGH', reason: 'Review the payment evidence.', nextAction: 'Check supporting records' }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('assigns the accountable reviewer with the current version', async () => {
    const api = transport();
    const user = userEvent.setup();
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    await openActions(user);
    await user.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(api.assign).toHaveBeenCalledWith(item.id, { expectedVersion: 3, staffId, nextAction: item.nextAction }));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('records a versioned metadata-only resolution', async () => {
    const api = transport();
    const user = userEvent.setup();
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    await openActions(user);
    await user.selectOptions(screen.getByLabelText('Resolution outcome'), 'REFERRED');
    await fill(user, screen.getByLabelText('Resolution reason'), 'Refer to the compliance team.');
    await fill(user, screen.getByLabelText('Resolution next action'), 'Contact compliance');
    await user.click(screen.getByRole('button', { name: 'Save resolution' }));
    await waitFor(() => expect(api.resolve).toHaveBeenCalledWith(item.id, { expectedVersion: 3, outcome: 'REFERRED', reason: 'Refer to the compliance team.', nextAction: 'Contact compliance' }));
    expect(screen.getAllByText(/Metadata-only outcome/).length).toBeGreaterThan(0);
  });

  it('blocks stale decisions until reload and uses the refreshed version', async () => {
    const api = transport();
    api.assign.mockRejectedValueOnce(Object.assign(new Error('Stale'), { status: 409, code: 'RISK_REVIEW_STALE' }));
    const user = userEvent.setup();
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    await openActions(user);
    await user.click(screen.getByRole('button', { name: 'Save assignment' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This review changed');
    expect(screen.getByRole('button', { name: 'Save assignment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save resolution' })).toBeDisabled();
    api.list.mockResolvedValue({ items: [{ ...item, version: 4 }], next: null });
    await user.click(screen.getByRole('button', { name: 'Reload reviews' }));
    await openActions(user);
    await user.click(screen.getByRole('button', { name: 'Save assignment' }));
    await waitFor(() => expect(api.assign).toHaveBeenLastCalledWith(item.id, expect.objectContaining({ expectedVersion: 4 })));
  });

  it('uses cursor pagination and resets the cursor when status changes', async () => {
    const api = transport();
    api.list.mockResolvedValue({ items: [item], next: item.id });
    const user = userEvent.setup();
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ limit: 20, cursor: item.id }));
    await user.selectOptions(screen.getByLabelText('Review status'), 'RESOLVED');
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ limit: 20, status: 'RESOLVED' }));
    expect(await screen.findByRole('button', { name: 'Previous' })).toBeDisabled();
  });

  it('shows access denial without exposing referral or decision controls', async () => {
    const api = transport();
    api.list.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have access');
    expect(screen.queryByRole('button', { name: 'Create referral' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review actions/ })).not.toBeInTheDocument();
  });

  it('preserves referral input after a server error', async () => {
    const api = transport([]);
    api.refer.mockRejectedValue(new Error('An open review already exists for this record.'));
    const user = userEvent.setup();
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    await fill(user, await screen.findByLabelText('Workflow ID'), workflowId);
    await fill(user, screen.getByLabelText('Referral reason'), 'Review the quoted evidence.');
    await fill(user, screen.getByLabelText('Referral next action'), 'Check records');
    await user.click(screen.getByRole('button', { name: 'Create referral' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('An open review already exists');
    expect(screen.getByLabelText('Workflow ID')).toHaveValue(workflowId);
    expect(screen.getByLabelText('Referral reason')).toHaveValue('Review the quoted evidence.');
  });

  it('renders resolved reviews as read-only with the recorded outcome', async () => {
    const api = transport([{ ...item, status: 'RESOLVED', outcome: 'NO_ACTION', resolutionReason: 'Evidence checked and accepted.', resolvedByStaffId: staffId }]);
    render(<RiskWorkspace staffId={staffId} transport={api} />);
    expect(await screen.findByText('Outcome · No action (metadata only)')).toBeInTheDocument();
    expect(screen.getByText('Evidence checked and accepted.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Review actions/ })).not.toBeInTheDocument();
  });
});
