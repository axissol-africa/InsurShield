import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ClaimsTab from './ClaimsTab';
import { api } from '@/api';
import { hydrateInsurerPortal } from '@/api/sync';

vi.mock('@/api', () => ({ api: { claims: { markReceived: vi.fn() } } }));
vi.mock('@/api/sync', () => ({ hydrateInsurerPortal: vi.fn().mockResolvedValue(undefined) }));

const theft = {
  id: 'CLM-654321', claimNumber: 'CLM-654321', status: 'Notified', submittedAt: new Date().toISOString(), insurer: 'Prestige Assurance', type: 'Theft',
  fullName: 'Mwiza Banda', phone: '0970123456', email: 'mwiza.banda@insurshield.zm', plate: 'BAA 1234', vehicle: '2020 Toyota Hilux', incidentDate: '2026-09-20',
  location: 'Woodlands', description: 'Stolen overnight.', estimatedLoss: '95000', policeReport: true, policeReportNumber: 'ZP/2026/1',
  supportingDocs: [{ name: 'police-report.pdf' }],
};
const collision = {
  id: 'CLM-111222', claimNumber: 'CLM-111222', status: 'Received by insurer', submittedAt: '2026-10-01T08:00:00Z', receivedAt: '2026-10-02T08:00:00Z',
  type: 'Collision', fullName: 'Chanda Phiri', phone: '0966000111', plate: 'ALK 9001', vehicle: '2018 Mazda Demio', incidentDate: '2026-09-28', location: 'Kabulonga',
};

