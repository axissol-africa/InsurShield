import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettlementsTab from './SettlementsTab';
import { downloadCsv } from '@/lib/downloadCsv';

vi.mock('@/lib/downloadCsv', () => ({ downloadCsv: vi.fn() }));

const row = { id: 's1', reference: 'SET-1', period: '2026-10', netPayable: 1600, grossPremium: 2000, fees: 10, refunds: 200, adjustments: -50, commission: 150, commissionBps: 750 };

describe('SettlementsTab', () => {
  it("lists the insurer's finalised settlements, opens one and downloads its export", async () => {
    const api = {
      settlements: {
        listForInsurer: vi.fn().mockResolvedValue([row]),
        getForInsurer: vi.fn().mockResolvedValue({ ...row, lines: [{ kind: 'PAYMENT', reference: 'TXN-1', occurredAt: '2026-10-15T08:00:00.000Z', amount: 1000, fee: 5 }] }),
        exportCsv: vi.fn().mockResolvedValue('net_payable_zmw,1600.00\n'),
      },
    };
    render(<SettlementsTab api={api} />);
    expect(await screen.findByText('SET-1')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(await screen.findByRole('table', { name: 'Settlement lines' })).toHaveTextContent('TXN-1');
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(downloadCsv).toHaveBeenCalledWith('SET-1-2026-10.csv', 'net_payable_zmw,1600.00\n');
  });

  it('says so when nothing has been finalised yet', async () => {
    render(<SettlementsTab api={{ settlements: { listForInsurer: vi.fn().mockResolvedValue([]) } }} />);
    expect(await screen.findByText('No settlement has been finalised for you yet.')).toBeInTheDocument();
  });
});
