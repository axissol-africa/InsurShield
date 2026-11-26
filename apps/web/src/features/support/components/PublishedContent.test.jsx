import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { api } from '@/api';
import PublishedContent from './PublishedContent';
vi.mock('@/api', () => ({ api: { customerContent: { published: vi.fn() } } }));
beforeEach(() => vi.resetAllMocks());
it('loads the public endpoint and renders approved plain text without interpreting HTML', async () => {
  api.customerContent.published.mockResolvedValue({ items: [
    { id: 'faq', slug: 'faq', type: 'FAQ', version: 2, title: 'Customer question', body: 'The approved answer.' },
    { id: 'legal', slug: 'legal', type: 'LEGAL', version: 1, title: 'Approved legal copy', body: '<script>doNotRun()</script>' },
    { id: 'notice', slug: 'notice', type: 'NOTICE', version: 1, title: 'Customer notice', body: 'An approved update.' },
  ] });
  const { container } = render(<PublishedContent />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading');
  expect(await screen.findByRole('heading', { name: 'Customer question' })).toBeInTheDocument();
  expect(screen.getByText('The approved answer.')).toBeInTheDocument();
  expect(screen.getByText('<script>doNotRun()</script>')).toBeInTheDocument();
  expect(container.querySelector('script')).toBeNull();
  expect(screen.getByText('FAQ · Version 2')).toBeInTheDocument();
  expect(api.customerContent.published).toHaveBeenCalledTimes(1);
});
it('handles an empty publication independently of platform defaults', async () => {
  api.customerContent.published.mockResolvedValue({ items: [] });
  render(<PublishedContent />);
  expect(await screen.findByText('There is no additional published information at the moment.')).toBeInTheDocument();
});
it('retries a failed read without showing internal error details', async () => {
  api.customerContent.published.mockRejectedValueOnce(new Error('private SQL error')).mockResolvedValueOnce({ items: [] });
  render(<PublishedContent />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  expect(screen.queryByText('private SQL error')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('There is no additional published information at the moment.')).toBeInTheDocument();
});
it('discards previously loaded copy when a focus refresh fails', async () => {
  api.customerContent.published.mockResolvedValueOnce({ items: [{ id: 'notice', type: 'NOTICE', version: 1, title: 'Old publication', body: 'Old text' }] })
    .mockRejectedValueOnce(new Error('offline'));
  render(<PublishedContent />);
  await screen.findByText('Old publication');
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByRole('alert');
  expect(screen.queryByText('Old publication')).not.toBeInTheDocument();
});
it('does not revive a stale response after a newer refresh returns', async () => {
  let finishOld;
  api.customerContent.published.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
    .mockResolvedValueOnce({ items: [] });
  render(<PublishedContent />);
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText('There is no additional published information at the moment.');
  await act(async () => finishOld({ items: [{ id: 'old', title: 'Withdrawn wording', body: 'Stale' }] }));
  expect(screen.queryByText('Withdrawn wording')).not.toBeInTheDocument();
});
