import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearPendingCommands, submitWithRetry } from './idempotency';

beforeEach(() => { sessionStorage.clear(); clearPendingCommands(); });

describe('submitWithRetry', () => {
  it('reuses a prepared payload and its idempotency key after a lost response', async () => {
    const prepare = vi.fn().mockResolvedValue({ documentId: 'doc-1' });
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error('Offline'), { code: 'NETWORK' })).mockResolvedValueOnce({ id: 'QR-1' });

    await expect(submitWithRetry({ operation: 'quote', fingerprint: 'journey-1', prepare, send })).rejects.toThrow('Offline');
    const result = await submitWithRetry({ operation: 'quote', fingerprint: 'journey-1', prepare, send });

    expect(result).toEqual({ id: 'QR-1' });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[1][0]).toEqual({ documentId: 'doc-1' });
    expect(send.mock.calls[1][1]).toBe(send.mock.calls[0][1]);
  });

  it('prepares a new command when the customer changes the journey', async () => {
    const prepare = vi.fn().mockResolvedValueOnce({ documentId: 'old' }).mockResolvedValueOnce({ documentId: 'new' });
    const send = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce({ id: 'QR-2' });

    await expect(submitWithRetry({ operation: 'quote', fingerprint: 'journey-1', prepare, send })).rejects.toThrow('Offline');
    await submitWithRetry({ operation: 'quote', fingerprint: 'journey-2', prepare, send });

    expect(prepare).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]).toEqual({ documentId: 'new' });
  });
});

it.each(['sessionStorage', 'fallback'])('clears prepared commands in %s on identity changes', async (storage) => {
  if (storage === 'fallback') vi.stubGlobal('sessionStorage', undefined);
  try {
    const prepare = vi.fn().mockResolvedValue({ documentId: 'old-owner-document' });
    const send = vi.fn().mockRejectedValue(new Error('Offline'));
    const input = { operation: 'ncd', fingerprint: 'same-input', prepare, send };
    await expect(submitWithRetry(input)).rejects.toThrow('Offline');
    clearPendingCommands();
    await expect(submitWithRetry(input)).rejects.toThrow('Offline');
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][1]).not.toBe(send.mock.calls[0][1]);
  } finally { clearPendingCommands(); vi.unstubAllGlobals(); }
});

it('does not restore or send an old identity command when preparation finishes after sign-out', async () => {
  let resolvePreparation;
  const send = vi.fn();
  const pending = submitWithRetry({ operation: 'ncd', fingerprint: 'old', prepare: () => new Promise((resolve) => { resolvePreparation = resolve; }), send });
  clearPendingCommands();
  resolvePreparation({ documentId: 'old-owner-document' });
  await expect(pending).rejects.toThrow('account changed');
  expect(send).not.toHaveBeenCalled();
  expect(sessionStorage.getItem('insurshield:pending-command:ncd')).toBeNull();
});

it('an old in-flight response cannot remove the new identity command', async () => {
  let resolveOld;
  const old = submitWithRetry({ operation: 'ncd', fingerprint: 'old', prepare: async () => ({}), send: () => new Promise((resolve) => { resolveOld = resolve; }) });
  await vi.waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  clearPendingCommands();
  await expect(submitWithRetry({ operation: 'ncd', fingerprint: 'new', prepare: async () => ({ owner: 'new' }), send: async () => { throw new Error('Offline'); } })).rejects.toThrow('Offline');
  resolveOld({});
  await expect(old).rejects.toThrow('account changed');
  expect(JSON.parse(sessionStorage.getItem('insurshield:pending-command:ncd')).payload).toEqual({ owner: 'new' });
});

it.each(['signOut', 'clearCustomerSession', 'deleteCurrentAccount'])('clears commands through the %s session action', async (action) => {
  const { useStore } = await import('@/store');
  useStore.setState({ customer: { email: 'old@example.com' } });
  sessionStorage.setItem('insurshield:pending-command:ncd', 'old');
  useStore.getState()[action]();
  expect(sessionStorage.getItem('insurshield:pending-command:ncd')).toBeNull();
});
