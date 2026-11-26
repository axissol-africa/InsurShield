import { beforeEach, expect, it, vi } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import { useStore } from '@/store';
const render = (ui) => rtlRender(ui);
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { api } from '@/api';
import InsurerProfilePage from './InsurerProfilePage';
vi.mock('@/api', () => ({ api: { insurerProfiles: { public: vi.fn() }, reviews: { publicForInsurer: vi.fn() } } }));
const profile = { insurerId: 'insurer', name: 'Registered insurer', status: 'ACTIVE', licence: { current: true, number: 'LIC-1' }, profile: { brandName: 'Approved brand', description: 'Approved description', serviceInformation: 'Call for help', websiteUrl: 'javascript:alert(1)' }, products: [{ versionId: 'v1', name: 'Motor cover', coverType: 'COMPREHENSIVE' }] };
const mount = () => render(<MemoryRouter initialEntries={['/insurers/insurer']}><Routes><Route path="/insurers/:insurerId" element={<InsurerProfilePage />} /></Routes></MemoryRouter>);
beforeEach(() => { vi.resetAllMocks(); useStore.setState({ customer: { email: 'customer@example.com' }, leaving: false }); api.insurerProfiles.public.mockResolvedValue(profile); api.reviews.publicForInsurer.mockResolvedValue({ items: [], hasMore: false, page: 1 }); });
it('shows only approved fields and an empty public review result, without unsafe links', async () => {
  mount(); expect(await screen.findByRole('heading', { name: 'Approved brand' })).toBeVisible();
  expect(await screen.findByText('No published reviews are available.')).toBeVisible();
  expect(screen.queryByRole('link', { name: /Visit insurer website/ })).not.toBeInTheDocument();
  expect(screen.getByText('Licence: Current · LIC-1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Next reviews' })).toBeDisabled();
});
it('handles an unapproved profile without requesting reviews', async () => {
  api.insurerProfiles.public.mockRejectedValue({ status: 404 }); mount();
  expect(await screen.findByRole('heading', { name: 'Profile not available' })).toBeVisible();
  expect(api.reviews.publicForInsurer).not.toHaveBeenCalled();
});
it('paginates published reviews and approved replies and recovers from failures', async () => {
  const user = userEvent.setup();
  api.reviews.publicForInsurer.mockResolvedValueOnce({ items: [{ id: 'r1', rating: 5, text: 'Approved review', publishedAt: '2026-11', response: { text: 'Approved response', publishedAt: '2026-11' } }], hasMore: true, page: 1 }).mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ items: [], hasMore: false, page: 2 });
  mount(); expect(await screen.findByText('Approved response')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Next reviews' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Offline');
  expect(screen.queryByText('Approved review')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry reviews' }));
  expect(await screen.findByText('No published reviews are available.')).toBeVisible();
  expect(api.reviews.publicForInsurer).toHaveBeenLastCalledWith('insurer', 2, { signal: expect.any(AbortSignal) });
});

it('renders only HTTPS approved logos without a referrer and handles invalid review months', async () => {
  api.insurerProfiles.public.mockResolvedValue({ ...profile, profile: { ...profile.profile, logoUrl: 'https://example.test/approved-logo.png' } });
  api.reviews.publicForInsurer.mockResolvedValue({ items: [{ id: 'r1', rating: 4, publishedAt: '2026-13', response: { text: 'Response', publishedAt: null } }], hasMore: false, page: 1 });
  mount();
  const logo = await screen.findByAltText('');
  expect(logo).toHaveAttribute('src', 'https://example.test/approved-logo.png');
  expect(logo).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(await screen.findByText('Verified policy purchase · Publication date unavailable')).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Insurer response · Publication date unavailable' })).toBeVisible();
});
it.each([null, '', 'http://example.test/logo.png', 'javascript:alert(1)'])('omits image markup for absent or unsafe logo %s', async (logoUrl) => {
  api.insurerProfiles.public.mockResolvedValue({ ...profile, profile: { ...profile.profile, logoUrl } });
  mount();
  await screen.findByRole('heading', { name: 'Approved brand' });
  expect(screen.queryByAltText('')).not.toBeInTheDocument();
});
