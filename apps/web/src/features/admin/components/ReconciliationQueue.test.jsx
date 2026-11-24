import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useStore } from '@/store';
import ReconciliationQueue from './ReconciliationQueue';

const item = (change = {}) => ({
  id: '11111111-1111-4111-8111-111111111111', kind: 'ISSUANCE_FAILED', status: 'OPEN', outcome: null, amount: 1234.56,
  reason: 'Prestige Assurance could not issue the policy.', openedAt: '2026-11-20T10:00:00.000Z', ageDays: 4, owner: null,
  insurer: 'Prestige Assurance', policyNumber: 'POL-1',
  payment: { transactionId: 'TXN-1', status: 'CONFIRMED', amount: 1234.56, refunded: 0, refundable: true }, refunds: [], resolutionNote: null, resolvedAt: null,
  ...change,
});
const api = (items) => ({
  admin: {
    reconciliation: {
      list: vi.fn().mockResolvedValue({ items, next: null }),
      assign: vi.fn().mockResolvedValue({}),
      resolve: vi.fn().mockResolvedValue({}),
      proposeRefund: vi.fn().mockResolvedValue({}),
    },
  },
});

beforeEach(() => useStore.setState({ staffSession: { id: 'staff-me', role: 'admin', staffRole: 'ADMIN', name: 'Me' } }));

describe('ReconciliationQueue', () => {
  it('shows each open item with its amount, age, owner and payment', async () => {
    const client = api([item()]);
    render(<ReconciliationQueue api={client} />);
    const card = (await screen.findByRole('heading', { name: 'Policy not issued' })).closest('[data-slot="card"]');
    expect(within(card).getByText('ZMW 1,234.56')).toBeInTheDocument();
    expect(within(card).getByText(/4 days ago/)).toBeInTheDocument();
    expect(within(card).getByText(/Nobody owns it yet/)).toBeInTheDocument();
    expect(within(card).getByText('TXN-1')).toBeInTheDocument();
    expect(client.admin.reconciliation.list).toHaveBeenCalledWith({ status: 'OPEN' });
  });

  it('takes an item, and proposes a refund of what is left for a second administrator to approve', async () => {
    const client = api([item({ payment: { transactionId: 'TXN-1', status: 'CONFIRMED', amount: 1234.56, refunded: 234.56, refundable: true } })]);
    render(<ReconciliationQueue api={client} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Take it' }));
    expect(client.admin.reconciliation.assign).toHaveBeenCalledWith(item().id, 'staff-me');

    await userEvent.click(screen.getByRole('button', { name: 'Propose a refund' }));
    const form = screen.getByRole('form', { name: 'Propose a refund' });
    expect(within(form).getByLabelText('Amount (ZMW) *')).toHaveValue(1000);
    expect(within(form).getByLabelText('Reason *')).toHaveValue('ISSUANCE_FAILED');
    const send = within(form).getByRole('button', { name: 'Send for approval' });
    expect(send).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('What happened, for the approver *'), 'The insurer could not issue it.');
    await userEvent.click(send);
    expect(client.admin.reconciliation.proposeRefund).toHaveBeenCalledWith('TXN-1', {
      amount: 1000, reasonCode: 'ISSUANCE_FAILED', reason: 'The insurer could not issue it.', reconciliationItemId: item().id,
    });
  });

  it('offers no second refund while one is in flight, and resolves only with an outcome and a note', async () => {
    const client = api([item({ refunds: [{ id: 'r1', amount: 1234.56, status: 'PROPOSED', failureReason: null }] })]);
    render(<ReconciliationQueue api={client} />);
    expect(await screen.findByText('Waiting for approval')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose a refund' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const form = screen.getByRole('form', { name: 'Resolve the item' });
    await userEvent.selectOptions(within(form).getByLabelText('Outcome *'), 'WRITTEN_OFF');
    expect(within(form).getByRole('button', { name: 'Resolve' })).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('What was done *'), 'Agreed with finance to write it off.');
    await userEvent.click(within(form).getByRole('button', { name: 'Resolve' }));
    expect(client.admin.reconciliation.resolve).toHaveBeenCalledWith(item().id, 'WRITTEN_OFF', 'Agreed with finance to write it off.');
  });

  it('explains that a payment from before the provider is refunded outside InsurShield', async () => {
    render(<ReconciliationQueue api={api([item({ payment: { transactionId: 'TXN-OLD', status: 'CONFIRMED', amount: 100, refunded: 0, refundable: false } })])} />);
    expect(await screen.findByText(/Refund it outside InsurShield/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Propose a refund' })).not.toBeInTheDocument();
  });

  it('says plainly when nothing is waiting', async () => {
    render(<ReconciliationQueue api={api([])} />);
    expect(await screen.findByText('Nothing here. Every payment is accounted for.')).toBeInTheDocument();
  });
});
