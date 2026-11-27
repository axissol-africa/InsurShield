import { HttpMetrics, HTTP_METRIC_WINDOW_MS, LATENCY_BOUNDS_MS, MAX_HTTP_METRIC_SERIES } from './http-metrics.js';
import { vi } from 'vitest';

describe('bounded HTTP metrics', () => {
  it('caps series and retains every request in the overflow aggregate', () => {
    const emit = vi.fn();
    const metrics = new HttpMetrics(emit, () => 0);
    for (let index = 0; index < 2000; index++) metrics.observe('GET', `/registered-${index}`, 200, 20);
    metrics.flush();
    const record = emit.mock.calls[0][0];
    expect(record.series).toHaveLength(MAX_HTTP_METRIC_SERIES + 1);
    expect(record.series.reduce((total: number, row: { count: number }) => total + row.count, 0)).toBe(2000);
    expect(record.series.at(-1)).toMatchObject({ route: '__overflow__', count: 2000 - MAX_HTTP_METRIC_SERIES });
    expect(record.series.every((row: { latencyBuckets: number[] }) => row.latencyBuckets.length === LATENCY_BOUNDS_MS.length + 1)).toBe(true);
  });
  it('emits delta windows with disjoint latency buckets and separates errors and aborts', () => {
    let now = 0;
    const emit = vi.fn();
    const metrics = new HttpMetrics(emit, () => now);
    metrics.observe('GET', '/health/ready', 503, 10);
    metrics.observe('GET', '/health/ready', 503, 51);
    metrics.observe('GET', '/health/ready', null, 6000);
    now = HTTP_METRIC_WINDOW_MS;
    metrics.observe('GET', '/health', 200, 2);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][0].series[0]).toMatchObject({ statusClass: '5xx', count: 2, durationSumMs: 61, durationMaxMs: 51, latencyBuckets: [1, 0, 1, 0, 0, 0, 0, 0, 0] });
    expect(emit.mock.calls[0][0].series[1]).toMatchObject({ statusClass: 'aborted', count: 1 });
    metrics.flush();
    expect(emit.mock.calls[1][0].series).toHaveLength(1);
    metrics.flush();
    expect(emit).toHaveBeenCalledTimes(2);
  });
  it('distinguishes requests at the two-second API target from slower requests', () => {
    const emit = vi.fn();
    const metrics = new HttpMetrics(emit);
    metrics.observe('GET', '/api/v1/insurers', 200, 2_000);
    metrics.observe('GET', '/api/v1/insurers', 200, 2_001);
    metrics.flush();
    const { latencyBoundsMs, series: [{ latencyBuckets }] } = emit.mock.calls[0][0];
    const targetBucket = latencyBoundsMs.indexOf(2_000);
    expect(targetBucket).toBeGreaterThan(-1);
    expect(latencyBuckets[targetBucket]).toBe(1);
    expect(latencyBuckets[targetBucket + 1]).toBe(1);
  });
  it('does not fail request handling when a log sink fails and records the loss', () => {
    const emit = vi.fn().mockImplementationOnce(() => { throw new Error('sink unavailable'); });
    const metrics = new HttpMetrics(emit);
    expect(() => metrics.write({ event: 'http.request.completed' })).not.toThrow();
    metrics.flush();
    expect(emit.mock.calls[1][0]).toMatchObject({ droppedLogsTotal: 1 });
  });
});
