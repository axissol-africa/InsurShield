import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import PaymentPage, { POLL_MS } from './PaymentPage';
import { useStore } from '@/store';
import { env } from '@/config/env';
import { api } from '@/api';
import { ApiError } from '@/lib/apiClient';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock' } }));
vi.mock('@/api', () => ({ api: { payments: { pay: vi.fn(), status: vi.fn(), cancel: vi.fn() } } }));

const BREAKDOWN = [{ kind: 'PREMIUM', code: 'PREMIUM', label: 'Premium', amount: 1200 }];
const attemptAs = (status, change = {}) => ({
  transactionId: 'TXN-1', status, method: 'Mobile money', amount: 1200, breakdown: BREAKDOWN, payer: '*******567',
  pendingUntil: new Date(Date.now() + 15 * 60_000).toISOString(), checkoutUrl: null, failure: null, ...change,
});
class FakeApiError extends Error {
  constructor(message, code, details) { super(message); this.code = code; this.details = details; }
}

function showPage() {
  render(<MemoryRouter initialEntries={['/payment?capture=phone123']}><Routes><Route path="/payment" element={<PaymentPage />} /><Route path="/confirmation" element={<p>Confirmation destination</p>} /></Routes></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  env.apiMode = 'mock';
  useStore.setState({ selectedQuote: { name: 'Test insurer', coverage: 'Motor', price: 1200, insurerQuoteId: 'IQ-1', requestId: 'REQ-1' }, customer: { phone: '0971234567' }, vehicleDetails: null, policyDates: null, matchRtsaAnniversary: false, paymentAttempt: null, paymentReceipt: null });
});

describe('Payment methods', () => {
  it('switches between card and mobile money fields', async () => {
    showPage();
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0971234567');
    await userEvent.click(screen.getByRole('tab', { name: 'Card', exact: true }));
    expect(await screen.findByText(/never sees your card details/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Card number')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Mobile number')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Mobile money' }));
    expect(await screen.findByLabelText('Mobile number')).toHaveValue('0971234567');
  });

  it('retries a lost HTTP answer with the same key and original payer details', async () => {
    api.payments.pay.mockRejectedValueOnce(new ApiError('Please try again.', { code: 'NETWORK' }))
      .mockResolvedValueOnce(attemptAs('Confirmed'));
    showPage();
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Please try again.');
    expect(screen.getByLabelText('Mobile number')).toHaveValue('0971234567');
    expect(screen.getByLabelText('Mobile number')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry original payment' }));
    await waitFor(() => expect(screen.getByText('Confirmation destination')).toBeInTheDocument());
    expect(api.payments.pay).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 1200, method: 'Mobile money', mobileNumber: '0971234567' }), expect.any(String));
    const [first, second] = api.payments.pay.mock.calls;
    expect(second).toEqual(first);
  });

  it('can recover a saved payment attempt after the original quote expired', async () => {
    const payload = { insurerQuoteId: 'IQ-1', quoteRequestId: 'REQ-1', amount: 1200, method: 'Mobile money', mobileNumber: '0971234567' };
    useStore.setState(state => ({
      selectedQuote: { ...state.selectedQuote, validUntil: '2020-01-01' },
      paymentAttempt: { insurerQuoteId: 'IQ-1', transactionId: null, payload, idempotencyKey: 'existing-attempt' },
    }));
    api.payments.pay.mockResolvedValueOnce(attemptAs('Pending'));
    showPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry original payment' }));
    await screen.findByRole('heading', { name: 'Waiting for your payment' });
    expect(api.payments.pay).toHaveBeenCalledExactlyOnceWith(payload, 'existing-attempt');
  });

  it('starts a new attempt with a new key after the server refused one', async () => {
    api.payments.pay.mockRejectedValueOnce(new FakeApiError('Choose this quote before paying for it.', 'SELECTION_REQUIRED')).mockResolvedValueOnce(attemptAs('Confirmed'));
    showPage();
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose this quote');
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    await waitFor(() => expect(screen.getByText('Confirmation destination')).toBeInTheDocument());
    const [first, second] = api.payments.pay.mock.calls.map((call) => call[1]);
    expect(second).not.toBe(first);
  });

  it('sends a card payment to the provider page, with no card fields here', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign, origin: 'http://localhost:5173' });
    api.payments.pay.mockResolvedValueOnce(attemptAs('Pending', { method: 'Card', checkoutUrl: 'https://provider.test/checkout/1' }));
    showPage();
    await userEvent.click(screen.getByRole('tab', { name: 'Card', exact: true }));
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://provider.test/checkout/1'));
    expect(api.payments.pay.mock.calls[0][0]).toMatchObject({ method: 'Card', returnUrl: 'http://localhost:5173/payment?capture=phone123' });
    vi.unstubAllGlobals();
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
  const processing = await screen.findByRole('button', { name: 'Starting payment…' });
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