const list = () => screen.getByRole('list', { name: 'Claim notifications' });
const open = async (user, number) => user.click(within(list()).getByRole('button', { name: new RegExp(number) }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClaimsTab', () => {
  it('lists the notifications and says how many are not yet received', () => {
    render(<ClaimsTab claims={[theft, collision]} />);

    expect(screen.getByRole('heading', { level: 1, name: 'Claims' })).toBeVisible();
    expect(screen.getByText('1 not yet received')).toBeVisible();
    // Whatever order they arrive in, the claims still waiting for a call come first.
    render(<ClaimsTab claims={[collision, theft]} />);
    for (const inbox of screen.getAllByRole('list', { name: 'Claim notifications' })) {
      expect(within(inbox).getAllByRole('button').map((item) => item.textContent)).toEqual([expect.stringContaining('CLM-654321'), expect.stringContaining('CLM-111222')]);
    }
    expect(screen.getAllByText('Select a notification')[0]).toBeVisible();
  });

  it('finds a claim by number, name or plate, and by whether it has been received', async () => {
    const user = userEvent.setup();
    render(<ClaimsTab claims={[theft, collision]} />);
    const search = screen.getByRole('searchbox', { name: 'Find by claim number, name or plate' });

    await user.type(search, '654321');
    expect(within(list()).getAllByRole('button')).toHaveLength(1);
    expect(within(list()).getByRole('button', { name: /CLM-654321/ })).toBeVisible();

    await user.clear(search);
    await user.type(search, 'alk 9001');
    expect(within(list()).getByRole('button', { name: /CLM-111222/ })).toBeVisible();

    await user.clear(search);
    await user.type(search, 'nobody');
    expect(screen.getByText('No notification matches “nobody”.')).toBeVisible();

    await user.clear(search);
    await user.click(screen.getByRole('radio', { name: /^New/ }));
    expect(within(list()).getAllByRole('button')).toHaveLength(1);
    expect(within(list()).getByRole('button', { name: /CLM-654321/ })).toBeVisible();
    await user.click(screen.getByRole('radio', { name: /^Received/ }));
    expect(within(list()).getByRole('button', { name: /CLM-111222/ })).toBeVisible();
    expect(within(list()).queryByRole('button', { name: /CLM-654321/ })).not.toBeInTheDocument();
  });

  it('lays the chosen claim out for the phone call: who is calling, what happened, the evidence', async () => {
    const user = userEvent.setup();
    render(<ClaimsTab claims={[theft, collision]} />);
    await open(user, 'CLM-654321');

    const detail = screen.getByRole('region', { name: 'Claim CLM-654321' });
    expect(within(detail).getByRole('heading', { level: 2, name: 'Theft' })).toBeVisible();
    for (const group of ['Who is calling', 'What happened', 'Evidence']) expect(within(detail).getByRole('heading', { level: 3, name: group })).toBeVisible();
    expect(within(detail).getByRole('link', { name: '0970123456' })).toHaveAttribute('href', 'tel:0970123456');
    expect(within(detail).getByRole('link', { name: 'mwiza.banda@insurshield.zm' })).toHaveAttribute('href', 'mailto:mwiza.banda@insurshield.zm');
    for (const text of ['Mwiza Banda', '2020 Toyota Hilux', 'BAA 1234', 'Woodlands', 'ZMW 95,000.00', 'Reported — ZP/2026/1', 'Stolen overnight.', 'police-report.pdf']) {
      expect(within(detail).getByText(text)).toBeVisible();
    }
    expect(within(list()).getByRole('button', { name: /CLM-654321/ })).toHaveAttribute('aria-current', 'true');
  });

  it('leaves out what the customer did not give instead of listing blanks', async () => {
    const user = userEvent.setup();
    render(<ClaimsTab claims={[collision]} />);
    await open(user, 'CLM-111222');

    const detail = screen.getByRole('region', { name: 'Claim CLM-111222' });
    expect(within(detail).getByText('No police report')).toBeVisible();
    expect(within(detail).getByText('No documents attached')).toBeVisible();
    expect(within(detail).queryByText(/Not provided|Not stated/)).not.toBeInTheDocument();
    expect(within(detail).queryByText('Estimated loss')).not.toBeInTheDocument();
    expect(within(detail).queryByRole('link', { name: /@/ })).not.toBeInTheDocument();
  });

  it('shows where the claim stands and whose step it is', async () => {
    const user = userEvent.setup();
    render(<ClaimsTab claims={[theft, collision]} />);
    const steps = (number) => within(within(screen.getByRole('region', { name: `Claim ${number}` })).getByRole('list', { name: 'Where this claim stands' })).getAllByRole('listitem');

    await open(user, 'CLM-654321');
    expect(steps('CLM-654321')[0]).toHaveTextContent('Done: Notified by the customer');
    expect(steps('CLM-654321')[1]).toHaveAttribute('aria-current', 'step');
    expect(steps('CLM-654321')[1]).toHaveTextContent('Mark it received');
    expect(steps('CLM-654321')[1]).toHaveTextContent('Your step');
    expect(steps('CLM-654321')[2]).toHaveTextContent('Next: Handled in your claims system');

    await open(user, 'CLM-111222');
    expect(steps('CLM-111222')[1]).toHaveTextContent('Done: Received by you');
    expect(steps('CLM-111222')[2]).toHaveAttribute('aria-current', 'step');
    expect(steps('CLM-111222')[2]).toHaveTextContent('Handled in your claims system');
  });

  it('marks a claim received, staying busy until the portal has reloaded', async () => {
    const user = userEvent.setup();
    let finish;
    api.claims.markReceived.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    render(<ClaimsTab claims={[theft]} />);
    await open(user, 'CLM-654321');

    await user.click(screen.getByRole('button', { name: 'Mark as received' }));
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(saving).toHaveAttribute('aria-busy', 'true');
    expect(api.claims.markReceived).toHaveBeenCalledExactlyOnceWith('CLM-654321');

    await act(async () => { finish(); });
    expect(hydrateInsurerPortal).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Mark as received' })).toBeEnabled();
  });

  it('explains a failure and lets the insurer try again', async () => {
    const user = userEvent.setup();
    api.claims.markReceived.mockRejectedValueOnce(new Error('ECONNRESET')).mockResolvedValueOnce(undefined);
    render(<ClaimsTab claims={[theft]} />);
    await open(user, 'CLM-654321');

    await user.click(screen.getByRole('button', { name: 'Mark as received' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This claim could not be marked as received. Please try again.');
    await user.click(screen.getByRole('button', { name: 'Mark as received' }));
    expect(api.claims.markReceived).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('has nothing left to do on a claim that was already received', async () => {
    const user = userEvent.setup();
    render(<ClaimsTab claims={[collision]} />);
    await open(user, 'CLM-111222');

    expect(screen.getByText('Received — this claim continues in your own claims system.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Mark as received' })).not.toBeInTheDocument();
    expect(screen.getByText('All received')).toBeVisible();
  });

  it('returns to the list from a claim', async () => {
    const user = userEvent.setup();
    render(<ClaimsTab claims={[theft]} />);
    await open(user, 'CLM-654321');
    await user.click(screen.getByRole('button', { name: 'Back to notifications' }));
    expect(screen.queryByRole('region', { name: 'Claim CLM-654321' })).not.toBeInTheDocument();
    expect(within(list()).getByRole('button', { name: /CLM-654321/ })).toHaveFocus();
  });

  it('puts focus on the search when the claim that was open has left the list', async () => {
    const user = userEvent.setup();
    api.claims.markReceived.mockResolvedValue(undefined);
    const { rerender } = render(<ClaimsTab claims={[theft, collision]} />);
    await user.click(screen.getByRole('radio', { name: /New/ }));
    await open(user, 'CLM-654321');

    await user.click(screen.getByRole('button', { name: 'Mark as received' }));
    rerender(<ClaimsTab claims={[{ ...theft, status: 'Received by insurer', receivedAt: new Date().toISOString() }, collision]} />);
    await user.click(screen.getByRole('button', { name: 'Back to notifications' }));

    // Under "New" the claim is no longer listed, so there is no row to go back to.
    expect(screen.queryByRole('button', { name: /CLM-654321/ })).not.toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Find by claim number, name or plate' })).toHaveFocus();
  });

  it('says so when there are no claims', () => {
    render(<ClaimsTab claims={[]} />);
    expect(screen.getByText('No claims yet')).toBeVisible();
  });
});
