import { setImmediate } from 'node:timers/promises';
import { Controller, Get, HttpException, Logger, Module, Post, type CallHandler, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DatabaseError } from 'pg';
import { vi } from 'vitest';
import { configureApp } from '../src/app.setup.js';
import { AUTH, AUTH_SETTINGS } from '../src/auth/auth.constants.js';
import { AuditService } from '../src/common/audit/audit.service.js';
import { DATABASE } from '../src/db/database.module.js';
import { LinkIssueInterceptor } from '../src/documents/link-issue.interceptor.js';
import { HealthController } from '../src/health/health.controller.js';
import { currentRequestContext } from '../src/observability/request-context.js';
import { StorageService } from '../src/storage/storage.service.js';

@Controller('probe')
class ProbeController {
  @Get('records/:id')
  async read() {
    const before = currentRequestContext();
    await setImmediate();
    return { before, after: currentRequestContext() };
  }
  @Post('records/:id')
  write() { return { ok: true }; }
  @Get('refused')
  refused() { throw new HttpException('Sign in', 401); }
  @Get('broken/:id')
  broken() { throw new Error('secret-stack-and-patient-record'); }
  @Get('busy')
  busy() {
    const error = new DatabaseError('secret SQL params', 0, 'error');
    error.code = '55P03';
    throw error;
  }
}

const database = { execute: vi.fn(async () => []) };
const storage = { isReachable: vi.fn(async () => true) };
@Module({
  controllers: [ProbeController, HealthController],
  providers: [
    { provide: DATABASE, useValue: database }, { provide: StorageService, useValue: storage },
    { provide: AUTH, useValue: { handler: async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } }) } },
    { provide: AUTH_SETTINGS, useValue: { API_PREFIX: 'api/v1', NODE_ENV: 'test', BETTER_AUTH_URL: 'https://identity.example.invalid' } },
    { provide: AuditService, useValue: {} },
    { provide: LinkIssueInterceptor, useValue: { intercept: (_context: unknown, next: CallHandler) => next.handle() } },
  ],
})
class ProbeModule {}

interface LogRecord {
  event: string;
  route?: string;
  method?: string;
  statusCode?: number;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  healthProbe?: string;
  [key: string]: unknown;
}

