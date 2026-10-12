import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NcdTab from './NcdTab';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';

vi.mock('@/api', () => ({ api: { ncd: { decide: vi.fn() } } }));
vi.mock('@/api/sync', () => ({ hydrateInsurerPortal: vi.fn().mockResolvedValue(undefined) }));

const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();
const submitted = { id: 'NCD-1', applicationNumber: 'NCD-2026-0001', fullName: 'Mwiza Banda', phone: '0970123456', policyNumber: 'PA-2025-000777', yearsClaimFree: 3, status: 'Submitted', submittedAt: daysAgo(3) };
const reviewing = { id: 'NCD-2', applicationNumber: 'NCD-2026-0002', fullName: 'Chanda Phiri', phone: '0977334455', policyNumber: 'PA-2024-000111', yearsClaimFree: 1, status: 'Under Review', submittedAt: daysAgo(7) };
const approved = { id: 'NCD-3', applicationNumber: 'NCD-2026-0003', fullName: 'Bwalya Mumba', policyNumber: 'PA-2023-000222', yearsClaimFree: 2, status: 'Approved', approvedCode: 'NCD-20-BWALYA', submittedAt: daysAgo(20) };
const rejected = { id: 'NCD-4', applicationNumber: 'NCD-2026-0004', fullName: 'Thandiwe Zulu', policyNumber: 'PA-2022-000333', yearsClaimFree: 1, status: 'Rejected', submittedAt: daysAgo(30) };

const openRows = () => within(screen.getByRole('table', { name: 'Open NCD applications' })).getAllByRole('row').slice(1);
const openRow = (name) => within(screen.getByRole('table', { name: 'Open NCD applications' })).getByRole('row', { name: new RegExp(name) });
const review = async (user, name) => {
  await user.click(within(openRow(name)).getByRole('button', { name: `Review & decide ${name}’s application` }));
  return screen.getByRole('dialog', { name: `Decide ${name}’s application` });
};

beforeEach(() => {
  vi.clearAllMocks();
  api.ncd.decide.mockResolvedValue(undefined);
});

