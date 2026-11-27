export const MAX_HTTP_METRIC_SERIES = 256;
export const HTTP_METRIC_WINDOW_MS = 60_000;
export const LATENCY_BOUNDS_MS = [10, 50, 100, 250, 500, 1_000, 2_000, 5_000] as const;

interface Series {
  method: string;
  route: string;
  statusClass: string;
  count: number;
  durationSumMs: number;
  durationMaxMs: number;
  /** Disjoint buckets, with the last bucket above the final finite bound. */
  latencyBuckets: number[];
}

const add = (left: number, right: number) => Math.min(Number.MAX_SAFE_INTEGER, left + right);

/** Delta windows; the overflow series preserves totals without retaining unbounded label sets or samples. */
export class HttpMetrics {
  private readonly series = new Map<string, Series>();
  private readonly overflow = new Map<string, Series>();
  private startedAt: number;
  private droppedLogs = 0;

  constructor(private readonly emit: (record: Record<string, unknown>) => void, private readonly clock = () => performance.now()) {
    this.startedAt = clock();
  }

  write(record: Record<string, unknown>): void {
    try { this.emit(record); }
    catch { this.droppedLogs = add(this.droppedLogs, 1); }
  }

  observe(method: string, route: string, statusCode: number | null, durationMs: number): void {
    if (this.clock() - this.startedAt >= HTTP_METRIC_WINDOW_MS) this.flush();
    const statusClass = statusCode === null ? 'aborted'
      : Number.isInteger(statusCode) && statusCode >= 100 && statusCode < 600 ? `${Math.floor(statusCode / 100)}xx` : 'other';
    const key = `${method} ${route} ${statusClass}`;
    let series = this.series.get(key);
    if (!series) {
      if (this.series.size >= MAX_HTTP_METRIC_SERIES) {
        series = this.overflow.get(statusClass) ?? this.newSeries('OTHER', '__overflow__', statusClass);
        this.overflow.set(statusClass, series);
      } else {
        series = this.newSeries(method, route, statusClass);
        this.series.set(key, series);
      }
    }
    series.count = add(series.count, 1);
    series.durationSumMs = add(series.durationSumMs, durationMs);
    series.durationMaxMs = Math.max(series.durationMaxMs, durationMs);
    const bucket = LATENCY_BOUNDS_MS.findIndex((bound) => durationMs <= bound);
    const index = bucket === -1 ? LATENCY_BOUNDS_MS.length : bucket;
    series.latencyBuckets[index] = add(series.latencyBuckets[index], 1);
  }

  flush(): void {
    const now = this.clock();
    if (this.series.size || this.overflow.size || this.droppedLogs) {
      this.write({
        event: 'http.metrics', schemaVersion: 1, timestamp: new Date().toISOString(), temporality: 'delta',
        windowDurationMs: Math.max(0, Math.round(now - this.startedAt)),
        latencyBoundsMs: [...LATENCY_BOUNDS_MS, null], droppedLogsTotal: this.droppedLogs,
        series: [...this.series.values(), ...this.overflow.values()],
      });
    }
    this.series.clear();
    this.overflow.clear();
    this.startedAt = now;
  }

  private newSeries(method: string, route: string, statusClass: string): Series {
    return { method, route, statusClass, count: 0, durationSumMs: 0, durationMaxMs: 0, latencyBuckets: Array.from({ length: LATENCY_BOUNDS_MS.length + 1 }, () => 0) };
  }
}
