import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import ServiceRequestsTab from './ServiceRequestsTab';

const summary = (overrides = {}) => ({
  reference: 'SR-1',
  policyNumber: 'POL-1',
  insurer: 'Prestige Assurance',
  type: 'CANCELLATION',
  status: 'SUBMITTED',
  requestedEffectiveDate: '2026-12-01',
  decision: null,
  createdAt: '2026-11-20T08:00:00.000Z',
  updatedAt: '2026-11-20T08:00:00.000Z',
  customerName: 'Bwalya Mutale',
  ...overrides,
});
const detail = (overrides = {}) => ({
  ...summary(overrides),
  customer: { fullName: 'Bwalya Mutale', email: 'bwalya@example.zm', phone: '+260 97 000 0000' },
  updates: [{ id: 'u1', author: 'CUSTOMER', authorName: 'Bwalya Mutale', visibleToCustomer: true, message: 'I sold the vehicle.', statusFrom: null, statusTo: 'SUBMITTED', documents: [], createdAt: '2026-11-20T08:00:00.000Z' }],
  ...overrides,
});

let api;
beforeEach(() => {
  api = {
    serviceRequests: {
      insurer: {
        list: vi.fn().mockResolvedValue([summary(), summary({ reference: 'SR-2', status: 'COMPLETED', type: 'ASSISTANCE' })]),
        get: vi.fn().mockResolvedValue(detail()),
        review: vi.fn(),
        requestInformation: vi.fn(),
        postUpdate: vi.fn(),
        decline: vi.fn(),
        approve: vi.fn().mockResolvedValue(detail({ status: 'APPROVED' })),
        complete: vi.fn(),
      },
    },
  };
});

it('lists open requests first and hides finished ones until asked', async () => {
  render(<ServiceRequestsTab api={api} canManage />);
  expect(await screen.findByText(/Cancel my cover · Bwalya Mutale/)).toBeInTheDocument();
  expect(screen.queryByText(/Ask for help/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'All' }));
  expect(screen.getByText(/Ask for help · Bwalya Mutale/)).toBeInTheDocument();
});

it('wants a refund and an end date before it approves a cancellation', async () => {
  render(<ServiceRequestsTab api={api} canManage />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
  expect(screen.queryByRole('button', { name: 'Cancel the policy now' })).not.toBeInTheDocument();
  await userEvent.click(await screen.findByRole('button', { name: 'Approve the cancellation' }));
  await userEvent.type(screen.getByLabelText('Note to the customer'), 'Pro rata from the day you asked.');
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter the refund in kwacha');

  await userEvent.type(screen.getByLabelText('Refund (ZMW)'), '450.5');
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
  expect(api.serviceRequests.insurer.approve).toHaveBeenCalledWith('SR-1', { note: 'Pro rata from the day you asked.', refundAmount: 450.5, effectiveDate: '2026-12-01' });
  expect(await screen.findByRole('button', { name: 'Cancel the policy now' })).toBeInTheDocument();
});

it('shows a reader the request without any step', async () => {
  render(<ServiceRequestsTab api={api} canManage={false} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Open' }));
  expect(await screen.findByText('I sold the vehicle.')).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Steps' })).not.toBeInTheDocument();
});
