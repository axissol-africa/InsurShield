import { Logger } from '@nestjs/common';
import { createRequestContext, currentRequestContext, traceparent, withRequestContext } from './request-context.js';

const logger = new Logger('HttpObservability');
let droppedLogsTotal = 0;
type Outcome = 'success' | 'http_error' | 'timeout' | 'aborted' | 'error';

/** Observe only an adapter's existing operation. Never retries, resolves hosts, follows redirects or reads bodies. */
export async function observeOutboundHttp<T>(
  target: 'mail' | 'insurer',
  signal: AbortSignal,
  operation: (traceContext: string) => Promise<T>,
  statusOf: (result: T) => number,
): Promise<T> {
  const parent = currentRequestContext();
  const generated = createRequestContext();
  const context = Object.freeze({ ...generated, correlationId: parent?.correlationId ?? generated.correlationId, traceId: parent?.traceId ?? generated.traceId });
  const startedAt = performance.now();
  let statusCode: number | null = null;
  let outcome: Outcome = 'error';
  try {
    const result = await withRequestContext(context, () => operation(traceparent(context)));
    const status = statusOf(result);
    statusCode = Number.isInteger(status) && status >= 100 && status < 600 ? status : null;
    outcome = statusCode !== null && statusCode >= 200 && statusCode < 300 ? 'success' : 'http_error';
    return result;
  } catch (error) {
    outcome = (signal.aborted && signal.reason instanceof Error && signal.reason.name === 'TimeoutError')
      || (error instanceof Error && error.name === 'TimeoutError') ? 'timeout'
      : signal.aborted ? 'aborted' : 'error';
    throw error;
  } finally {
    const record = {
      event: 'http.client.completed', schemaVersion: 1, timestamp: new Date().toISOString(),
      ...context, parentSpanId: parent?.spanId ?? null, spanKind: 'CLIENT', target, method: 'POST', statusCode, outcome,
      durationMs: Math.min(86_400_000, Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000)), droppedLogsTotal,
    };
    try { logger.log(JSON.stringify(record)); }
    catch { droppedLogsTotal = Math.min(Number.MAX_SAFE_INTEGER, droppedLogsTotal + 1); }
  }
}
