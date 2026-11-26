import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import { env } from '@/config/env';
import PolicyConfirmationPage from './PolicyConfirmationPage';

vi.mock('@/config/env', () => ({ env: { apiMode: 'mock' } }));
beforeEach(() => { env.apiMode = 'mock'; useStore.setState({ paymentAttempt: null }); });

afterEach(() => vi.useRealTimers());

it('records a paid policy awaiting the insurer certificate rather than issuing a certificate', async () => {
  vi.useFakeTimers();
  useStore.setState({ selectedQuote: { requestId: 'REQ-123456', name: 'Test insurer', coverage: 'Motor', price: 1200 }, customer: { fullName: 'Test Customer', email: 'customer@example.com' }, vehicleDetails: null, vehicleValue: 0, policyDates: null, premiumBreakdown: null, matchRtsaAnniversary: false, ncdCodeValidated: false, insurerReviews: [], policies: [], paymentReceipt: { transactionId: 'TX1', amount: 1200, status: 'Confirmed' } });
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Payment received' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('Sending your paid quote');
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.getByText('Awaiting certificate')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'My account' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /download certificate/i })).not.toBeInTheDocument();
  expect(useStore.getState().policies).toEqual(expect.arrayContaining([expect.objectContaining({ status: 'Awaiting insurer certificate', paymentStatus: 'Paid', premium: 1200 })]));
});

it.each([true, false])('confirms the selected cover without a contradictory catalogue name (saved request: %s)', async (saved) => {
  vi.useFakeTimers();
  useStore.setState({ selectedQuote: { requestId: 'REQ-COVER', name: 'Test insurer', coverage: 'Comprehensive Gold Plan', price: 1200 }, insuranceType: saved ? 'Comprehensive' : 'ThirdParty', quoteRequests: saved ? [{ id: 'REQ-COVER', insuranceType: 'ThirdParty' }] : [], customer: { email: 'customer@example.com' }, insurerReviews: [], policies: [], ncdCodeValidated: false });
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(1500); });
  expect(screen.getByText('Third party only')).toBeInTheDocument();
  expect(screen.queryByText(/Comprehensive Gold Plan/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('radio')).toHaveLength(5);
});

it('records the policy under the number the payment service issued, not one derived from the request id', async () => {
  vi.useFakeTimers();
  env.apiMode = 'http';
  useStore.setState({
    selectedQuote: { requestId: 'REQ-SERVER-123456', name: 'Test insurer', coverage: 'Motor', price: 1200 },
    quoteRequests: [],
    customer: { fullName: 'Test Customer', email: 'customer@example.com' },
    vehicleDetails: null,
    vehicleValue: 0,
    policyDates: null,
    premiumBreakdown: null,
    ncdCodeValidated: false,
    insurerReviews: [],
    policies: [],
    paymentReceipt: { transactionId: 'TX-SRV', amount: 1200, status: 'Confirmed', policyNumber: 'POL-MH2K9QX' },
  });
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(1500); });

  expect(useStore.getState().policies).toEqual([expect.objectContaining({ policyNumber: 'POL-MH2K9QX' })]);
});

it('falls back to a reference of its own while the payment service has issued no policy number', async () => {
  vi.useFakeTimers();
  useStore.setState({
    selectedQuote: { requestId: 'REQ-SERVER-123456', name: 'Test insurer', coverage: 'Motor', price: 1200 },
    quoteRequests: [],
    customer: { fullName: 'Test Customer', email: 'customer@example.com' },
    vehicleDetails: null,
    vehicleValue: 0,
    policyDates: null,
    premiumBreakdown: null,
    ncdCodeValidated: false,
    insurerReviews: [],
    policies: [],
    paymentReceipt: { transactionId: 'TX-SRV', amount: 1200, status: 'Confirmed', policyNumber: null },
  });
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(1500); });

  expect(useStore.getState().policies).toEqual([expect.objectContaining({ policyNumber: 'POL-123456' })]);
});

it('shows and persists the RTSA fee that was charged by the payment service', async () => {
  vi.useFakeTimers();
  useStore.setState({
    selectedQuote: { requestId: 'REQ-RTSA', name: 'Test insurer', coverage: 'Motor', price: 1200 },
    quoteRequests: [{ id: 'REQ-RTSA', insuranceType: 'Comprehensive', rtsaAnniversaryFee: 500 }],
    customer: { fullName: 'Test Customer', email: 'customer@example.com' },
    vehicleDetails: null,
    vehicleValue: 0,
    policyDates: null,
    premiumBreakdown: null,
    ncdCodeValidated: false,
    insurerReviews: [],
    policies: [],
    paymentReceipt: { transactionId: 'TX-RTSA', amount: 1700, rtsaAnniversaryFee: 500, status: 'Confirmed' },
  });
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(1500); });

  expect(screen.getByText('RTSA anniversary fee')).toBeInTheDocument();
  expect(screen.getByText('ZMW 1,700.00')).toBeInTheDocument();
  expect(useStore.getState().policies).toEqual(expect.arrayContaining([
    expect.objectContaining({ premium: 1200, insurancePremium: 1200, rtsaAnniversaryFee: 500 }),
  ]));
});


it.each([true, false])('does not fabricate an HTTP policy on direct confirmation navigation (quote present: %s)', async (withQuote) => {
  vi.useFakeTimers();
  env.apiMode = 'http';
  useStore.setState({ selectedQuote: withQuote ? { requestId: 'REQ-HELD', name: 'Insurer', price: 1200 } : null,
    paymentReceipt: { transactionId: 'TX-HELD', status: 'Confirmed', policyNumber: null, amount: 1200 },
    policies: [], ncdCodeValidated: true, ncdCodeUsed: false, insurerReviews: [] });
  const view = render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  expect(screen.getByRole('heading', { name: 'Payment held — awaiting resolution' })).toBeInTheDocument();
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(useStore.getState().policies).toEqual([]);
  expect(useStore.getState().ncdCodeUsed).toBe(false);
  view.unmount();
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByRole('heading', { name: 'Payment held — awaiting resolution' })).toBeInTheDocument();
  expect(useStore.getState().policies).toEqual([]);
});

it('does not create an HTTP policy without a confirmed receipt', async () => {
  vi.useFakeTimers(); env.apiMode = 'http';
  useStore.setState({ selectedQuote: { requestId: 'REQ-UNPAID', price: 1200 }, paymentReceipt: null, policies: [], insurerReviews: [] });
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByRole('heading', { name: 'Nothing to confirm yet' })).toBeInTheDocument();
  expect(useStore.getState().policies).toEqual([]);
});


it.each(['Cancelled', 'Expired', 'Failed'])('does not create a policy for a late captured %s receipt on direct navigation', async (status) => {
  vi.useFakeTimers(); env.apiMode = 'http';
  useStore.setState({ selectedQuote: { requestId: 'REQ-LATE', price: 1200 }, paymentReceipt: { status, confirmedAt: '2026-11-26T10:00:00Z', policyNumber: null, transactionId: 'TX-LATE', amount: 1200 }, policies: [], insurerReviews: [] });
  render(<MemoryRouter><PolicyConfirmationPage /></MemoryRouter>);
  await act(async () => { vi.advanceTimersByTime(2000); });
  expect(screen.getByRole('heading', { name: 'Payment held — awaiting resolution' })).toBeInTheDocument();
  expect(useStore.getState().policies).toEqual([]);
});
