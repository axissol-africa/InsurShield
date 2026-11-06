import { beforeEach, describe, expect, it, vi } from 'vitest';
import { submitWithRetry } from './idempotency';

beforeEach(() => sessionStorage.clear());

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
