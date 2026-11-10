import type { MailMessage, MailResult, MailSender } from '../src/mail/mail.port.js';

/**
 * Records what would have been sent, so a spec can assert on the message
 * without a provider or a log to parse.
 */
export class MailFake implements MailSender {
  readonly name = 'fake';

  readonly sent: MailMessage[] = [];

  /** Set to make the next sends fail, for the paths that handle a refusal. */
  result: MailResult = { result: 'sent', providerId: 'fake-1' };

  send(message: MailMessage): Promise<MailResult> {
    this.sent.push(message);
    return Promise.resolve(this.result);
  }

  lastTo(email: string): MailMessage | undefined {
    return [...this.sent].reverse().find((message) => message.to === email);
  }
}
