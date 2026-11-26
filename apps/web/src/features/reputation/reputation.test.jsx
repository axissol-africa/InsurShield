import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { api } from '@/api';
import { env } from '@/config/env';
import { useInsurerReputation } from './hooks/useInsurerReputation';
import { InsurerReputation } from './components/InsurerReputation';
import ProductVersionSelection from '@/features/quote-journey/components/ProductVersionSelection';
vi.mock('@/api', () => ({ api: { insurerReputation: { list: vi.fn() }, products: { directory: vi.fn(), estimate: vi.fn() } } }));
vi.mock('@/config/env', () => ({ env: { apiMode: 'http' } }));
const id = '11111111-1111-4111-8111-111111111111';
const rating = { average: 4.2, reviewCount: 24, minimumReviews: 10, periodStart: '2026-01-01', periodEnd: '2026-10-01', method: 'Arithmetic mean of published verified reviews', ruleVersion: 2 };
const badge = { insurerId: id, code: 'ON_TIME_CERTIFICATES', label: 'On-time certificates', sampleCount: 100, onTimeCount: 98, minimumPolicies: 50, thresholdBps: 9500, percentage: 98, periodStart: '2026-01-01', periodEnd: '2026-10-01', awardedAt: '2026-10-01', expiresAt: '2026-12-01', ruleVersion: 2, dataSource: 'Platform issuance records', method: 'Issued before the agreed deadline', disclaimer: 'Past performance does not guarantee future service.' };
const item = { insurerId: id, rating, badges: [badge] };
beforeEach(() => { badge.expiresAt = new Date(Date.now() + 86400000).toISOString(); vi.resetAllMocks(); env.apiMode = 'http'; api.insurerReputation.list.mockResolvedValue({ items: [item] }); });
it('batches unique UUIDs, skips demo IDs, and keeps stable requests across reorder', async () => {
  const ids = Array.from({ length: 101 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
  const { result, rerender } = renderHook(({ values }) => useInsurerReputation(values), { initialProps: { values: [...ids, ids[0], 'demo'] } });
  await waitFor(() => expect(result.current.loading).not.toBe(true));
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(2);
  expect(api.insurerReputation.list.mock.calls.map(([batch]) => batch.length)).toEqual([100, 1]);
  rerender({ values: [...ids].reverse() });
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(2);
});
it('aborts old requests and never shows stale results for another insurer', async () => {
  let resolve;
  api.insurerReputation.list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result, rerender } = renderHook(({ ids }) => useInsurerReputation(ids), { initialProps: { ids: [id] } });
  const signal = api.insurerReputation.list.mock.calls[0][1].signal;
  rerender({ ids: ['demo'] });
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ items: [item] }));
  expect(result.current.items).toEqual([]);
});
it('skips mock mode and non-UUID identifiers', () => {
  env.apiMode = 'mock';
  renderHook(() => useInsurerReputation([id]));
  env.apiMode = 'http';
  renderHook(() => useInsurerReputation(['demo']));
  expect(api.insurerReputation.list).not.toHaveBeenCalled();
});
it('explains ratings and badge evidence without fabricated stars', async () => {
  render(<InsurerReputation insurerId={id} />);
  expect(await screen.findByText('4.2 out of 5 · 24 verified reviews')).toBeVisible();
  expect(screen.getByText(/98 of 100 eligible policies/)).toBeVisible();
  expect(screen.getByText(/Qualification threshold: 95%; minimum sample: 50/)).toBeVisible();
  expect(screen.getByText(new RegExp(`Expires: ${new Date(badge.expiresAt).toLocaleDateString('en-GB', { timeZone: 'Africa/Lusaka' })}`))).toBeVisible();
  expect(screen.getByText(badge.disclaimer)).toBeVisible();
  expect(screen.getByText(/Arithmetic mean/)).toBeVisible();
});
it('does not turn a withheld average into a zero rating', async () => {
  api.insurerReputation.list.mockResolvedValue({ items: [{ ...item, rating: { ...rating, average: null, reviewCount: 4 }, badges: [] }] });
  render(<InsurerReputation insurerId={id} />);
  expect(await screen.findByText('Not enough reviews for a rating yet · 4 verified reviews')).toBeVisible();
  expect(screen.queryByText(/out of 5/)).not.toBeInTheDocument();
});
it('handles provisional results and ancillary errors', async () => {
  api.insurerReputation.list.mockResolvedValueOnce({ items: [] });
  const { unmount } = render(<InsurerReputation insurerId={id} />);
  expect(await screen.findByText('No published ratings or performance badges are available.')).toBeVisible();
  unmount();
  api.insurerReputation.list.mockRejectedValue(new Error('Offline'));
  render(<InsurerReputation insurerId={id} />);
  expect(await screen.findByText(/temporarily unavailable/)).toBeVisible();
});
it('explains an awarded badge on a cover option without requiring a published insurer profile', async () => {
  const product = { product: { id: 'first' }, insurer: { id, name: 'Insurer' }, version: { id: 'first', name: 'First', number: 1, requirements: [] } };
  api.products.directory.mockResolvedValue([product]);
  render(<MemoryRouter><ProductVersionSelection selectedProductVersionIds={[]} onSelectionChange={vi.fn()} vehicleValue={10000} vehicleUsage="PRIVATE" /></MemoryRouter>);
  const details = await screen.findByRole('button', { name: /On-time certificates/ });
  expect(details).toHaveAttribute('aria-expanded', 'false');
  await userEvent.setup().click(details);
  expect(details).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByText(/98 of 100 eligible policies/)).toBeVisible();
  expect(screen.getByText(badge.disclaimer)).toBeVisible();
  expect(screen.getByRole('checkbox', { name: 'Select First from Insurer' })).not.toBeChecked();
});

