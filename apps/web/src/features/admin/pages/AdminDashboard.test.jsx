import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboard from './AdminDashboard';
import { useStore } from '@/store';
import { api } from '@/api';

vi.mock('@/api', () => ({
  api: {
    insurers: {
      list: vi.fn(), create: vi.fn(), update: vi.fn(), setStatus: vi.fn(), remove: vi.fn(), restore: vi.fn(),
    },
    config: { getPia: vi.fn(), setPia: vi.fn() },
  },
}));

vi.mock('@/api/sync', () => ({ hydrateAdmin: vi.fn().mockResolvedValue(undefined) }));

const activeInsurer = {
  id: 'active-insurer', name: 'Active Assurance', status: 'Active', ratePercentage: 4.5, quoteValidityDays: 7, coverage: 'Comprehensive',
};
const deletedInsurer = {
  ...activeInsurer, id: 'removed-insurer', name: 'Removed Assurance', status: 'Deleted', deletedAt: '2026-11-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('scrollTo', vi.fn());
  useStore.setState({
    insurersList: [activeInsurer], claims: [], policies: [], quoteRequests: [], registeredAccounts: [],
    piaConfig: { piaRatePercentage: 4 },
  });
});

const openInsurers = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Insurers' }));
};

describe('deleted insurer controls', () => {
  it('shows the deleted-only list and restore action to a super admin', async () => {
    useStore.setState({ staffSession: { role: 'SUPER_ADMIN', name: 'Super Admin', isSuperAdmin: true } });
    api.insurers.list.mockResolvedValue([deletedInsurer]);

    render(<AdminDashboard />);
    await openInsurers();

    await waitFor(() => expect(api.insurers.list).toHaveBeenCalledWith({ status: 'deleted' }));
    expect(screen.getByText('Removed insurers')).toBeVisible();
    expect(screen.getByText('Removed Assurance')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restore Removed Assurance' })).toBeVisible();
  });

  it('does not request or show deleted insurers to an ordinary admin', async () => {
    useStore.setState({ staffSession: { role: 'ADMIN', name: 'Administrator', isSuperAdmin: false } });

    render(<AdminDashboard />);
    await openInsurers();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage insurers' })).toBeVisible());
    expect(api.insurers.list).not.toHaveBeenCalled();
    expect(screen.queryByText('Removed insurers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Restore / })).not.toBeInTheDocument();
  });
});
