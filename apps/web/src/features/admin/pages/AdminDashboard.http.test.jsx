import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboard from './AdminDashboard';
import { useStore } from '@/store';
import { api } from '@/api';

vi.mock('@/config/env', () => ({ env: { apiMode: 'http', mockLatencyMs: 0 } }));

vi.mock('@/api', () => ({
  api: {
    admin: {
      overview: vi.fn(), premiumByMonth: vi.fn(), recentPolicies: vi.fn(), findCustomer: vi.fn(),
    },
    insurers: { list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn(), restore: vi.fn() },
    config: { getPia: vi.fn(), setPia: vi.fn() },
  },
}));

vi.mock('@/api/sync', () => ({ hydrateAdmin: vi.fn().mockResolvedValue(undefined) }));

const overview = {
  policies: { total: 12, active: 9, awaitingCertificate: 3, expiringIn30Days: 1 },
  insurers: { total: 4, active: 3, inactive: 1 },
  claims: { open: 2, total: 5 },
  quoteRequests: { awaitingQuotes: 6, quoted: 7 },
  ncd: { open: 1 },
  customers: { total: 24 },
  premium: { currency: 'ZMW', allTime: 12800, thisMonth: 2200 },
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('scrollTo', vi.fn());
  api.admin.overview.mockResolvedValue(overview);
  api.admin.premiumByMonth.mockResolvedValue([{ month: '2026-11', total: 2200 }]);
  api.admin.recentPolicies.mockResolvedValue([{
    policyNumber: 'POL-SERVER-1', status: 'Active', insurer: 'Server Assurance', customerName: 'API Customer',
    vehicle: '2024 Toyota Hilux', plateNumber: 'BAA 1234', premium: 2200, receivedAt: '2026-11-01T10:00:00.000Z', issuedAt: null,
  }]);
  useStore.setState({
    // These are deliberately unlike the response above: an HTTP dashboard
    // must never render a persisted prototype record as live platform data.
    insurersList: [], claims: [{ status: 'Notified' }], policies: [{ policyNumber: 'POL-STALE', premium: 99 }], quoteRequests: [], registeredAccounts: [],
    piaConfig: { piaRatePercentage: 4 }, staffSession: { role: 'ADMIN', name: 'Administrator', isSuperAdmin: false },
  });
});

describe('administrator HTTP data', () => {
  it('uses the protected admin endpoints rather than browser-store totals', async () => {
    render(<AdminDashboard />);

    await waitFor(() => expect(api.admin.overview).toHaveBeenCalledTimes(1));
    expect(api.admin.premiumByMonth).toHaveBeenCalledWith(12);
    expect(api.admin.recentPolicies).toHaveBeenCalledWith(50);
    expect(screen.getByText('POL-SERVER-1')).toBeVisible();
    expect(screen.queryByText('POL-STALE')).not.toBeInTheDocument();
    expect(screen.getByText('ZMW 12,800.00')).toBeVisible();
  });

  it('uses the server lookup for a customer record', async () => {
    api.admin.findCustomer.mockResolvedValue({
      id: 'customer-1', fullName: 'Mwiza Banda', email: 'mwiza@example.zm', phone: '+260970123456', createdAt: '2026-01-01T00:00:00.000Z', consent: null,
      counts: { quoteRequests: 3, policies: 2, claims: 1 },
    });
    const user = userEvent.setup();
    render(<AdminDashboard />);

    await user.click(screen.getByRole('button', { name: 'Find customer' }));
    await user.type(screen.getByLabelText('Customer email or mobile number'), 'mwiza@example.zm');
    await user.click(screen.getByRole('button', { name: 'Find account' }));

    await waitFor(() => expect(api.admin.findCustomer).toHaveBeenCalledWith('mwiza@example.zm'));
    await waitFor(() => expect(screen.getByText('Mwiza Banda', { selector: 'dd' })).toBeVisible());
    expect(screen.getByText('+260970123456', { selector: 'dd' })).toBeVisible();
  });
});
