import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { DEMO_CUSTOMER_ACCOUNT, useStore } from '@/store';
import RenewalPage from './RenewalPage';

vi.mock('@/api/sync', () => ({ hydrateCustomer: vi.fn() }));

const initial = useStore.getInitialState();

const policy = (policyNumber, renewalProduct) => ({
  policyNumber,
  customerEmail: DEMO_CUSTOMER_ACCOUNT.email,
  vehicle: `Toyota ${policyNumber}`,
  insurer: 'Prestige Assurance',
  coverage: 'Comprehensive',
  premium: 5000,
  policyDates: { startDate: '2026-01-01', endDate: '2026-12-31' },
  renewal: { window: 'DUE', daysRemaining: 20, endDate: '2026-12-31', renewable: true, renewalRequestId: null },
  renewalProduct,
});

const show = (policies) => {
  useStore.setState({ ...initial, customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policies }, true);
  return render(<MemoryRouter><RenewalPage /></MemoryRouter>);
};

beforeEach(() => vi.clearAllMocks());

it('says which product a renewal starts from, and when its terms have changed', () => {
  show([
    policy('POL-1', { available: true, productVersionId: 'pv-1', name: 'Motor Classic', versionNumber: 1, termsChanged: false }),
    policy('POL-2', { available: true, productVersionId: 'pv-9', name: 'Motor Plus', versionNumber: 3, termsChanged: true }),
  ]);

  expect(screen.getByText('Motor Classic')).toBeInTheDocument();
  expect(screen.getByText(/the insurer has changed its terms since you bought it \(now version 3\)/i)).toBeInTheDocument();
});

it('says when the product is no longer offered, and nothing for an older policy', () => {
  show([
    policy('POL-3', { available: false, reason: 'This product is no longer offered. Compare current products to renew.' }),
    policy('POL-4', null),
  ]);

  expect(screen.getByText('This product is no longer offered. Compare current products to renew.')).toBeInTheDocument();
  expect(screen.queryAllByText(/starts from/i)).toHaveLength(0);
});