it.each([false, true])('keeps cover order, selection and estimates independent of reputation failure=%s', async (failure) => {
  const products = ['First', 'Second'].map((name) => ({ product: { id: name }, insurer: { id, name: 'Insurer' }, version: { id: name, name, number: 1, requirements: [] } }));
  api.products.directory.mockResolvedValue(products);
  api.products.estimate.mockResolvedValue({ estimatedPremium: 200 });
  if (failure) api.insurerReputation.list.mockRejectedValueOnce(new Error('Offline'));
  const onSelectionChange = vi.fn();
  render(<MemoryRouter><ProductVersionSelection selectedProductVersionIds={['First']} onSelectionChange={onSelectionChange} vehicleValue={10000} vehicleUsage="PRIVATE" /></MemoryRouter>);
  const choices = await screen.findAllByRole('checkbox');
  expect(choices[0]).toHaveAccessibleName('Select First from Insurer');
  expect(choices[0]).toBeChecked();
  await waitFor(() => expect(api.products.estimate).toHaveBeenCalledTimes(1));
  await userEvent.setup().click(choices[1]);
  expect(onSelectionChange).toHaveBeenCalledWith(['First', 'Second'], products);
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole('link', { name: /View insurer profile/ })[0]).toHaveAttribute('href', `/insurers/${id}`);
  if (failure) {
    expect(await screen.findByText('Insurer ratings and badges are temporarily unavailable.')).toBeVisible();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry ratings and badges' }));
  }
  expect(await screen.findAllByText('4.2 out of 5 · 24 verified reviews')).toHaveLength(2);
  expect(screen.queryByText(/temporarily unavailable/)).not.toBeInTheDocument();
});


afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('expires each badge at its deadline even while a refresh never responds', async () => {
  vi.useFakeTimers();
  const now = Date.now();
  const badges = [1000, 2000].map((delay, index) => ({ ...badge, code: `badge-${index}`, expiresAt: new Date(now + delay).toISOString() }));
  api.insurerReputation.list.mockResolvedValueOnce({ items: [{ ...item, badges }] }).mockImplementation(() => new Promise(() => {}));
  const { result } = renderHook(() => useInsurerReputation([id]));
  await act(async () => {});
  expect(result.current.items[0].badges).toHaveLength(2);
  act(() => window.dispatchEvent(new Event('focus')));
  await act(async () => vi.advanceTimersByTimeAsync(999));
  expect(result.current.items[0].badges).toHaveLength(2);
  await act(async () => vi.advanceTimersByTimeAsync(1));
  expect(result.current.items[0].badges.map((value) => value.code)).toEqual(['badge-1']);
  await act(async () => vi.advanceTimersByTimeAsync(1000));
  expect(result.current.items[0].badges).toEqual([]);
  expect(result.current.items[0].rating).toEqual(rating);
});