describe('NcdTab', () => {
  it('opens on the applications waiting for a decision, longest wait first', () => {
    render(<NcdTab applications={[submitted, reviewing, approved, rejected]} />);

    expect(screen.getByRole('heading', { level: 1, name: 'NCD applications' })).toBeVisible();
    expect(screen.getByText('2 awaiting a decision')).toBeVisible();
    expect(screen.getByRole('tab', { name: /Open/ })).toHaveAttribute('aria-selected', 'true');

    const [first, second] = openRows();
    for (const text of ['Chanda Phiri', 'NCD-2026-0002', 'PA-2024-000111', '1 yr', '10%', 'Applied 7d ago', 'Under Review']) expect(first).toHaveTextContent(text);
    for (const text of ['Mwiza Banda', 'NCD-2026-0001', 'PA-2025-000777', '3 yrs', '30%', 'Applied 3d ago', 'Submitted']) expect(second).toHaveTextContent(text);
    expect(screen.queryByText('Bwalya Mumba')).not.toBeInTheDocument();
  });

  it('shows decided applications with the code that was issued', async () => {
    const user = userEvent.setup();
    render(<NcdTab applications={[submitted, approved, rejected]} />);

    await user.click(screen.getByRole('tab', { name: /Decided/ }));
    const table = await screen.findByRole('table', { name: 'Decided NCD applications' });
    expect(within(table).getByRole('row', { name: /Bwalya Mumba/ })).toHaveTextContent('NCD-20-BWALYA');
    expect(within(table).getByRole('row', { name: /Thandiwe Zulu/ })).toHaveTextContent('Rejected');
    expect(within(table).queryByRole('button', { name: /Review/ })).not.toBeInTheDocument();
  });

  it('puts what to check and every outcome on one surface, and sends nothing until a decision is confirmed', async () => {
    const user = userEvent.setup();
    render(<NcdTab applications={[submitted]} />);
    const dialog = await review(user, 'Mwiza Banda');

    expect(dialog).toHaveTextContent('Check policy PA-2025-000777 in your own system');
    for (const text of ['PA-2025-000777', '3 years', '30%', 'Applied 3d ago']) expect(within(dialog).getAllByText(text, { exact: false })[0]).toBeVisible();
    expect(within(dialog).getByRole('link', { name: '0970123456' })).toHaveAttribute('href', 'tel:0970123456');

    const decision = within(dialog).getByRole('radiogroup', { name: 'Your decision' });
    expect(within(decision).getByRole('radio', { name: /^Approve.*Issues a 30% no-claim discount code/ })).not.toBeChecked();
    expect(within(decision).getByRole('radio', { name: /^Keep under review/ })).toBeVisible();
    expect(within(decision).getByRole('radio', { name: /^Reject.*Closes the application without a discount/ })).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Confirm decision' })).toBeDisabled();

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.ncd.decide).not.toHaveBeenCalled();
  });

  it('approves an application, which issues its discount code', async () => {
    const user = userEvent.setup();
    render(<NcdTab applications={[submitted]} />);
    const dialog = await review(user, 'Mwiza Banda');

    await user.click(within(dialog).getByRole('radio', { name: /^Approve/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Approve & issue code' }));
    expect(api.ncd.decide).toHaveBeenCalledExactlyOnceWith('NCD-1', 'Approved');
    expect(hydrateInsurerPortal).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('rejects an application, or keeps it under review', async () => {
    const user = userEvent.setup();
    render(<NcdTab applications={[submitted]} />);

    let dialog = await review(user, 'Mwiza Banda');
    await user.click(within(dialog).getByRole('radio', { name: /^Keep under review/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Mark under review' }));
    expect(api.ncd.decide).toHaveBeenCalledExactlyOnceWith('NCD-1', 'Under Review');

    dialog = await review(user, 'Mwiza Banda');
    // A new review starts undecided, whatever was chosen last time.
    expect(within(dialog).getByRole('button', { name: 'Confirm decision' })).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: /^Reject/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Reject application' }));
    expect(api.ncd.decide).toHaveBeenLastCalledWith('NCD-1', 'Rejected');
  });

  it('does not offer to keep reviewing an application that is already under review', async () => {
    const user = userEvent.setup();
    render(<NcdTab applications={[reviewing]} />);
    const dialog = await review(user, 'Chanda Phiri');

    expect(within(dialog).getAllByRole('radio')).toHaveLength(2);
    expect(within(dialog).queryByRole('radio', { name: /^Keep under review/ })).not.toBeInTheDocument();
  });

  it('keeps the review open and explains when a decision could not be saved', async () => {
    const user = userEvent.setup();
    api.ncd.decide.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(undefined);
    render(<NcdTab applications={[submitted]} />);
    const dialog = await review(user, 'Mwiza Banda');

    await user.click(within(dialog).getByRole('radio', { name: /^Approve/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Approve & issue code' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('That decision could not be saved. Please try again.');
    expect(within(dialog).getByRole('radio', { name: /^Approve/ })).toBeChecked();

    await user.click(within(dialog).getByRole('button', { name: 'Approve & issue code' }));
    expect(api.ncd.decide).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('says so when there are no applications', () => {
    render(<NcdTab applications={[]} />);
    expect(screen.getByText('No NCD applications yet')).toBeVisible();
  });

  describe('on a phone', () => {
    const wide = window.innerWidth;
    afterEach(() => { window.innerWidth = wide; });

    it('stacks each application with its review in reach', async () => {
      window.innerWidth = 375;
      render(<NcdTab applications={[submitted, approved]} />);

      expect(screen.queryByRole('table')).not.toBeInTheDocument();
      const card = within(screen.getByRole('list', { name: 'Open NCD applications' })).getByRole('listitem');
      for (const text of ['Mwiza Banda', 'NCD-2026-0001', 'PA-2025-000777', '3 yrs', '30%', 'Submitted']) expect(card).toHaveTextContent(text);
      await userEvent.click(within(card).getByRole('button', { name: 'Review & decide Mwiza Banda’s application' }));
      const dialog = screen.getByRole('dialog', { name: 'Decide Mwiza Banda’s application' });

      await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await userEvent.click(screen.getByRole('tab', { name: /Decided/ }));
      const decided = within(await screen.findByRole('list', { name: 'Decided NCD applications' })).getByRole('listitem');
      expect(decided).toHaveTextContent('NCD-20-BWALYA');
    });
  });
});
