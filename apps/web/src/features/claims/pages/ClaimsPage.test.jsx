import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ClaimsPage from './ClaimsPage';
import { useStore } from '@/store';

vi.mock('@/api/sync', () => ({ hydrateCustomer: vi.fn(), hydrateDirectory: vi.fn() }));

const customer = { fullName: 'Mwiza Banda', phone: '0970123456', email: 'mwiza.banda@insurshield.zm' };
const application = (yearsClaimFree) => ({
  id: 'NCD-1', applicationNumber: 'NCD-2026-0001', fullName: customer.fullName, phone: customer.phone, insurer: 'Prestige Assurance',
  policyNumber: 'PA-2019-000777', yearsClaimFree, status: 'Submitted', submittedAt: '2026-10-09T08:00:00Z', approvedCode: null,
});

beforeEach(() => {
  useStore.setState({ customer, claims: [], policies: [] });
});

describe('ClaimsPage — a no-claim discount application', () => {
  // The insurer deciding this application is shown the same figure.
  it.each([[3, '30%'], [6, '50%']])('tells the customer the discount the published tiers give for %i claim-free years', async (yearsClaimFree, discount) => {
    const user = userEvent.setup();
    useStore.setState({ ncdApplications: [application(yearsClaimFree)] });
    render(<MemoryRouter><ClaimsPage /></MemoryRouter>);

    await user.click(screen.getByRole('tab', { name: /NCD|No-claim/i }));
    await user.click(screen.getByRole('button', { name: /NCD-2026-0001/ }));
    expect(screen.getByText('Potential Discount').parentElement).toHaveTextContent(discount);
  });
});
