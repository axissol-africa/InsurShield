import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePortalAction } from './usePortalAction';

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
