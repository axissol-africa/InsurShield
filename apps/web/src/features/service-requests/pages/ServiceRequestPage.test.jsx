import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, MemoryRouter, Route, RouterProvider, Routes } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import ServiceRequestPage from './ServiceRequestPage';

vi.mock('@/api', () => ({ api: { serviceRequests: { get: vi.fn(), reply: vi.fn(), withdraw: vi.fn() }, documents: { get: vi.fn() } } }));

const request = (overrides = {}) => ({
  reference: 'SR-1',
  policyNumber: 'POL-1',
  insurer: 'Prestige Assurance',
  type: 'CANCELLATION',
  status: 'IN_REVIEW',
  reason: 'I sold the vehicle.',
  requestedEffectiveDate: '2026-12-01',
  decision: null,
  nextAction: null,
  completedAt: null,
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: '2026-11-21T08:00:00.000Z',
  updates: [
    { id: 'u1', author: 'CUSTOMER', message: 'I sold the vehicle.', statusFrom: null, statusTo: 'SUBMITTED', documents: [], createdAt: '2026-11-20T08:00:00.000Z' },
    { id: 'u2', author: 'INSURER', message: 'Send the sale agreement.', statusFrom: 'IN_REVIEW', statusTo: 'INFORMATION_REQUIRED', documents: [], createdAt: '2026-11-21T08:00:00.000Z' },
  ],
  ...overrides,
});

const show = () => render(
  <MemoryRouter initialEntries={['/service-requests/SR-1']}>
    <Routes><Route path="/service-requests/:reference" element={<ServiceRequestPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => vi.clearAllMocks());

it('asks the customer to answer when the insurer is waiting on them, and sends the answer', async () => {
  api.serviceRequests.get.mockResolvedValue(request({ status: 'INFORMATION_REQUIRED', nextAction: 'REPLY' }));
  api.serviceRequests.reply.mockResolvedValue(request({ status: 'IN_REVIEW' }));
  show();

  expect(await screen.findByText('The insurer needs more from you')).toBeInTheDocument();
  expect(within(screen.getByRole('list', { name: 'What has happened' })).getByText('Prestige Assurance')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Your answer'), 'Attached.');
  await userEvent.click(screen.getByRole('button', { name: 'Send answer' }));

  expect(api.serviceRequests.reply).toHaveBeenCalledWith('SR-1', { message: 'Attached.', files: [] });
  expect(await screen.findByText('Being reviewed')).toBeInTheDocument();
  expect(screen.queryByText('The insurer needs more from you')).not.toBeInTheDocument();
});

it('shows an approved cancellation with its end date and refund, and lets the customer withdraw it', async () => {
  api.serviceRequests.get.mockResolvedValue(request({
    status: 'APPROVED',
    decision: { outcome: 'APPROVED', note: 'Pro rata.', refundAmount: 450.5, effectiveDate: '2026-12-01', decidedAt: '2026-11-22T08:00:00.000Z' },
  }));
  api.serviceRequests.withdraw.mockResolvedValue(request({ status: 'WITHDRAWN' }));
  show();

  expect(await screen.findByText(/The insurer approved this/)).toBeInTheDocument();
  expect(screen.getByText(/Refund due/)).toHaveTextContent('450.50');
  await userEvent.click(screen.getByRole('button', { name: 'Withdraw this request' }));
  await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
  expect(api.serviceRequests.withdraw).toHaveBeenCalledWith('SR-1');
  expect(await screen.findByText('Withdrawn')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Withdraw this request' })).not.toBeInTheDocument();
});

it('isolates loaded details, drafts and confirmation when the request route changes', async () => {
  let loadSecond;
  api.serviceRequests.get.mockResolvedValueOnce(request({ status: 'INFORMATION_REQUIRED', nextAction: 'REPLY' }))
    .mockImplementationOnce(() => new Promise((resolve) => { loadSecond = resolve; }));
  const router = createMemoryRouter([{ path: '/service-requests/:reference', element: <ServiceRequestPage /> }], { initialEntries: ['/service-requests/SR-1'] });
  render(<RouterProvider router={router} />);
  await userEvent.type(await screen.findByLabelText('Your answer'), 'Private draft for request one.');
  await userEvent.upload(screen.getByLabelText('Attach documents'), new File(['proof'], 'request-one.pdf', { type: 'application/pdf' }));
  await userEvent.click(screen.getByRole('button', { name: 'Withdraw this request' }));
  await act(async () => router.navigate('/service-requests/SR-2'));
  expect(screen.queryByLabelText('Your answer')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Withdraw this request' })).not.toBeInTheDocument();
  await act(async () => loadSecond(request({ reference: 'SR-2', status: 'INFORMATION_REQUIRED', nextAction: 'REPLY' })));
  expect(screen.getByLabelText('Your answer')).toHaveValue('');
  expect(screen.queryByText('request-one.pdf')).not.toBeInTheDocument();
});
it('does not leave a prior request actionable when the next reference fails to load', async () => {
  api.serviceRequests.get.mockResolvedValueOnce(request()).mockRejectedValueOnce(new Error('Request was not found.'));
  const router = createMemoryRouter([{ path: '/service-requests/:reference', element: <ServiceRequestPage /> }], { initialEntries: ['/service-requests/SR-1'] });
  render(<RouterProvider router={router} />);
  await screen.findByRole('button', { name: 'Withdraw this request' });
  await act(async () => router.navigate('/service-requests/MISSING'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Request was not found.');
  expect(screen.queryByRole('button', { name: 'Withdraw this request' })).not.toBeInTheDocument();
});