it('refreshes suspension in the foreground and cleans up timers and listeners', async () => {
  vi.useFakeTimers();
  api.insurerReputation.list.mockResolvedValueOnce({ items: [item] }).mockResolvedValue({ items: [{ ...item, badges: [] }] });
  const { result, unmount } = renderHook(() => useInsurerReputation([id]));
  await act(async () => {});
  expect(result.current.items[0].badges).toHaveLength(1);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(2);
  expect(result.current.items[0].badges).toEqual([]);
  unmount();
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(120000); });
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it('waits for visibility and coalesces focus, visibility and polling during a request', async () => {
  vi.useFakeTimers();
  let visibility = 'hidden';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  let resolve;
  api.insurerReputation.list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result } = renderHook(() => useInsurerReputation([id]));
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(120000); });
  expect(api.insurerReputation.list).not.toHaveBeenCalled();
  visibility = 'visible';
  act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('focus')); });
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(1);
  await act(async () => resolve({ items: [item] }));
  expect(result.current.items[0].badges).toHaveLength(1);
  visibility = 'hidden';
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(1);
  visibility = 'visible';
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(2);
});

it('filters already expired or invalid deadlines from responses and keeps explicit retry after failure', async () => {
  vi.useFakeTimers();
  api.insurerReputation.list.mockResolvedValueOnce({ items: [{ ...item, badges: [
    { ...badge, expiresAt: new Date(Date.now()).toISOString() }, { ...badge, expiresAt: 'invalid' },
  ] }] }).mockRejectedValueOnce(new Error('Offline'));
  const { result } = renderHook(() => useInsurerReputation([id]));
  await act(async () => {});
  expect(result.current.items[0].badges).toEqual([]);
  await act(async () => vi.advanceTimersByTimeAsync(60000));
  expect(result.current.error).toBe(true);
  await act(async () => result.current.reload());
  expect(result.current.error).not.toBe(true);
  expect(result.current.items[0].badges).toHaveLength(1);
});

it('preserves batch order and prevents overlapping refreshes until every batch settles', async () => {
  vi.useFakeTimers();
  const ids = Array.from({ length: 101 }, (_, i) => `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`);
  let resolveFirst;
  api.insurerReputation.list
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ items: [{ ...item, insurerId: ids[100] }] });
  const { result, unmount } = renderHook(() => useInsurerReputation(ids));
  await act(async () => { window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(60000); });
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(2);
  await act(async () => resolveFirst({ items: [{ ...item, insurerId: ids[0] }] }));
  expect(result.current.items.map((value) => value.insurerId)).toEqual([ids[0], ids[100]]);
  let resolveLast;
  api.insurerReputation.list
    .mockRejectedValueOnce(new Error('Offline'))
    .mockImplementationOnce(() => new Promise((resolve) => { resolveLast = resolve; }));
  await act(async () => window.dispatchEvent(new Event('focus')));
  await act(async () => vi.advanceTimersByTimeAsync(120000));
  expect(api.insurerReputation.list).toHaveBeenCalledTimes(4);
  await act(async () => resolveLast({ items: [item] }));
  expect(result.current.error).toBe(true);
  unmount();
  expect(api.insurerReputation.list.mock.calls.every(([, options]) => options.signal.aborted)).toBe(true);
});

it('rechecks expiry on foreground return after a suspended clock without resurrecting late responses', async () => {
  vi.useFakeTimers();
  const now = Date.now();
  badge.expiresAt = new Date(now + 1000).toISOString();
  let resolve;
  api.insurerReputation.list.mockResolvedValueOnce({ items: [item] })
    .mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result } = renderHook(() => useInsurerReputation([id]));
  await act(async () => {});
  act(() => window.dispatchEvent(new Event('focus')));
  vi.setSystemTime(now + 2000);
  act(() => document.dispatchEvent(new Event('visibilitychange')));
  expect(result.current.items[0].badges).toEqual([]);
  await act(async () => resolve({ items: [item] }));
  expect(result.current.items[0].badges).toEqual([]);
});
