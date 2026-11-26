import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '@/api';
import { requestIdentityTransition } from '@/app/identity';
import AccountPrivacy from './AccountPrivacy';
vi.mock('@/api', () => ({ api: { account: { export: vi.fn() }, auth: { signOut: vi.fn() } } }));
vi.mock('@/app/identity', () => ({ requestIdentityTransition: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it('downloads the returned JSON and prevents duplicate requests while pending', async () => {
  let resolve;
  api.account.export.mockReturnValue(new Promise((done) => { resolve = done; }));
  const create = vi.fn(() => 'blob:export');
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  render(<AccountPrivacy />);
  fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
  expect(screen.getByRole('button', { name: 'Preparing…' })).toBeDisabled();
  resolve({ profile: { fullName: 'Customer' } });
  await screen.findByText('Your data download is ready.');
  expect(api.account.export).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledWith(expect.any(Blob));
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
});
it('offers sign-in recovery only when the API requires recent authentication', async () => {
  api.account.export.mockRejectedValue(Object.assign(new Error('Sign in again to download your data.'), { code: 'REAUTHENTICATION_REQUIRED' }));
  api.auth.signOut.mockResolvedValue(undefined);
  render(<AccountPrivacy />);
  fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Sign out and sign in again' }));
  await waitFor(() => expect(requestIdentityTransition).toHaveBeenCalledWith(expect.objectContaining({ landing: '/create-account?next=%2Faccount%3Fsection%3Dprivacy' })));
});
it('explains actual blockers and shows server refusal', () => {
  const onClose = vi.fn();
  render(<AccountPrivacy onClose={onClose} accountError="A refund is pending." />);
  expect(screen.getByText(/Closure is blocked while cover/)).toHaveTextContent('a service request is open');
  expect(screen.getByRole('alert')).toHaveTextContent('A refund is pending.');
  fireEvent.click(screen.getByRole('button', { name: 'Close account' }));
  expect(onClose).toHaveBeenCalledOnce();
});
it('keeps a failed download retryable without claiming success', async () => {
  api.account.export.mockRejectedValue(new Error('Too many exports. Please try later.'));
  render(<AccountPrivacy />);
  fireEvent.click(screen.getByRole('button', { name: 'Download my data' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Too many exports');
  expect(screen.getByRole('button', { name: 'Download my data' })).toBeEnabled();
  expect(screen.queryByText('Your data download is ready.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sign out and sign in again' })).not.toBeInTheDocument();
});
