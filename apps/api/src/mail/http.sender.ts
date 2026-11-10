import { Injectable, Logger } from '@nestjs/common';
import type { MailMessage, MailResult, MailSender } from './mail.port.js';

export interface HttpMailSettings {
  endpoint: string;
  apiKey: string;
  from: string;
  timeoutMs: number;
}

/** A provider that refused the message will refuse it again; one that could not answer may not. */
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Sends through a provider's HTTP API using the runtime's own `fetch`, so no
 * mail library is added.
 *
 * The provider's request and response shapes live in `request` and `reference`
 * below, and nowhere else: moving to another provider is those two functions,
 * not a new adapter.
 */
@Injectable()
export class HttpMailSender implements MailSender {
  readonly name = 'http';

  private readonly logger = new Logger(HttpMailSender.name);

  constructor(private readonly settings: HttpMailSettings) {}

  async send(message: MailMessage): Promise<MailResult> {
    // Without a deadline a hung provider holds a job's lease until it expires,
    // and the job is then retried while the first attempt may still be in
    // flight — the duplicate the idempotency key is there to stop.
    const timeout = AbortSignal.timeout(this.settings.timeoutMs);
    let response: Response;
    try {
      response = await fetch(this.settings.endpoint, { ...this.request(message), signal: timeout });
    } catch (error: unknown) {
      // Unreachable, refused, or timed out: the provider never answered, so
      // whether it sent is unknown. Retrying is safe because of the key above.
      return { result: 'failed', retryable: true, reason: describe(error) };
    }

    if (!response.ok) {
      const retryable = RETRYABLE_STATUS.has(response.status);
      if (!retryable) this.logger.error(`Mail provider refused a message: ${response.status}`);
      // The body may quote the recipient, so only the status is kept.
      return { result: 'failed', retryable, reason: `provider answered ${response.status}` };
    }

    return { result: 'sent', providerId: await this.reference(response) };
  }

  /** The provider's request shape. Changing provider changes this and `reference`. */
  private request(message: MailMessage): RequestInit {
    return {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.settings.apiKey}`,
        'content-type': 'application/json',
        'idempotency-key': message.idempotencyKey,
      },
      body: JSON.stringify({
        from: this.settings.from,
        to: [message.to],
        subject: message.subject,
        text: message.body,
      }),
    };
  }

  /** The provider's own reference for the message, for the delivery receipt. */
  private async reference(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { id?: unknown };
      return typeof body.id === 'string' ? body.id : `accepted:${response.status}`;
    } catch {
      // Accepted without a parseable body: the send stands, the reference does not.
      return `accepted:${response.status}`;
    }
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.name === 'TimeoutError' ? 'the provider did not answer in time' : error.name;
  return 'the provider could not be reached';
}
