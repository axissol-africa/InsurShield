import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import { DEMO_CUSTOMER_ACCOUNT, useStore } from '@/store';
import NewServiceRequestPage from './NewServiceRequestPage';

vi.mock('@/api/sync', () => ({ hydrateCustomer: vi.fn() }));
vi.mock('@/api', () => ({ api: { serviceRequests: { submit: vi.fn() } } }));

const initial = useStore.getInitialState();
const policy = (policyNumber, status) => ({
  policyNumber,
  status,
  customerEmail: DEMO_CUSTOMER_ACCOUNT.email,
  insurer: 'Prestige Assurance',
  vehicle: '2021 Toyota Corolla',
  policyDates: { startDate: '2026-01-01', endDate: '2099-12-31' },
});

const show = (query = '') => {
  useStore.setState({ ...initial, customer: { email: DEMO_CUSTOMER_ACCOUNT.email }, policies: [policy('POL-1', 'Active'), policy('POL-2', 'Awaiting insurer certificate'), policy('POL-3', 'Cancelled')] }, true);
  return render(
    <MemoryRouter initialEntries={[`/service-requests/new${query}`]}>
      <Routes>
        <Route path="/service-requests/new" element={<NewServiceRequestPage />} />
        <Route path="/service-requests/:reference" element={<p>Request page</p>} />
      </Routes>
    </MemoryRouter>,
  );
};

beforeEach(() => vi.clearAllMocks());

it('offers only policies the insurer can act on, and cancellation only for cover in force', async () => {
  show('?policy=POL-2');
  const select = screen.getByLabelText('Policy');
  expect([...select.options].map((option) => option.value)).toEqual(['', 'POL-1', 'POL-2']);
  expect(screen.queryByLabelText(/Cancel my cover/)).not.toBeInTheDocument();
  expect(screen.getByText(/still being issued, so it cannot be cancelled yet/)).toBeInTheDocument();

  await userEvent.selectOptions(select, 'POL-1');
  expect(screen.getByLabelText(/Cancel my cover/)).toBeInTheDocument();
});

it('asks for a date before sending a cancellation, then sends it and opens the request', async () => {
  api.serviceRequests.submit.mockResolvedValue({ reference: 'SR-NEW1' });
  show('?policy=POL-1');
  await userEvent.click(screen.getByLabelText(/Cancel my cover/));
  await userEvent.type(screen.getByLabelText('Tell the insurer what you need'), 'I sold the vehicle last week.');
  await userEvent.click(screen.getByRole('button', { name: 'Send to the insurer' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Choose the day you want the cover to end.');
  expect(api.serviceRequests.submit).not.toHaveBeenCalled();

  await userEvent.type(screen.getByLabelText('The day you want the cover to end'), '2099-06-30');
  await userEvent.click(screen.getByRole('button', { name: 'Send to the insurer' }));

  expect(api.serviceRequests.submit).toHaveBeenCalledWith({
    policyNumber: 'POL-1',
    type: 'CANCELLATION',
    reason: 'I sold the vehicle last week.',
    requestedEffectiveDate: '2099-06-30',
    files: [],
  });
  expect(await screen.findByText('Request page')).toBeInTheDocument();
});

it('shows the reason the server refused', async () => {
  api.serviceRequests.submit.mockRejectedValue(Object.assign(new Error('You have already asked to cancel this policy.'), { code: 'CANCELLATION_ALREADY_OPEN' }));
  show('?policy=POL-1');
  await userEvent.click(screen.getByLabelText(/Ask for help/));
  await userEvent.type(screen.getByLabelText('Tell the insurer what you need'), 'Please explain my excess.');
  await userEvent.click(screen.getByRole('button', { name: 'Send to the insurer' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You have already asked to cancel this policy.');
});
