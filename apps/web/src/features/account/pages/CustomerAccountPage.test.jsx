import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useStore } from '@/store';
import { downloadRtsaDisc } from '@/lib/policyDocuments';
import CustomerAccountPage from './CustomerAccountPage';

vi.mock('@/api/sync', () => ({ hydrateCustomer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/lib/policyDocuments', () => ({
  downloadPolicyCertificate: vi.fn(),
  downloadRtsaDisc: vi.fn(),
}));

const initial = useStore.getInitialState();

beforeEach(() => {
  useStore.setState({
    ...initial,
    customer: { fullName: 'Mwiza Banda', email: 'mwiza@example.com', phone: '0970123456' },
    policies: [{
      policyNumber: 'POL-RTSA',
      insurer: 'Test insurer',
      customerEmail: 'mwiza@example.com',
      status: 'Active',
      coverage: 'Comprehensive',
      premium: 1200,
      rtsaAnniversaryFee: 500,
      paymentProof: { amount: 1700 },
      vehicle: '2020 Toyota Hilux',
      vehicleDetails: { plateNumber: 'BAA 1234' },
      policyDates: null,
      receivedAt: '2026-11-05T10:00:00.000Z',
      issuedAt: '2026-11-05T11:00:00.000Z',
    }],
    quoteRequests: [],
    claims: [],
  }, true);
});

it('separates the insurer premium, RTSA fee and confirmed total on an active policy', () => {
  render(
    <MemoryRouter initialEntries={['/account?section=policies']}>
      <CustomerAccountPage />
    </MemoryRouter>,
  );

  expect(screen.getByText('Insurance premium')).toBeInTheDocument();
  expect(screen.getByText('RTSA anniversary fee')).toBeInTheDocument();
  expect(screen.getByText('Total paid')).toBeInTheDocument();
  expect(screen.getByText('ZMW 1,200.00')).toBeInTheDocument();
  expect(screen.getByText('ZMW 500.00')).toBeInTheDocument();
  expect(screen.getByText('ZMW 1,700.00')).toBeInTheDocument();
});

it('downloads the RTSA disc using the policy fee charged at payment', () => {
  render(
    <MemoryRouter initialEntries={['/account?section=policies']}>
      <CustomerAccountPage />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByRole('button', { name: 'RTSA disc' }));
  expect(downloadRtsaDisc).toHaveBeenCalledWith(expect.objectContaining({
    policyNumber: 'POL-RTSA',
    rtsaAnniversaryFee: 500,
  }));
});
