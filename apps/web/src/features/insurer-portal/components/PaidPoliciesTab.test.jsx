import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaidPoliciesTab from './PaidPoliciesTab';
import { AWAITING_CERTIFICATE } from '@/features/insurer-portal/portal';
import { openDocument } from '@/lib/files';
import { downloadPolicyCertificate } from '@/lib/policyDocuments';

vi.mock('@/lib/files', async (original) => ({ ...(await original()), openDocument: vi.fn() }));
vi.mock('@/lib/policyDocuments', () => ({ downloadPolicyCertificate: vi.fn() }));

const waiting = {
  policyNumber: 'PA-2026-011293', quoteRequestId: 'QR-774510', status: AWAITING_CERTIFICATE, customerName: 'Mwiza Banda', customerPhone: '0970123456',
  vehicle: '2020 Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' }, coverage: 'Comprehensive', premium: 10650, receivedAt: new Date().toISOString(), policyDates: null,
};
const certificateDocument = { name: 'certificate.pdf', type: 'application/pdf', size: 2048, dataUrl: 'data:application/pdf;base64,AAAA' };
const active = { ...waiting, policyNumber: 'PA-2026-000001', quoteRequestId: 'QR-000001', status: 'Active', customerName: 'Chanda Phiri', certificateDocument };
const legacy = { ...waiting, policyNumber: 'PA-2025-000002', quoteRequestId: undefined, status: 'Active', customerName: 'Bwalya Mumba' };

beforeEach(() => vi.clearAllMocks());

describe('PaidPoliciesTab', () => {
  it('opens on the policies waiting for a certificate and starts the issue for the chosen one', async () => {
    const onIssue = vi.fn();
    render(<PaidPoliciesTab policies={[waiting, active]} onIssue={onIssue} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Paid policies' })).toBeVisible();
    expect(screen.getByRole('tab', { name: /Awaiting certificate/ })).toHaveAttribute('aria-selected', 'true');
    const table = screen.getByRole('table', { name: 'Policies awaiting a certificate' });
    const row = within(table).getByRole('row', { name: /PA-2026-011293/ });
    expect(row).toHaveTextContent('QR-774510');
    expect(row).toHaveTextContent('Mwiza Banda');
    expect(row).toHaveTextContent('2020 Toyota Hilux');
    expect(row).toHaveTextContent('BAA 1234');
    expect(row).toHaveTextContent('ZMW 10,650.00');
    expect(screen.queryByText('PA-2026-000001')).not.toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Review & issue policy' }));
    expect(onIssue).toHaveBeenCalledExactlyOnceWith(waiting);
  });

  it('serves the customer who paid first, and says how long each has waited', () => {
    const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000).toISOString();
    const earlier = { ...waiting, policyNumber: 'PA-2026-000900', customerName: 'Natasha Mwansa', receivedAt: minutesAgo(180) };
    render(<PaidPoliciesTab policies={[{ ...waiting, receivedAt: minutesAgo(18) }, earlier]} onIssue={vi.fn()} />);

    const rows = within(screen.getByRole('table', { name: 'Policies awaiting a certificate' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Natasha Mwansa');
    expect(rows[0]).toHaveTextContent('Paid 3h ago');
    expect(rows[1]).toHaveTextContent('Mwiza Banda');
    expect(rows[1]).toHaveTextContent('Paid 18m ago');
  });

  it('lists issued policies with the certificate the customer holds', async () => {
    const user = userEvent.setup();
    render(<PaidPoliciesTab policies={[waiting, active, legacy]} onIssue={vi.fn()} />);

    await user.click(screen.getByRole('tab', { name: /Issued/ }));
    const table = await screen.findByRole('table', { name: 'Issued policies' });
    const issued = within(table).getByRole('row', { name: /PA-2026-000001/ });
    expect(issued).toHaveTextContent('Active');
    await user.click(within(issued).getByRole('button', { name: 'View certificate' }));
    expect(openDocument).toHaveBeenCalledExactlyOnceWith(certificateDocument);

    // A policy issued before certificates were uploaded has a generated one.
    const older = within(table).getByRole('row', { name: /PA-2025-000002/ });
    expect(older).toHaveTextContent('Legacy policy — quote reference unavailable');
    await user.click(within(older).getByRole('button', { name: 'Download certificate' }));
    expect(downloadPolicyCertificate).toHaveBeenCalledExactlyOnceWith(legacy);
  });

  it('opens on issued policies when nothing is waiting', () => {
    render(<PaidPoliciesTab policies={[active]} onIssue={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /Issued/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('table', { name: 'Issued policies' })).toBeVisible();
  });

  it('follows policies that arrive after the screen opened', () => {
    const { rerender } = render(<PaidPoliciesTab policies={[]} onIssue={vi.fn()} />);
    expect(screen.getByText('No paid policies received yet')).toBeVisible();

    rerender(<PaidPoliciesTab policies={[waiting, active]} onIssue={vi.fn()} />);
    expect(screen.getByRole('tab', { name: /Awaiting certificate/ })).toHaveAttribute('aria-selected', 'true');
  });

  describe('on a phone', () => {
    const wide = window.innerWidth;
    afterEach(() => { window.innerWidth = wide; });

    it('stacks each policy with its action in reach', async () => {
      window.innerWidth = 375;
      const onIssue = vi.fn();
      render(<PaidPoliciesTab policies={[{ ...waiting, insurerQuoteReference: 'PA-Q-2026-00412' }, active]} onIssue={onIssue} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      const card = within(screen.getByRole('list', { name: 'Policies awaiting a certificate' })).getByRole('listitem');
      // The insurer's own reference is what they search their system by, so a phone shows it too.
      for (const text of ['PA-2026-011293', 'QR-774510', 'Your ref: PA-Q-2026-00412', 'Mwiza Banda', '2020 Toyota Hilux', 'BAA 1234', 'ZMW 10,650.00']) expect(card).toHaveTextContent(text);
      await userEvent.click(within(card).getByRole('button', { name: 'Review & issue policy' }));
      expect(onIssue).toHaveBeenCalledExactlyOnceWith({ ...waiting, insurerQuoteReference: 'PA-Q-2026-00412' });

      await userEvent.click(screen.getByRole('tab', { name: /Issued/ }));
      const issued = within(await screen.findByRole('list', { name: 'Issued policies' })).getByRole('listitem');
      expect(issued).toHaveTextContent('Active');
      expect(within(issued).getByRole('button', { name: 'View certificate' })).toBeVisible();
    });
  });
});
