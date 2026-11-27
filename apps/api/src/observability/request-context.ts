import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';

export interface RequestContext {
  readonly correlationId: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly traceFlags: '00';
}

const contexts = new AsyncLocalStorage<RequestContext>();

/** Public ingress starts a new trace: forwarded headers are not an authenticated tracing boundary. */
export function createRequestContext(): RequestContext {
  return Object.freeze({
    correlationId: randomUUID(), traceId: randomId(16),
    spanId: randomId(8), traceFlags: '00',
  });
}

export function currentRequestContext(): RequestContext | undefined { return contexts.getStore(); }

export function withRequestContext<T>(context: RequestContext, work: () => T): T { return contexts.run(context, work); }

/** W3C version 00. No vendor state, baggage, identity or caller-provided sampling decision is propagated. */
export function traceparent(context: RequestContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.traceFlags}`;
}

function randomId(bytes: number): string {
  let id: string;
  do { id = randomBytes(bytes).toString('hex'); } while (/^0+$/.test(id));
  return id;
}
