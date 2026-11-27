import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { createHttpObservability } from './http-observability.js';
import { vi } from 'vitest';

function response() {
  return Object.assign(new EventEmitter(), { writableFinished: false, statusCode: 200, setHeader: vi.fn() });
}

describe('request completion lifecycle', () => {
  it('records an interrupted response once as aborted, never as a successful 200', () => {
    const records: Record<string, unknown>[] = [];
    const observer = createHttpObservability((record) => records.push(record));
    const res = response();
    observer.middleware({ method: 'GET', route: { path: '/stream/:id' } } as Request, res as unknown as Response, () => {});
    res.emit('close');
    res.emit('finish');
    res.emit('close');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ outcome: 'aborted', statusCode: null, route: '/stream/:id' });
    expect(res.listenerCount('finish')).toBe(0);
    expect(res.listenerCount('close')).toBe(0);
    observer.flush();
    expect(records[1]).toMatchObject({ event: 'http.metrics', series: [expect.objectContaining({ statusClass: 'aborted', count: 1 })] });
  });
  it('records a normal finish once even when close follows, without retaining listeners', () => {
    const emit = vi.fn();
    const observer = createHttpObservability(emit);
    const res = response();
    observer.middleware({ method: 'GET', route: { path: '/health' } } as Request, res as unknown as Response, () => {});
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0]).toMatchObject({ healthProbe: 'live', statusCode: 200, outcome: 'completed' });
    expect(res.listenerCount('close')).toBe(0);
  });
  it('uses bounded fallback labels and leaves serving intact when its logger fails', () => {
    const observer = createHttpObservability(() => { throw new Error('sink failed'); });
    const res = response();
    const next = vi.fn();
    observer.middleware({ method: 'PRIVATE_METHOD', route: { path: /private-path/ } } as Request, res as unknown as Response, next);
    expect(next).toHaveBeenCalledOnce();
    expect(() => res.emit('finish')).not.toThrow();
    expect(() => observer.flush()).not.toThrow();
  });
});
