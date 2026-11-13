import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdminDashboard from './AdminDashboard';
import { useStore } from '@/store';
import { api } from '@/api';
import { insurers as mockInsurers } from '@/api/mock';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock', mockLatencyMs: 0 } }));

vi.mock('@/api', () => ({
  api: {
    admin: { auditLogs: vi.fn() },
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
const inactiveInsurer = { ...activeInsurer, id: 'inactive-insurer', name: 'Inactive Assurance', status: 'Inactive' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('scrollTo', vi.fn());
  useStore.setState({
    insurersList: [activeInsurer, inactiveInsurer, deletedInsurer], claims: [], policies: [], quoteRequests: [], registeredAccounts: [],
    piaConfig: { piaRatePercentage: 4 },
  });
});

const openInsurers = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Insurers' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage insurers' })).toBeVisible());
};

describe('deleted insurer controls', () => {
  it.each([
    ['mixed mock store', [activeInsurer, inactiveInsurer, deletedInsurer]],
    ['HTTP-hydrated store', [activeInsurer, inactiveInsurer]],
  ])('shows deleted insurers only in the removed list for a super admin with a %s', async (_mode, insurersList) => {
    useStore.setState({ insurersList });
    useStore.setState({ staffSession: { role: 'SUPER_ADMIN', name: 'Super Admin', isSuperAdmin: true } });
    api.insurers.list.mockResolvedValue([deletedInsurer]);

    render(<AdminDashboard />);
    await openInsurers();

    await waitFor(() => expect(api.insurers.list).toHaveBeenCalledWith({ status: 'deleted' }));
    expect(screen.getByText('Removed insurers')).toBeVisible();
    expect(screen.getByText('Removed Assurance')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Restore Removed Assurance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit rate for Active Assurance' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit rate for Inactive Assurance' })).toBeVisible();
    expect(within(screen.getByRole('button', { name: 'Insurers' })).getByText('2')).toBeVisible();
  });

  it('does not request or show deleted insurers to an ordinary admin', async () => {
    useStore.setState({ staffSession: { role: 'ADMIN', name: 'Administrator', isSuperAdmin: false } });

    render(<AdminDashboard />);
    await openInsurers();

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Manage insurers' })).toBeVisible());
    expect(api.insurers.list).not.toHaveBeenCalled();
    expect(screen.queryByText('Removed insurers')).not.toBeInTheDocument();
    expect(screen.queryByText('Removed Assurance')).not.toBeInTheDocument();
    expect(screen.getByText('Active Assurance')).toBeVisible();
    expect(screen.getByText('Inactive Assurance')).toBeVisible();
    expect(within(screen.getByRole('button', { name: 'Insurers' })).getByText('2')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Restore / })).not.toBeInTheDocument();
  });

  it('sends an inactive insurer to its evidence review instead of offering an unsafe direct reactivation', async () => {
    useStore.setState({ staffSession: { role: 'SUPER_ADMIN', name: 'Super Admin', isSuperAdmin: true } });
    render(<AdminDashboard />);
    await openInsurers();

    await userEvent.click(screen.getByRole('button', { name: 'More actions for Inactive Assurance' }));
    expect(screen.queryByRole('menuitem', { name: /Reactivate/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Review eligibility' }));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Review onboarding' })).toBeVisible());
    expect(screen.getByLabelText('Insurer under review')).toHaveValue('inactive-insurer');
  });

  it('requests an insurer removal without changing the insurer before approval', async () => {
    useStore.setState({ insurersList: [activeInsurer], staffSession: { id: 'super-admin', name: 'Super Admin', role: 'SUPER_ADMIN', isSuperAdmin: true } });
    api.insurers.list.mockImplementation(mockInsurers.list);
    api.insurers.remove.mockImplementation(mockInsurers.remove);

    render(<AdminDashboard />);
    await openInsurers();
    await userEvent.click(screen.getByRole('button', { name: 'More actions for Active Assurance' }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Remove/ }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Request removal/ }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Edit rate for Active Assurance' })).toBeVisible();
    expect(useStore.getState().insurersList[0].status).toBe('Active');
    expect(screen.getByRole('status')).toHaveTextContent('sent for independent approval');
  });
});
