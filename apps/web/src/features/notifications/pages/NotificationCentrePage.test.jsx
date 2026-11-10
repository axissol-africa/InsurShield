import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import NotificationCentrePage from './NotificationCentrePage';

vi.mock('@/api', () => ({
  api: { notifications: { list: vi.fn(), markRead: vi.fn() } },
}));

const message = (overrides = {}) => ({
  id: 'n-1',
  subject: 'A quote is ready',
  body: 'Prestige Assurance has quoted.',
  category: 'QUOTE',
  entityType: 'QUOTE_REQUEST',
  entityId: 'QR-1',
  read: false,
  createdAt: '2026-11-10T09:00:00.000Z',
  ...overrides,
});

const show = () => render(<MemoryRouter><NotificationCentrePage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  api.notifications.markRead.mockResolvedValue(undefined);
});

it('lists what the customer has been told, with the unread count', async () => {
  api.notifications.list.mockResolvedValue({
    items: [message(), message({ id: 'n-2', subject: 'Payment received', read: true })],
    nextCursor: null,
    unread: 1,
  });
  show();

  expect(await screen.findByText('A quote is ready')).toBeInTheDocument();
  expect(screen.getByLabelText('1 unread')).toBeInTheDocument();
});

it('marks one read without waiting for the server to answer', async () => {
  api.notifications.list.mockResolvedValue({ items: [message()], nextCursor: null, unread: 1 });
  let resolve;
  api.notifications.markRead.mockReturnValue(new Promise((done) => { resolve = done; }));
  show();
  await screen.findByText('A quote is ready');

  await userEvent.click(screen.getByRole('button', { name: /mark read/i }));

  // The button is gone before the request settles: the reader sees their own tap.
  expect(screen.queryByRole('button', { name: /mark read/i })).not.toBeInTheDocument();
  resolve();
});

it('puts the list back when marking read fails, rather than showing a lie', async () => {
  api.notifications.list
    .mockResolvedValueOnce({ items: [message()], nextCursor: null, unread: 1 })
    .mockResolvedValueOnce({ items: [message()], nextCursor: null, unread: 1 });
  api.notifications.markRead.mockRejectedValue(new Error('offline'));
  show();
  await screen.findByText('A quote is ready');

  await userEvent.click(screen.getByRole('button', { name: /mark read/i }));

  await waitFor(() => expect(screen.getByRole('button', { name: /mark read/i })).toBeInTheDocument());
});

it('explains an empty centre rather than showing a bare page', async () => {
  api.notifications.list.mockResolvedValue({ items: [], nextCursor: null, unread: 0 });
  show();

  expect(await screen.findByText('Nothing yet')).toBeInTheDocument();
});

it('offers a retry when the list cannot be loaded', async () => {
  api.notifications.list.mockRejectedValueOnce(new Error('offline'));
  api.notifications.list.mockResolvedValueOnce({ items: [message()], nextCursor: null, unread: 1 });
  show();

  await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('A quote is ready')).toBeInTheDocument();
});

it('asks for older messages only while the server offers a cursor', async () => {
  api.notifications.list.mockResolvedValueOnce({ items: [message()], nextCursor: '2026-11-10T09:00:00.000Z', unread: 1 });
  api.notifications.list.mockResolvedValueOnce({ items: [message({ id: 'n-old', subject: 'Older' })], nextCursor: null, unread: 1 });
  show();

  await userEvent.click(await screen.findByRole('button', { name: 'Load older' }));

  expect(await screen.findByText('Older')).toBeInTheDocument();
  expect(api.notifications.list).toHaveBeenLastCalledWith('2026-11-10T09:00:00.000Z');
  expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
});