it('uses the server-returned RTSA fee and never sends a fee chosen by the browser', async () => {
  api.payments.pay.mockResolvedValueOnce(attemptAs('Confirmed', { amount: 1700, rtsaAnniversaryFee: 500 }));
  useStore.setState({
    selectedQuote: { requestId: 'REQ-RTSA', insurerQuoteId: 'IQ-RTSA', name: 'Test insurer', coverage: 'Motor', price: 1200 },
    quoteRequests: [{ id: 'REQ-RTSA', insuranceType: 'Comprehensive', rtsaAnniversaryFee: 500 }],
  });
  showPage();

  expect(screen.getByText('RTSA anniversary fee')).toBeInTheDocument();
  expect(screen.getByText('ZMW 1,700.00')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Pay ZMW 1,700.00' }));

  await waitFor(() => expect(api.payments.pay).toHaveBeenCalledTimes(1));
  expect(api.payments.pay).toHaveBeenCalledWith(expect.objectContaining({ quoteRequestId: 'REQ-RTSA', amount: 1700 }), expect.any(String));
  expect(api.payments.pay.mock.calls[0][0]).not.toHaveProperty('rtsaAnniversaryFee');
});

it('adds the optional extras chosen with the quote to the total', () => {
  useStore.setState({ selectedQuote: { name: 'Test insurer', price: 1200, insurerQuoteId: 'IQ-1', addOns: [{ code: 'WINDSCREEN', label: 'Windscreen cover', price: 150 }] } });
  showPage();
  expect(screen.getByText('Windscreen cover')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Pay ZMW 1,350.00' })).toBeInTheDocument();
});

describe('Waiting for the provider', () => {
  it('asks the customer to approve the prompt, then follows the server to the confirmation', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    api.payments.pay.mockResolvedValueOnce(attemptAs('Pending'));
    api.payments.status.mockResolvedValueOnce(attemptAs('Pending')).mockResolvedValueOnce(attemptAs('Confirmed', { policyNumber: 'POL-1' }));
    showPage();
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    expect(await screen.findByRole('heading', { name: 'Waiting for your payment' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Approve the payment prompt sent to *******567.');
    await vi.advanceTimersByTimeAsync(POLL_MS * 2);
    await waitFor(() => expect(screen.getByText('Confirmation destination')).toBeInTheDocument());
    expect(useStore.getState().paymentReceipt).toMatchObject({ transactionId: 'TXN-1', policyNumber: 'POL-1' });
    expect(useStore.getState().paymentAttempt).toBeNull();
    vi.useRealTimers();
  });

  it('says plainly that a declined payment took no money, and lets the customer try again', async () => {
    useStore.setState({ paymentAttempt: { insurerQuoteId: 'IQ-1', idempotencyKey: 'K1', transactionId: 'TXN-1', payment: attemptAs('Failed', { failure: 'The payment was declined. No money was taken.' }) } });
    showPage();
    expect(screen.getByRole('heading', { name: 'Payment not completed' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The payment was declined. No money was taken.');
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: /^Pay / })).toBeInTheDocument();
  });

  it('lets the customer stop a waiting payment', async () => {
    useStore.setState({ paymentAttempt: { insurerQuoteId: 'IQ-1', idempotencyKey: 'K1', transactionId: 'TXN-1', payment: attemptAs('Pending') } });
    api.payments.cancel.mockResolvedValueOnce(attemptAs('Cancelled', { failure: 'The payment was cancelled. No money was taken.' }));
    showPage();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel this payment' }));
    expect(await screen.findByText('The payment was cancelled. No money was taken.')).toBeInTheDocument();
    expect(api.payments.cancel).toHaveBeenCalledWith('TXN-1');
  });

  it('says when it is taking longer than usual, and keeps checking', () => {
    useStore.setState({ paymentAttempt: { insurerQuoteId: 'IQ-1', idempotencyKey: 'K1', transactionId: 'TXN-1', payment: attemptAs('Pending', { pendingUntil: '2020-01-01T00:00:00.000Z' }) } });
    showPage();
    expect(screen.getByRole('status')).toHaveTextContent('taking longer than usual');
  });

  it('shows the amount the server expects when the price changed, and pays that', async () => {
    api.payments.pay
      .mockRejectedValueOnce(new FakeApiError('The amount does not match the quote.', 'AMOUNT_MISMATCH', {
        expected: 1350,
        breakdown: [...BREAKDOWN, { kind: 'ADD_ON', code: 'WINDSCREEN', label: 'Windscreen cover', amount: 150 }],
      }))
      .mockResolvedValueOnce(attemptAs('Confirmed', { amount: 1350 }));
    showPage();
    fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The amount to pay is now ZMW 1,350.00');
    expect(screen.getByText('Windscreen cover')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pay ZMW 1,350.00' }));
    await waitFor(() => expect(api.payments.pay).toHaveBeenLastCalledWith(expect.objectContaining({ amount: 1350 }), expect.any(String)));
  });

  it('ignores an attempt kept for another quote', () => {
    useStore.setState({ paymentAttempt: { insurerQuoteId: 'IQ-OTHER', idempotencyKey: 'K1', transactionId: 'TXN-9', payment: attemptAs('Pending') } });
    showPage();
    expect(screen.getByRole('button', { name: /^Pay / })).toBeInTheDocument();
  });
});


it('holds an HTTP confirmed payment with no server policy rather than navigating or allowing another payment', async () => {
  env.apiMode = 'http';
  api.payments.pay.mockResolvedValueOnce(attemptAs('Confirmed', { policyNumber: null }));
  showPage();
  fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
  expect(await screen.findByRole('heading', { name: 'Payment held — awaiting resolution' })).toBeInTheDocument();
  expect(screen.getByText(/Payment reference: TXN-1/)).toBeInTheDocument();
  expect(screen.queryByText('Confirmation destination')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^Pay / })).not.toBeInTheDocument();
  expect(useStore.getState().paymentAttempt.payment).toMatchObject({ status: 'Confirmed', policyNumber: null });
  expect(useStore.getState().paymentReceipt).toBeNull();
});

it.each(['attempt', 'receipt'])('keeps a held HTTP %s safe after reload without a selected quote', (source) => {
  env.apiMode = 'http';
  const payment = attemptAs('Confirmed', { policyNumber: null });
  useStore.setState({ selectedQuote: null, paymentReceipt: source === 'receipt' ? payment : null,
    paymentAttempt: source === 'attempt' ? { insurerQuoteId: 'IQ-1', transactionId: 'TXN-1', payment } : null });
  showPage();
  expect(screen.getByRole('heading', { name: 'Payment held — awaiting resolution' })).toBeInTheDocument();
  expect(api.payments.pay).not.toHaveBeenCalled();
});


it.each(['Cancelled', 'Expired', 'Failed'])('treats a late captured %s payment as held, never as unpaid', (status) => {
  env.apiMode = 'http';
  useStore.setState({ paymentAttempt: { insurerQuoteId: 'IQ-1', transactionId: 'TXN-1', payment: attemptAs(status, { confirmedAt: '2026-11-26T10:00:00Z', policyNumber: null, failure: 'No money was taken.' }) } });
  showPage();
  expect(screen.getByRole('heading', { name: 'Payment held — awaiting resolution' })).toBeInTheDocument();
  expect(screen.queryByText('No money was taken.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(screen.queryByText('Confirmation destination')).not.toBeInTheDocument();
});

it('shows a reversal even when the original capture time is still recorded', () => {
  env.apiMode = 'http';
  const payment = attemptAs('Reversed', { confirmedAt: new Date().toISOString(), failure: 'The payment was reversed by the provider.' });
  useStore.setState({ paymentAttempt: { insurerQuoteId: 'IQ-1', transactionId: payment.transactionId, payment } });
  showPage();
  expect(screen.getByRole('heading', { name: 'Payment not completed' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('The payment was reversed by the provider.');
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});

it('continues an HTTP confirmation when the server actually provides a policy number', async () => {
  env.apiMode = 'http';
  api.payments.pay.mockResolvedValueOnce(attemptAs('Confirmed', { policyNumber: 'POL-SERVER' }));
  showPage();
  fireEvent.click(screen.getByRole('button', { name: /^Pay / }));
  expect(await screen.findByText('Confirmation destination')).toBeInTheDocument();
  expect(useStore.getState().paymentReceipt.policyNumber).toBe('POL-SERVER');
});
