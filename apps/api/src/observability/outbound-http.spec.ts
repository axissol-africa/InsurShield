import { Logger } from '@nestjs/common';
import { vi } from 'vitest';
import { observeOutboundHttp } from './outbound-http.js';
import { createRequestContext, currentRequestContext, withRequestContext } from './request-context.js';

describe('outbound HTTP spans', () => {
  const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  beforeEach(() => log.mockClear());
  afterAll(() => log.mockRestore());
  it('creates independent child spans under a local request without replacing its context', async () => {
    const parent = createRequestContext();
    const propagated: string[] = [];
    await withRequestContext(parent, async () => {
      await Promise.all(['mail', 'insurer'].map((target) => observeOutboundHttp(target as 'mail' | 'insurer', new AbortController().signal, async (header) => {
        propagated.push(header);
        expect(currentRequestContext()?.traceId).toBe(parent.traceId);
        expect(currentRequestContext()?.spanId).not.toBe(parent.spanId);
        return 202;
      }, (status) => status)));
      expect(currentRequestContext()).toBe(parent);
    });
    const records = log.mock.calls.map(([value]) => JSON.parse(String(value)));
    expect(records).toHaveLength(2);
    expect(new Set(records.map((row) => row.spanId)).size).toBe(2);
    for (const record of records) {
      expect(record).toMatchObject({ event: 'http.client.completed', spanKind: 'CLIENT', correlationId: parent.correlationId, traceId: parent.traceId, parentSpanId: parent.spanId, statusCode: 202, outcome: 'success' });
      expect(propagated).toContain(`00-${parent.traceId}-${record.spanId}-00`);
    }
  });
  it('starts a fresh local trace for a background delivery and preserves the result', async () => {
    const result = { status: 429, protectedResponse: 'private-provider' };
    await expect(observeOutboundHttp('mail', new AbortController().signal, async () => result, (value) => value.status)).resolves.toBe(result);
    const record = JSON.parse(String(log.mock.calls[0][0]));
    expect(record).toMatchObject({ parentSpanId: null, outcome: 'http_error', statusCode: 429 });
    expect(record.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-provider');
  });
  it.each(['error', 'timeout', 'aborted'] as const)('preserves %s failures without logging their text', async (outcome) => {
    const error = new Error('private-host-payload-response');
    if (outcome === 'timeout') error.name = 'TimeoutError';
    const controller = new AbortController();
    if (outcome === 'aborted') controller.abort();
    await expect(observeOutboundHttp('insurer', controller.signal, async () => { throw error; }, () => 200)).rejects.toBe(error);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ outcome, statusCode: null });
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-host');
  });
  it('does not turn an accepted send into a failure when a collector is unavailable', async () => {
    log.mockImplementationOnce(() => { throw new Error('sink unavailable'); });
    await expect(observeOutboundHttp('mail', new AbortController().signal, async () => 202, (status) => status)).resolves.toBe(202);
  });
});
