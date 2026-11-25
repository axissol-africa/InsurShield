import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { api } from '@/api';
import { useStore } from '@/store';
import AccountPortfolio from './AccountPortfolio';
vi.mock('@/api', () => ({ api: { account: { documents: vi.fn() }, serviceRequests: { listMine: vi.fn() }, documents: { get: vi.fn() } } }));
beforeEach(() => {
  vi.clearAllMocks();
  useStore.setState({ customer: { email: 'mine@example.com' }, policies: [{ policyNumber: 'POL-MINE', customerEmail: 'mine@example.com', status: 'Active', vehicle: 'Toyota', insurer: 'My insurer' }, { policyNumber: 'POL-OTHER', customerEmail: 'other@example.com', status: 'Active' }], quoteRequests: [] });
  api.account.documents.mockResolvedValue([]); api.serviceRequests.listMine.mockResolvedValue([]);
});
it('searches owned portfolio records and clears an empty result', async () => {
  render(<MemoryRouter><AccountPortfolio /></MemoryRouter>);
  await screen.findByText('No documents yet.');
  expect(screen.queryByText(/POL-OTHER/)).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'missing' } });
  expect(screen.getByText('No records match these filters.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByRole('link', { name: 'View policy' })).toHaveAttribute('href', '/account?section=policies');
});
it('shows loading, a recoverable metadata error, then unavailable documents', async () => {
  api.account.documents.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([{ id: 'doc', name: 'Certificate.pdf', kind: 'CERTIFICATE', type: 'application/pdf', size: 100, available: false }]);
  render(<MemoryRouter><AccountPortfolio section="documents" /></MemoryRouter>);
  expect(screen.getByText(/Loading documents/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry loading' }));
  expect(await screen.findByRole('button', { name: 'Download unavailable' })).toBeDisabled();
  expect(api.documents.get).not.toHaveBeenCalled();
});
it('preserves the service timeline path and next reply action', async () => {
  api.serviceRequests.listMine.mockResolvedValue([{ reference: 'SR-1', type: 'DETAILS_CHANGE', status: 'INFORMATION_REQUIRED', insurer: 'My insurer', nextAction: 'REPLY' }]);
  render(<MemoryRouter><AccountPortfolio section="service-requests" /></MemoryRouter>);
  expect(await screen.findByRole('link', { name: 'Reply to insurer' })).toHaveAttribute('href', '/service-requests/SR-1');
});
it('sorts recent records first, paginates and resets the page on search', async () => {
  api.account.documents.mockResolvedValue(Array.from({ length: 7 }, (_, index) => ({ id: `doc-${index}`, name: `Document ${index}`, kind: 'DOCUMENT', size: 100, available: false, uploadedAt: `2026-11-${String(index + 1).padStart(2, '0')}` })));
  render(<MemoryRouter><AccountPortfolio section="documents" /></MemoryRouter>);
  await screen.findByText('Document 6');
  expect(screen.queryByText('Document 0')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Go to next page' }));
  expect(screen.getByText('Document 0')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Document 6' } });
  expect(screen.getByText('Document 6')).toBeInTheDocument();
});

it('clears remote rows immediately when the account identity changes', async () => {
  api.account.documents.mockResolvedValueOnce([{ id: 'private', name: 'Previous customer document', kind: 'DOCUMENT', size: 100, available: false }]).mockReturnValueOnce(new Promise(() => {}));
  render(<MemoryRouter><AccountPortfolio section="documents" /></MemoryRouter>);
  await screen.findByText('Previous customer document');
  const { act } = await import('@testing-library/react');
  act(() => useStore.setState({ customer: { email: 'new@example.com' } }));
  expect(screen.queryByText('Previous customer document')).not.toBeInTheDocument();
  expect(screen.getByText(/Loading documents/)).toBeInTheDocument();
});
it('requests a fresh protected document link and surfaces opening failures', async () => {
  api.account.documents.mockResolvedValue([{ id: 'protected', name: 'Policy.pdf', kind: 'CERTIFICATE', available: true, size: 100 }]);
  api.documents.get.mockRejectedValue(new Error('Document no longer available.'));
  const popup = { opener: null, close: vi.fn() };
  const open = vi.spyOn(window, 'open').mockReturnValue(popup);
  render(<MemoryRouter><AccountPortfolio section="documents" /></MemoryRouter>);
  fireEvent.click(await screen.findByRole('button', { name: 'Open document' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Document no longer available.');
  expect(api.documents.get).toHaveBeenCalledWith('protected');
  expect(popup.close).toHaveBeenCalledOnce();
  open.mockRestore();
});
