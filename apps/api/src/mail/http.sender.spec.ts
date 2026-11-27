import { Logger } from '@nestjs/common';
import { createRequestContext, withRequestContext } from '../observability/request-context.js';
import { HttpMailSender } from './http.sender.js';
import type { MailMessage } from './mail.port.js';

const SETTINGS = {
  endpoint: 'https://mail.example.invalid/send',
  apiKey: 'secret-key',
  from: 'InsurShield <no-reply@insurshield.zm>',
  timeoutMs: 1_000,
};

const message: MailMessage = {
  to: 'customer@example.zm',
  subject: 'Your quote is ready',
  body: 'Open your quote: https://insurshield.zm/quotes/QR-1',
  idempotencyKey: 'notification:QR-1',
};

function senderWith(fetchImpl: typeof fetch) {
  vi.stubGlobal('fetch', fetchImpl);
  return new HttpMailSender(SETTINGS);
}

const ok = (body: unknown, status = 202) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('HttpMailSender', () => {
  it('sends the message and keeps the provider reference for the receipt', async () => {
    const calls: Array<[string, RequestInit]> = [];
    const sender = senderWith(((url: string, init: RequestInit) => {
      calls.push([url, init]);
      return Promise.resolve(ok({ id: 'prov-99' }));
    }) as unknown as typeof fetch);

    await expect(sender.send(message)).resolves.toEqual({ result: 'sent', providerId: 'prov-99' });

    const [url, init] = calls[0];
    expect(url).toBe(SETTINGS.endpoint);
    expect((init.headers as Record<string, string>)['idempotency-key']).toBe('notification:QR-1');
    expect(JSON.parse(init.body as string)).toEqual({
      from: SETTINGS.from,
      to: [message.to],
      subject: message.subject,
      text: message.body,
    });
  });

  it('still counts as sent when the provider accepts without a usable reference', async () => {
    const sender = senderWith((() => Promise.resolve(ok({}, 202))) as unknown as typeof fetch);

    await expect(sender.send(message)).resolves.toEqual({ result: 'sent', providerId: 'accepted:202' });
  });

  it.each([
    ['rate limited', 429, true],
    ['unavailable', 503, true],
    ['gateway timeout', 504, true],
    ['rejected address', 422, false],
    ['bad credentials', 401, false],
  ])('treats %s as retryable=%s, so a refusal is not retried forever', async (_case, status, retryable) => {
    const sender = senderWith((() =>
      Promise.resolve(new Response('{}', { status }))) as unknown as typeof fetch);

    await expect(sender.send(message)).resolves.toMatchObject({ result: 'failed', retryable });
  });

  it('retries an unreachable provider, because whether it sent is unknown', async () => {
    const sender = senderWith((() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch);

    await expect(sender.send(message)).resolves.toMatchObject({ result: 'failed', retryable: true });
  });

  it('bounds the wait, so a hung provider does not hold a job lease', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const sender = senderWith((() => Promise.reject(timeout)) as unknown as typeof fetch);

    await expect(sender.send(message)).resolves.toEqual({
      result: 'failed',
      retryable: true,
      reason: 'the provider did not answer in time',
    });
  });

  it('keeps the recipient and the key out of a failure reason', async () => {
    const sender = senderWith((() =>
      Promise.resolve(new Response(`refused ${message.to}`, { status: 422 }))) as unknown as typeof fetch);

    const result = await sender.send(message);

    const reason = result.result === 'failed' ? result.reason : '';
    expect(reason).not.toContain(message.to);
    expect(reason).not.toContain(SETTINGS.apiKey);
  });
});


describe('mail HTTP observability', () => {
  it('propagates a child trace and logs no recipient, key, destination, body or provider response', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const parent = createRequestContext();
    const fetchMock = vi.fn(async (_url: unknown, _init?: RequestInit) => ok({ id: 'private-provider-reference' }));
    const sender = senderWith(fetchMock as typeof fetch);
    try {
      await withRequestContext(parent, () => sender.send(message));
      const init = fetchMock.mock.calls[0][1];
      expect(new Headers(init?.headers).get('traceparent')).toMatch(new RegExp(`^00-${parent.traceId}-[0-9a-f]{16}-00$`));
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const record = JSON.parse(String(log.mock.calls[0][0]));
      expect(record).toMatchObject({ target: 'mail', parentSpanId: parent.spanId, outcome: 'success', statusCode: 202 });
      const text = JSON.stringify(log.mock.calls);
      for (const secret of [message.to, message.body, message.subject, message.idempotencyKey, SETTINGS.endpoint, SETTINGS.apiKey, 'private-provider-reference']) expect(text).not.toContain(secret);
    } finally { log.mockRestore(); }
  });
});
