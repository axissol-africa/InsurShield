import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import ClaimsPage from './ClaimsPage';
import { useStore } from '@/store';
import { api } from '@/api';
import { env } from '@/config/env';
vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));
vi.mock('@/api/sync', () => ({ hydrateCustomer: vi.fn(), hydrateDirectory: vi.fn() }));
vi.mock('@/api/idempotency', () => ({ submitWithRetry: async ({ prepare, send }) => send(await prepare(), 'key') }));
vi.mock('@/api', () => ({ api: { claims: { notify: vi.fn(), intakeRules: vi.fn() }, documents: { upload: vi.fn() } } }));
const customer = { fullName: 'Mwiza Banda', email: 'mwiza@example.com', phone: '0970123456' };
beforeEach(() => {
  vi.clearAllMocks(); env.apiMode = 'http';
  api.claims.intakeRules.mockResolvedValue({ reportingDays: 30, responseDays: 7, excludedTypes: { COMPREHENSIVE: [], THIRD_PARTY: [] }, requireAttachmentsFor: [], requirePoliceReportFor: [] });
  useStore.setState({ customer, claims: [], policies: [{ policyNumber: 'POL-1', customerEmail: customer.email, insurer: 'Prestige Assurance', vehicle: 'Toyota Hilux', vehicleDetails: { plateNumber: 'BAA 1234' }, coverage: 'Comprehensive' }] });
});
const mount = () => render(<MemoryRouter initialEntries={['/claims?action=claim']}><ClaimsPage /></MemoryRouter>);
it.each([
  ['CLAIM_LATE_REASON_REQUIRED', {}, 'Reason for Late Submission'],
  ['CLAIM_INSURER_UNAVAILABLE', { reference: 'HELP-123', contact: { email: 'help@example.com', phone: '123', hours: 'Weekdays' } }, 'HELP-123'],
])('preserves policy and form on %s', async (code, details, expected) => {
  const user = userEvent.setup();
  api.claims.notify.mockRejectedValue(Object.assign(new Error('Please contact your insurer'), { code, details }));
  const { container } = mount();
  await user.click(await screen.findByRole('button', { name: /POL-1/ }));
  expect(screen.getByPlaceholderText('e.g. BAA 1234')).toHaveValue('BAA 1234');
  fireEvent.submit(container.querySelector('form'));
  expect(await screen.findByText('Please contact your insurer')).toBeVisible();
  expect(api.claims.notify).toHaveBeenCalledWith(expect.objectContaining({ policyNumber: 'POL-1', vehicle: 'Toyota Hilux' }), 'key');
  expect(screen.getByPlaceholderText('e.g. Mwiza Banda')).toHaveValue('Mwiza Banda');
  expect(container.textContent).toContain(expected);
});
it('requires an owned policy in real mode', async () => {
  useStore.setState({ policies: [] });
  const { container } = mount();
  fireEvent.submit(container.querySelector('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Select the policy');
  expect(api.claims.notify).not.toHaveBeenCalled();
});
it('retains prototype intake without a linked policy', async () => {
  env.apiMode = 'mock'; useStore.setState({ policies: [] });
  api.claims.notify.mockRejectedValue(new Error('Prototype request received'));
  const { container } = mount();
  expect(screen.getByText(/Prototype: you can notify/)).toBeInTheDocument();
  fireEvent.submit(container.querySelector('form'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Prototype request received');
  expect(api.claims.notify).toHaveBeenCalledWith(expect.objectContaining({ policyNumber: undefined }), 'key');
});
