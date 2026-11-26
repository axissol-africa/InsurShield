import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import HelpDeskCard from './HelpDeskCard';

vi.mock('@/api', () => ({ api: { support: { contact: vi.fn() } } }));

const show = (signedIn) => render(<MemoryRouter><HelpDeskCard signedIn={signedIn} /></MemoryRouter>);
beforeEach(() => vi.clearAllMocks());

it('shows the help desk and the references the customer should quote', async () => {
  api.support.contact.mockResolvedValue({
    helpDesk: { email: 'help@example.zm', phone: '+260 211 000000', hours: 'Weekdays 08:00 to 17:00' },
    references: [{ type: 'SERVICE_REQUEST', reference: 'SR-1', status: 'INFORMATION_REQUIRED', createdAt: '2026-11-20T08:00:00.000Z' }],
  });
  show(true);
  expect(await screen.findByRole('link', { name: 'help@example.zm' })).toHaveAttribute('href', 'mailto:help@example.zm');
  expect(screen.getByText('Weekdays 08:00 to 17:00')).toBeInTheDocument();
  expect(screen.getByText('SR-1')).toBeInTheDocument();
  expect(screen.getByText('Service request · Waiting for you')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy SR-1' })).toBeInTheDocument();
});

it('says so when the help desk is not set up, and asks a guest to sign in', async () => {
  api.support.contact.mockResolvedValue({ helpDesk: { email: null, phone: null, hours: null }, references: [] });
  const { unmount } = show(true);
  expect(await screen.findByText(/contact details are not set up yet/)).toBeInTheDocument();
  unmount();
  show(false);
  expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
  expect(api.support.contact).toHaveBeenCalledTimes(1);
});
