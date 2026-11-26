import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { downloadCsv } from '@/lib/downloadCsv';
import ReportsWorkspace from './ReportsWorkspace';

vi.mock('@/lib/downloadCsv', () => ({ downloadCsv: vi.fn() }));

const report = {
  generatedAt: '2026-11-25T12:00:00Z',
  metrics: [{ key: 'paid', label: 'Confirmed premium', value: '900719925474099331', unit: 'minorUnits', currency: 'ZMW', definition: 'Paid premiums in the selected period.' }],
  limitations: ['The commercial model is awaiting approval.'],
};

describe('reports workspace', () => {
  it('keeps finance figures exact and exports the period that was generated', async () => {
    const transport = { get: vi.fn().mockResolvedValue(report), exportCsv: vi.fn().mockResolvedValue('metric,value') };
    const user = userEvent.setup();
    render(<ReportsWorkspace scopes={['finance']} transport={transport} />);
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-09-01' } });
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-09-30' } });
    await user.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('ZMW 9,007,199,254,740,993.31')).toBeVisible();
    expect(screen.getByText('Your organisation only')).toBeVisible();
    expect(screen.getByText(report.limitations[0])).toBeVisible();
    expect(transport.get).toHaveBeenCalledWith('finance', { from: '2026-09-01', to: '2026-09-30' });
    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(transport.exportCsv).toHaveBeenCalledWith('finance', { from: '2026-09-01', to: '2026-09-30' });
    expect(downloadCsv).toHaveBeenCalledWith('insurshield-finance-2026-09-01-to-2026-09-30.csv', 'metric,value');
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-10-02' } });
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeDisabled();
  });

  it('surfaces a failed report and retries for the same date range', async () => {
    const transport = { get: vi.fn().mockRejectedValueOnce(new Error('Could not load report.')).mockResolvedValue({ metrics: [] }) };
    const user = userEvent.setup();
    render(<ReportsWorkspace scopes={['admin']} transport={transport} />);
    await user.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load report.');
    await user.click(screen.getByRole('button', { name: 'Generate report' }));
    expect(await screen.findByText('No activity was recorded for this period.')).toBeVisible();
    expect(transport.get.mock.calls[1]).toEqual(transport.get.mock.calls[0]);
  });
});
