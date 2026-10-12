import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useStore } from '@/store';
import PolicyConfirmationPage from './PolicyConfirmationPage';

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
