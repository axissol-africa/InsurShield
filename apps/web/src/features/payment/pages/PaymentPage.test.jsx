import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import PaymentPage from './PaymentPage';
import { useStore } from '@/store';
import { api } from '@/api';

vi.mock('@/api', () => ({ api: { payments: { pay: vi.fn() } } }));

function showPage() {
  render(<MemoryRouter initialEntries={['/payment?capture=phone123']}><Routes><Route path="/payment" element={<PaymentPage />} /><Route path="/confirmation" element={<p>Confirmation destination</p>} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ selectedQuote: { name: 'Test insurer', coverage: 'Motor', price: 1200 }, customer: { phone: '0971234567' }, vehicleDetails: null, policyDates: null, matchRtsaAnniversary: false });
});

describe('Payment methods', () => {
  it('switches between card and mobile money fields', async () => {
    showPage();
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0971234567');
    await userEvent.click(screen.getByRole('tab', { name: 'Card', exact: true }));
    expect(await screen.findByLabelText('Card number')).toBeRequired();
    expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Mobile money' }));
    expect(await screen.findByLabelText('Mobile number')).toHaveValue('0971234567');
  });

  it('retains input and allows retry after a failed payment', async () => {
    api.payments.pay.mockRejectedValueOnce(new Error('Please try again.')).mockResolvedValueOnce({ transactionId: 'TX1' });
    showPage();
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0971234567');
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    await waitFor(() => expect(screen.getByText('Confirmation destination')).toBeInTheDocument());
    expect(api.payments.pay).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 1200, method: 'Mobile money', mobileNumber: '0971234567' }));
  });
});

it('blocks payment on an expired quote', () => {
  useStore.setState({ selectedQuote: { name: 'Test insurer', price: 1200, validUntil: '2020-01-01' } });
  showPage();
  expect(screen.getByRole('heading', { name: 'This quote has expired' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument();
  expect(api.payments.pay).not.toHaveBeenCalled();
});

it('disables authorisation while a payment is pending', async () => {
  api.payments.pay.mockImplementation(() => new Promise(() => {}));
  showPage();
  fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
  const processing = await screen.findByRole('button', { name: 'Processing payment…' });
  expect(processing).toBeDisabled();
  fireEvent.click(processing);
  expect(api.payments.pay).toHaveBeenCalledTimes(1);
});

it.each([true, false])('displays the selected third-party cover instead of a conflicting catalogue plan (saved request: %s)', (saved) => {
  useStore.setState({ selectedQuote: { requestId: 'REQ-COVER', name: 'Test insurer', coverage: 'Comprehensive Gold Plan', price: 1200 }, insuranceType: saved ? 'Comprehensive' : 'ThirdParty', quoteRequests: saved ? [{ id: 'REQ-COVER', insuranceType: 'ThirdParty' }] : [] });
  showPage();
  expect(screen.getByText('Third party only')).toBeInTheDocument();
  expect(screen.queryByText(/Comprehensive Gold Plan/)).not.toBeInTheDocument();
});
