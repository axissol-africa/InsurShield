import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../src/common/auth/auth.guard.js';
import { ApiRateLimit } from '../src/common/rate-limit/api-rate-limit.guard.js';
import { openTestDatabase, startApp, type TestApp } from './helpers.js';
import { uniqueAddress } from './sessions.js';

const TEST_POLICY = { bucket: 'batch3-rate-limit-probe', limit: 2, windowMs: 60_000 };

@Public()
@Controller('rate-limit-probe')
class RateLimitProbeController {
  @Get()
  @ApiRateLimit(TEST_POLICY)
  probe() {
    return { ok: true };
  }
}

describe('the shared API rate limiter', () => {
  let side: ReturnType<typeof openTestDatabase>;

  beforeAll(() => {
    side = openTestDatabase();
  });

  afterAll(async () => {
    try {
      await side.db.execute(sql`DELETE FROM auth_rate_limits WHERE key LIKE 'api|batch3-rate-limit-probe|%'`);
    } finally {
      await side.close();
    }
  });

  async function limitedApp(trustProxyHops = '1'): Promise<TestApp> {
    return startApp({
      controllers: [RateLimitProbeController],
      env: { API_RATE_LIMIT: 'on', TRUST_PROXY_HOPS: trustProxyHops },
    });
  }

  it('limits one client address, returns the standard error body, and leaves another client unaffected', async () => {
    const app = await limitedApp();
    const exhausted = uniqueAddress();
    const fresh = uniqueAddress();
    try {
      await app.http.get('/api/v1/rate-limit-probe').set('X-Forwarded-For', exhausted).expect(200);
      await app.http.get('/api/v1/rate-limit-probe').set('X-Forwarded-For', exhausted).expect(200);
      const limited = await app.http.get('/api/v1/rate-limit-probe').set('X-Forwarded-For', exhausted).expect(429);

      expect(limited.body).toEqual({
        code: 'RATE_LIMITED',
        message: 'Too many requests. Please wait a moment and try again.',
        details: { retryAfterSeconds: 60 },
      });
      expect(limited.headers['retry-after']).toBe('60');
      await app.http.get('/api/v1/rate-limit-probe').set('X-Forwarded-For', fresh).expect(200);
    } finally {
      await app.close();
    }
  });

  it('does not trust a forwarded address when no proxy is configured', async () => {
    const app = await limitedApp('0');
    try {
      await app.http.get('/api/v1/rate-limit-probe').set('X-Forwarded-For', uniqueAddress()).expect(200);
      await app.http.get('/api/v1/rate-limit-probe').set('X-Forwarded-For', uniqueAddress()).expect(200);
      await app.http.get('/api/v1/rate-limit-probe').set('X-Forwarded-For', uniqueAddress()).expect(429);
    } finally {
      await app.close();
    }
  });
});