describe('observability through the configured HTTP pipeline (no infrastructure)', () => {
  let app: INestApplication;
  const records: LogRecord[] = [];
  const logged: unknown[] = [];
  const capture = (...args: unknown[]) => {
    logged.push(args);
    if (typeof args[0] === 'string' && args[0].startsWith('{')) records.push(JSON.parse(args[0]) as LogRecord);
  };
  let spies: Array<ReturnType<typeof vi.spyOn>>;
  beforeAll(async () => {
    spies = ['log', 'warn', 'error'].map((method) => vi.spyOn(Logger.prototype, method as 'log' | 'warn' | 'error').mockImplementation(capture));
    const module = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = module.createNestApplication();
    configureApp(app, { API_PREFIX: 'api/v1', CORS_ORIGINS: ['https://ui.example.invalid'], SWAGGER_ENABLED: false, TRUST_PROXY_HOPS: 0 });
    await app.listen(0, '127.0.0.1');
  }, 60_000);
  afterAll(async () => { await app.close(); for (const spy of spies) spy.mockRestore(); });
  beforeEach(() => { records.length = 0; logged.length = 0; database.execute.mockResolvedValue([]); storage.isReachable.mockResolvedValue(true); });
  const completions = () => records.filter((record) => record.event === 'http.request.completed');

  it('generates trustworthy IDs, keeps concurrent async context isolated, and never logs sensitive inputs', async () => {
    const incoming = '00-11111111111111111111111111111111-2222222222222222-01';
    const responses = await Promise.all(['private-person-a', 'private-person-b'].map((person) => request(app.getHttpServer())
      .get(`/api/v1/probe/records/${person}?token=private-query`)
      .set('x-correlation-id', 'private-caller-id').set('traceparent', incoming)
      .set('tracestate', 'private=secret').set('authorization', 'Bearer private-secret').set('cookie', 'session=private-cookie')
      .expect(200)));
    expect(completions()).toHaveLength(2);
    expect(new Set(completions().map((row) => row.correlationId)).size).toBe(2);
    for (const response of responses) {
      expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(response.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-00$/);
      expect(response.headers.traceparent).not.toBe(incoming);
      expect(response.body.before).toEqual(response.body.after);
      expect(response.body.after.correlationId).toBe(response.headers['x-correlation-id']);
      const entry = completions().find((row) => row.correlationId === response.headers['x-correlation-id']);
      expect(entry).toMatchObject({ route: '/api/v1/probe/records/:id', method: 'GET', statusCode: 200, outcome: 'completed', durationMs: expect.any(Number) });
      expect(response.headers.traceparent).toBe(`00-${entry?.traceId}-${entry?.spanId}-00`);
    }
    expect(currentRequestContext()).toBeUndefined();
    expect(JSON.stringify(logged)).not.toMatch(/private-|11111111111111111111111111111111|Bearer|authorization|session=/);
  });

  it('records validation/parser failures, unauthorized routes, and unmatched routes without their raw paths or bodies', async () => {
    await request(app.getHttpServer()).post('/api/v1/probe/records/private-id').send({ protectedRecord: 'private-body' }).expect(201);
    await request(app.getHttpServer()).post('/api/v1/probe/records/private-id').set('content-type', 'application/json').send('{"private-body"').expect(400);
    await request(app.getHttpServer()).get('/api/v1/probe/refused').expect(401);
    await request(app.getHttpServer()).get('/private-unknown?secret=private-value').expect(404);
    expect(completions().map((row) => row.statusCode)).toEqual([201, 400, 401, 404]);
    expect(completions().at(-1)?.route).toBe('__unmatched__');
    expect(JSON.stringify(logged)).not.toMatch(/private-|protectedRecord/);
  });

  it('preserves error and retry contracts while correlating only safe failure metadata', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/probe/broken/private-record').expect(500);
    expect(response.body).toEqual({ code: 'INTERNAL_ERROR', message: expect.any(String), details: null });
    expect(records.find((row) => row.event === 'http.request.failed')).toMatchObject({ correlationId: response.headers['x-correlation-id'], route: '/api/v1/probe/broken/:id', statusCode: 500 });
    const busy = await request(app.getHttpServer()).get('/api/v1/probe/busy').expect(503);
    expect(busy.headers['retry-after']).toBe('1');
    expect(busy.body.code).toBe('TRY_AGAIN');
    expect(JSON.stringify(logged)).not.toMatch(/private-record|secret-stack|secret SQL/);
    expect(records).toEqual(expect.arrayContaining([expect.objectContaining({ databaseCode: '55P03', code: 'TRY_AGAIN' })]));
  });

  it('observes identity responses and CORS preflight without changing their behavior', async () => {
    await request(app.getHttpServer()).post('/api/v1/identity/sign-in/email').send({ email: 'private-email', password: 'private-password' }).expect(200);
    expect(completions()[0]).toMatchObject({ route: '/api/v1/identity/*splat', statusCode: 200 });
    const preflight = await request(app.getHttpServer()).options('/api/v1/probe/records/private-id')
      .set('origin', 'https://ui.example.invalid').set('access-control-request-method', 'GET').expect(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://ui.example.invalid');
    expect(preflight.headers['access-control-allow-credentials']).toBe('true');
    expect(preflight.headers['access-control-expose-headers']).toBe('X-Correlation-Id,traceparent');
    expect(preflight.headers['x-correlation-id']).toBeTruthy();
    expect(completions()).toHaveLength(2);
    expect(JSON.stringify(logged)).not.toMatch(/private-/);
  });

  it('retains stable live and ready evidence, with dependency failures represented by status only in logs', async () => {
    const live = await request(app.getHttpServer()).get('/health').expect(200);
    expect(live.body).toEqual({ status: 'ok', uptimeSeconds: expect.any(Number) });
    expect(database.execute).not.toHaveBeenCalled();
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'up', dependencies: { database: 'up', storage: 'up' } });
    database.execute.mockRejectedValueOnce(new Error('private database connection'));
    storage.isReachable.mockResolvedValueOnce(false);
    const down = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(down.body).toEqual({ status: 'down', dependencies: { database: 'down', storage: 'down' } });
    expect(completions()).toEqual(expect.arrayContaining([
      expect.objectContaining({ healthProbe: 'live', statusCode: 200 }),
      expect.objectContaining({ healthProbe: 'ready', statusCode: 200 }),
      expect.objectContaining({ healthProbe: 'ready', statusCode: 503 }),
    ]));
    expect(JSON.stringify(logged)).not.toMatch(/private database/);
  });

  it('does not expose a public diagnostics endpoint', async () => {
    await request(app.getHttpServer()).get('/metrics').expect(404);
    await request(app.getHttpServer()).get('/api/v1/metrics').expect(404);
  });
});
