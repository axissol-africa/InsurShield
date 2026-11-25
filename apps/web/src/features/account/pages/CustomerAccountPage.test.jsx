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

it('tells the customer where issuing stands: delayed, or not issued and being refunded', () => {
  const pending = { insurer: 'Test insurer', customerEmail: 'mwiza@example.com', quoteRequestId: 'QR-1', receivedAt: '2026-11-05T10:00:00.000Z' };
  useStore.setState({
    policies: [
      { ...pending, policyNumber: 'POL-LATE', status: 'Awaiting insurer certificate', product: { name: 'Comprehensive Plus', versionNumber: 2 }, issuance: { overdue: true } },
      { ...pending, policyNumber: 'POL-FAILED', status: 'Issuance failed', issuance: { failureReason: 'The vehicle is already covered.' } },
      { ...pending, policyNumber: 'POL-REFUNDED', status: 'Cancelled', issuance: { failedAt: '2026-11-06T10:00:00.000Z' } },
    ],
  });
  render(
    <MemoryRouter initialEntries={['/account?section=certificates']}>
      <CustomerAccountPage />
    </MemoryRouter>,
  );

  expect(screen.getByText('Delayed')).toBeInTheDocument();
  expect(screen.getByText(/taking longer than expected/)).toBeInTheDocument();
  expect(screen.getByText(/Comprehensive Plus/)).toBeInTheDocument();
  expect(screen.getByText('Not issued')).toBeInTheDocument();
  expect(screen.getByText(/could not issue this policy: The vehicle is already covered. Your payment will be refunded/)).toBeInTheDocument();
  expect(screen.getByText('Refunded')).toBeInTheDocument();
  expect(screen.getByText(/your payment has been refunded in full/)).toBeInTheDocument();
});

it('searches policies and filters quote requests from the address', async () => {
  useStore.setState({
    quoteRequests: [
      { id: 'QR-OPEN', customerEmail: 'mwiza@example.com', status: 'Submitted', vehicle: 'Hilux', submittedAt: '2026-11-20T10:00:00.000Z', expiresAt: '2099-01-01T00:00:00.000Z', insurers: ['Prestige Assurance'], insurerQuotes: {} },
      { id: 'QR-OLD', customerEmail: 'mwiza@example.com', status: 'Expired', vehicle: 'Corolla', submittedAt: '2026-10-01T10:00:00.000Z', expiresAt: '2026-10-08T00:00:00.000Z', insurers: ['Madison General'], insurerQuotes: {} },
    ],
  });
  const { unmount } = render(
    <MemoryRouter initialEntries={['/account?section=policies&q=nothing-like-this']}>
      <CustomerAccountPage />
    </MemoryRouter>,
  );
  expect(screen.getByText('No policy matches that search.')).toBeInTheDocument();
  unmount();

  render(
    <MemoryRouter initialEntries={['/account?section=quotes&filter=expired']}>
      <CustomerAccountPage />
    </MemoryRouter>,
  );
  expect(screen.getByText('QR-OLD')).toBeInTheDocument();
  expect(screen.queryByText('QR-OPEN')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(await screen.findByText('QR-OPEN')).toBeInTheDocument();
});
