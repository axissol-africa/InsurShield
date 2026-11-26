import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import PrivacyWorkspace, { CustomerPrivacyRequests } from './PrivacyWorkspace';

it('lets customers record a request without sending a customer ID or displaying staff reasons', async () => {
  const item = { id: 'PRIV-1', status: 'SUBMITTED', kind: 'ACCESS' };
  const transport = {
    mine: vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValue({ items: [item], pageSize: 25 }),
    submit: vi.fn().mockResolvedValue(item),
  };
  const user = userEvent.setup();
  render(<CustomerPrivacyRequests transport={transport} />);
  expect(await screen.findByText('You have no privacy requests yet.')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Submit privacy request' }));
  expect(transport.submit).toHaveBeenCalledExactlyOnceWith({ kind: 'ACCESS' });
  expect(await screen.findByText(item.id)).toBeVisible();
  expect(screen.getByText('Submitted')).toBeVisible();
  expect(screen.queryByLabelText('Customer ID')).not.toBeInTheDocument();
});

it('applies a retention hold to the current version with evidence and a decision reference', async () => {
  const request = { id: 'private-1', kind: 'RETENTION_REVIEW', status: 'VERIFIED', version: 3, customerId: 'CUST-1', ownerStaffId: 'reviewer', identityVerifiedAt: '2026-11-25T12:00:00Z', held: false };
  const transport = {
    list: vi.fn().mockResolvedValue({ items: [request], pageSize: 25 }),
    detail: vi.fn().mockResolvedValueOnce({ request, events: [], pageSize: 25 })
      .mockResolvedValue({ request: { ...request, held: true, version: 4 }, events: [], pageSize: 25 }),
    hold: vi.fn().mockResolvedValue({}),
  };
  const user = userEvent.setup();
  render(<PrivacyWorkspace staffId="reviewer" transport={transport} />);
  await user.click(await screen.findByRole('button', { name: 'Open request private-1' }));
  await user.click(await screen.findByRole('button', { name: 'Apply retention hold' }));
  await user.type(screen.getByLabelText('Decision reference'), 'DEC-008');
  await user.type(screen.getByLabelText('Evidence reference'), 'EVD-022');
  await user.type(screen.getByLabelText('Reason'), 'The data review is ongoing.');
  await user.click(screen.getByRole('button', { name: 'Save decision' }));
  expect(transport.hold).toHaveBeenCalledExactlyOnceWith('private-1', { version: 3, decisionReference: 'DEC-008', evidenceReference: 'EVD-022', rationale: 'The data review is ongoing.', held: true });
  expect(await screen.findByText('Hold active')).toBeVisible();
});
