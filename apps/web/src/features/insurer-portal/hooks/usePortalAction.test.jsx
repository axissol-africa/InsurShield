import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useKeyedPortalAction, usePortalAction } from './usePortalAction';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
};

describe('usePortalAction', () => {
  it('is pending while the action runs and reports success', async () => {
    const work = deferred();
    const action = vi.fn().mockReturnValue(work.promise);
    const { result } = renderHook(() => usePortalAction(action, 'Could not save.'));

    let outcome;
    act(() => { outcome = result.current.run('CLM-1', 'Received'); });
    expect(result.current.pending).toBe(true);
    expect(action).toHaveBeenCalledExactlyOnceWith('CLM-1', 'Received');

    await act(async () => { work.resolve(); });
    expect(await outcome).toBe(true);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('ignores a second run while the first is in flight', async () => {
    const work = deferred();
    const action = vi.fn().mockReturnValue(work.promise);
    const { result } = renderHook(() => usePortalAction(action, 'Could not save.'));

    let second;
    act(() => { result.current.run(); second = result.current.run(); });
    expect(await second).toBe(false);
    expect(action).toHaveBeenCalledTimes(1);
    await act(async () => { work.resolve(); });
  });

  it('explains a failure in the given words and clears it on retry', async () => {
    const action = vi.fn().mockRejectedValueOnce(new Error('ECONNRESET 10.0.0.4')).mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => usePortalAction(action, 'Could not save. Please try again.'));

    let outcome;
    await act(async () => { outcome = await result.current.run(); });
    expect(outcome).toBe(false);
    expect(result.current.error).toBe('Could not save. Please try again.');
    expect(result.current.pending).toBe(false);

    await act(async () => { outcome = await result.current.run(); });
    expect(outcome).toBe(true);
    expect(result.current.error).toBe('');
  });
});

describe('useKeyedPortalAction', () => {
  it('lets a caller word the failure from what was thrown', async () => {
    const action = vi.fn().mockRejectedValue(new Error('Your insurer profile could not be found.'));
    const { result } = renderHook(() => usePortalAction(action, (caught) => caught.message));

    await act(async () => { await result.current.run(); });
    expect(result.current.error).toBe('Your insurer profile could not be found.');
  });

  it('tracks each record on its own, and refuses a second run for a record already in flight', async () => {
    const first = deferred();
    const second = deferred();
    const action = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useKeyedPortalAction(action, 'Could not save.'));

    act(() => { void result.current.run('QR-1', 'QR-1'); });
    act(() => { void result.current.run('QR-1', 'QR-1'); });
    act(() => { void result.current.run('QR-2', 'QR-2'); });
    expect(action).toHaveBeenCalledTimes(2);
    expect(result.current.pending('QR-1')).toBe(true);
    expect(result.current.pending('QR-2')).toBe(true);
    expect(result.current.pending('QR-3')).toBe(false);

    await act(async () => { first.reject(new Error('offline')); });
    expect(result.current.pending('QR-1')).toBe(false);
    expect(result.current.error('QR-1')).toBe('Could not save.');
    expect(result.current.pending('QR-2')).toBe(true);
    expect(result.current.error('QR-2')).toBe('');

    await act(async () => { second.resolve(); });
    expect(result.current.pending('QR-2')).toBe(false);
  });
});
