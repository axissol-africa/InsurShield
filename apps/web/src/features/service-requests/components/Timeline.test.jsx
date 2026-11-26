import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { env } from '@/config/env';
import { openAttachment } from '../shared';
import Timeline from './Timeline';
vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));
vi.mock('../shared', () => ({ openAttachment: vi.fn(), messageOf: (error) => error.message }));
const updates = [{ id: 'u1', author: 'INSURER', statusTo: 'INFORMATION_REQUIRED', message: 'Please send proof.', createdAt: '2026-11-20T08:00:00.000Z', documents: [{ id: 'DOC-1', name: 'proof.pdf' }] }];
beforeEach(() => { vi.clearAllMocks(); env.apiMode = 'http'; });
it('uses insurer status labels in staff history and customer labels in customer history', () => {
  const view = render(<Timeline updates={updates} insurer="Insurer" staffView />);
  expect(screen.getByText('Waiting for the customer')).toBeInTheDocument();
  expect(screen.queryByText('Waiting for you')).not.toBeInTheDocument();
  view.rerender(<Timeline updates={updates} insurer="Insurer" />);
  expect(screen.getByText('Waiting for you')).toBeInTheDocument();
});
it('shows mock attachments as unavailable metadata rather than broken download buttons', () => {
  env.apiMode = 'mock';
  render(<Timeline updates={updates} insurer="Insurer" />);
  expect(screen.getByText(/proof.pdf/)).toHaveTextContent('Download unavailable in demo');
  expect(screen.queryByRole('button', { name: 'proof.pdf' })).not.toBeInTheDocument();
});
it('offers a safe explicit link when the browser blocks the automatic popup', async () => {
  openAttachment.mockResolvedValue('https://documents.example.test/fresh');
  render(<Timeline updates={updates} insurer="Insurer" />);
  await userEvent.click(screen.getByRole('button', { name: 'proof.pdf' }));
  const link = await screen.findByRole('link', { name: 'Open proof.pdf' });
  expect(link).toHaveAttribute('href', 'https://documents.example.test/fresh');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});
