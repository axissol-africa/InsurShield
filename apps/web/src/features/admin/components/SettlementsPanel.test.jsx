import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettlementsPanel from './SettlementsPanel';
import { downloadCsv } from '@/lib/downloadCsv';

vi.mock('@/lib/downloadCsv', () => ({ downloadCsv: vi.fn() }));

const settlement = {
  id: 's1', reference: 'SET-1', insurerId: 'i1', insurer: 'Prestige Assurance', period: '2026-10', status: 'DRAFT',
  grossPremium: 2000, fees: 10, refunds: 200, adjustments: -50, commission: 150, commissionBps: 750, netPayable: 1600,
  lines: [{ kind: 'PAYMENT', reference: 'TXN-1', occurredAt: '2026-10-15T08:00:00.000Z', amount: 1000, fee: 5 }],
};
let api;
beforeEach(() => {
  vi.clearAllMocks();
  api = {
    admin: {
      settlements: {
        list: vi.fn().mockResolvedValue([]),
        draft: vi.fn().mockResolvedValue(settlement),
        get: vi.fn().mockResolvedValue(settlement),
        finalise: vi.fn().mockResolvedValue({ id: 's1', status: 'PROPOSED' }),
        exportCsv: vi.fn().mockResolvedValue('settlement,SET-1\n'),
      },
      reconciliation: { proposeAdjustment: vi.fn().mockResolvedValue({}) },
    },
  };
});

describe('SettlementsPanel', () => {
  it('draws up a month, shows how the net is reached, and sends it for approval', async () => {
    render(<SettlementsPanel api={api} insurers={[{ id: 'i1', name: 'Prestige Assurance' }]} />);
    await userEvent.clear(screen.getByLabelText('Month'));
    await userEvent.type(screen.getByLabelText('Month'), '2026-10');
    await userEvent.click(screen.getByRole('button', { name: 'Draw up' }));
    expect(api.admin.settlements.draft).toHaveBeenCalledWith('i1', '2026-10');

    const card = (await screen.findByRole('heading', { name: 'Prestige Assurance, 2026-10' })).closest('[data-slot="card"]');
    expect(within(card).getByText('Commission (7.50%)')).toBeInTheDocument();
    expect(within(card).getByText('ZMW 1,600.00')).toBeInTheDocument();
    expect(within(card).getByRole('table', { name: 'Settlement lines' })).toHaveTextContent('TXN-1');

    await userEvent.click(within(card).getByRole('button', { name: 'Download CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith('SET-1-2026-10.csv', 'settlement,SET-1\n');

    const send = within(card).getByRole('button', { name: 'Send for approval' });
    expect(send).toBeDisabled();
    await userEvent.type(within(card).getByLabelText('What you checked, for the approver *'), 'Matched the provider statement.');
    await userEvent.click(send);
    expect(api.admin.settlements.finalise).toHaveBeenCalledWith('s1', 'Matched the provider statement.');
    expect(await within(card).findByText('Waiting for approval')).toBeInTheDocument();
  });

  it('proposes a signed adjustment for a second administrator to approve', async () => {
    render(<SettlementsPanel api={api} insurers={[{ id: 'i1', name: 'Prestige Assurance' }]} />);
    const form = screen.getByRole('form', { name: 'Propose an adjustment' });
    await userEvent.type(within(form).getByLabelText('Amount (ZMW) *'), '-150.25');
    await userEvent.selectOptions(within(form).getByLabelText('Kind *'), 'SETTLEMENT_CORRECTION');
    await userEvent.type(within(form).getByLabelText('Why, for the approver *'), 'September paid a levy by mistake.');
    await userEvent.click(within(form).getByRole('button', { name: 'Send for approval' }));
    expect(api.admin.reconciliation.proposeAdjustment).toHaveBeenCalledWith({ insurerId: 'i1', amount: -150.25, kind: 'SETTLEMENT_CORRECTION', reason: 'September paid a levy by mistake.' });
    expect(await within(form).findByRole('status')).toHaveTextContent('Sent for approval');
  });
});
