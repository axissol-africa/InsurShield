import { beforeEach, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import BadgeGovernance from './BadgeGovernance';

const identity = vi.hoisted(() => ({ session: { id: 'admin', staffRole: 'ADMIN' } }));
vi.mock('@/store', () => ({ useStore: (select) => select({ staffSession: identity.session }) }));
const insurers = [{ id: 'one', name: 'First insurer' }, { id: 'two', name: 'Second insurer' }];
const record = { insurerId: 'one', generation: 0, suspendedAt: null, suspensionReason: null, latest: null };
let transport;
beforeEach(() => {
  identity.session = { id: 'admin', staffRole: 'ADMIN' };
  transport = { get: vi.fn().mockResolvedValue(record), update: vi.fn() };
});
const choose = async (user, value = 'one') => user.selectOptions(screen.getByRole('combobox', { name: 'Insurer' }), value);

it.each(['SUPPORT', 'INSURER_ADMIN', undefined])('denies %s without requesting data', (staffRole) => {
  identity.session = { id: 'staff', staffRole };
  render(<BadgeGovernance insurers={insurers} transport={transport} />);
  expect(screen.getByRole('alert')).toHaveTextContent('do not have permission');
  expect(transport.get).not.toHaveBeenCalled();
});
it('handles an empty insurer list and waits for selection', () => {
  const { rerender } = render(<BadgeGovernance transport={transport} />);
  expect(screen.getByText('No insurers are available to manage.')).toBeVisible();
  rerender(<BadgeGovernance insurers={insurers} transport={transport} />);
  expect(screen.getByText(/Choose an insurer to view/)).toBeVisible();
  expect(transport.get).not.toHaveBeenCalled();
});
it('shows loading, retries a failed read and displays an absent evaluation', async () => {
  const user = userEvent.setup();
  transport.get.mockRejectedValueOnce(new Error('Access denied'));
  render(<BadgeGovernance insurers={insurers} transport={transport} />);
  await choose(user);
  expect(await screen.findByRole('alert')).toHaveTextContent('Access denied');
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No performance evaluation has been calculated yet.')).toBeVisible();
});
it('requires a reason, prevents duplicates and uses the updated server view', async () => {
  const user = userEvent.setup();
  let resolve;
  transport.update.mockImplementation(() => new Promise((done) => { resolve = done; }));
  render(<BadgeGovernance insurers={insurers} transport={transport} />);
  await choose(user);
  const confirm = await screen.findByRole('button', { name: 'Confirm suspension' });
  expect(confirm).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: 'Decision reason' }), '  Evidence verified  ');
  await user.dblClick(confirm);
  expect(transport.update).toHaveBeenCalledExactlyOnceWith('one', { suspended: true, reason: 'Evidence verified', expectedGeneration: 0 });
  expect(screen.getByRole('button', { name: 'Saving decision…' })).toBeDisabled();
  await act(async () => resolve({ ...record, generation: 1, suspendedAt: '2026-11-01T12:00:00Z', suspensionReason: 'Evidence verified' }));
  expect(screen.getByText('Eligibility suspended')).toBeVisible();
  expect(screen.getByText('Evidence verified')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Confirm resume' })).toBeDisabled();
});
it('lets a super admin resume, preserving input on errors and explaining recalculation', async () => {
  identity.session.staffRole = 'SUPER_ADMIN';
  transport.get.mockResolvedValue({ ...record, generation: 1, suspendedAt: '2026-11-01T12:00:00Z', suspensionReason: 'Review needed', latest: { qualifies: true, calculatedAt: '2026-10-01T12:00:00Z', expiresAt: '2026-11-01T12:00:00Z', sampleCount: 30, onTimeCount: 29, ruleVersion: 2 } });
  transport.update.mockRejectedValueOnce(new Error('Try again later')).mockResolvedValue(record);
  const user = userEvent.setup();
  render(<BadgeGovernance insurers={insurers} transport={transport} />);
  await choose(user);
  expect(await screen.findByText('Qualified at last calculation')).toBeVisible();
  expect(screen.getByText(/Resuming does not restore/)).toBeVisible();
  const reason = screen.getByRole('textbox', { name: 'Decision reason' });
  await user.type(reason, 'Review completed');
  await user.click(screen.getByRole('button', { name: 'Confirm resume' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Try again later');
  expect(reason).toHaveValue('Review completed');
  await user.click(screen.getByRole('button', { name: 'Confirm resume' }));
  expect(await screen.findByRole('status')).toHaveTextContent('new qualifying calculation');
  expect(transport.update).toHaveBeenLastCalledWith('one', { suspended: false, reason: 'Review completed', expectedGeneration: 1 });
});
it('requires refreshing and reviewing a newer suspension before another decision', async () => {
  const caseA = { ...record, generation: 1, suspendedAt: '2026-11-01T12:00:00Z', suspensionReason: 'First case' };
  const caseB = { ...caseA, generation: 3, suspensionReason: 'A newer case' };
  transport.get.mockResolvedValueOnce(caseA).mockResolvedValueOnce(caseB);
  transport.update.mockRejectedValue(Object.assign(new Error('Badge eligibility changed.'), { code: 'BADGE_STATE_CHANGED' }));
  const user = userEvent.setup();
  render(<BadgeGovernance insurers={insurers} transport={transport} />);
  await choose(user);
  const resume = await screen.findByRole('button', { name: 'Confirm resume' });
  await user.type(screen.getByRole('textbox', { name: 'Decision reason' }), 'Case closed');
  await user.click(resume);
  expect(await screen.findByRole('alert')).toHaveTextContent('Badge eligibility changed.');
  expect(resume).toBeDisabled();
  expect(transport.update).toHaveBeenCalledExactlyOnceWith('one', { suspended: false, reason: 'Case closed', expectedGeneration: 1 });
  await user.click(screen.getByRole('button', { name: 'Refresh badge status' }));
  expect(await screen.findByText('A newer case')).toBeVisible();
  expect(screen.getByRole('textbox', { name: 'Decision reason' })).toHaveValue('');
  expect(screen.getByRole('button', { name: 'Confirm resume' })).toBeDisabled();
});

it('ignores a delayed read after insurer selection changes and clears data on identity changes', async () => {
  let resolve;
  transport.get.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const user = userEvent.setup();
  const { rerender } = render(<BadgeGovernance insurers={insurers} transport={transport} />);
  await choose(user);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  await choose(user, 'two');
  await screen.findByText('Eligibility not suspended');
  await act(async () => resolve({ ...record, suspensionReason: 'Stale private reason' }));
  expect(screen.queryByText('Stale private reason')).not.toBeInTheDocument();
  identity.session = { id: 'another', staffRole: 'ADMIN' };
  rerender(<BadgeGovernance insurers={insurers} transport={transport} />);
  await waitFor(() => expect(screen.queryByText('Eligibility not suspended')).not.toBeInTheDocument());
  expect(screen.getByRole('combobox')).toHaveValue('');
});
