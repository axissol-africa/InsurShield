import { Logger } from '@nestjs/common';
import type { Server } from 'node:http';
import type { Express, RequestHandler } from 'express';
import { httpMethod, httpRoute } from './http-labels.js';
import { HttpMetrics } from './http-metrics.js';
import { createRequestContext, traceparent, withRequestContext } from './request-context.js';

export function createHttpObservability(emit: (record: Record<string, unknown>) => void) {
  const metrics = new HttpMetrics(emit);
  const middleware: RequestHandler = (request, response, next) => {
    const startedAt = performance.now();
    const context = createRequestContext();
    response.setHeader('X-Correlation-Id', context.correlationId);
    response.setHeader('traceparent', traceparent(context));
    let completed = false;
    const complete = (outcome: 'completed' | 'aborted') => {
      if (completed) return;
      completed = true;
      response.removeListener('finish', finish);
      response.removeListener('close', close);
      const method = httpMethod(request);
      const route = httpRoute(request);
      const statusCode = outcome === 'completed' ? response.statusCode : null;
      const durationMs = Math.min(86_400_000, Math.max(0, Math.round((performance.now() - startedAt) * 1000) / 1000));
      metrics.observe(method, route, statusCode, durationMs);
      metrics.write({
        event: 'http.request.completed', schemaVersion: 1, timestamp: new Date().toISOString(),
        ...context, spanKind: 'SERVER', method, route, statusCode, durationMs, outcome,
        healthProbe: route === '/health' ? 'live' : route === '/health/ready' ? 'ready' : null,
      });
    };
    const finish = () => complete('completed');
    const close = () => complete(response.writableFinished ? 'completed' : 'aborted');
    response.once('finish', finish);
    response.once('close', close);
    withRequestContext(context, next);
  };
  return { middleware, flush: () => metrics.flush() };
}

const installed = new WeakSet<Express>();

/** No endpoint or background poller. Quiet windows are emitted on the next completion or server shutdown. */
export function installHttpObservability(express: Express, server: Server): void {
  if (installed.has(express)) return;
  installed.add(express);
  const logger = new Logger('HttpObservability');
  const observer = createHttpObservability((record) => logger.log(JSON.stringify(record)));
  express.use(observer.middleware);
  server.once('close', observer.flush);
}
