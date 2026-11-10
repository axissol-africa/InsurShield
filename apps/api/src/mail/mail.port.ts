/**
 * What sending a message needs from a mail provider, and nothing more.
 *
 * The adapter is given a rendered message and answers whether the provider
 * accepted it. It never sees the customer record, the template, or why the
 * message is being sent.
 */
export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. The provider's own formatting is not the platform's business. */
  body: string;
  /**
   * Stable for the message this is: a provider that supports it uses this to
   * reject a duplicate, so a retry after an ambiguous failure cannot send twice.
   */
  idempotencyKey: string;
}

export type MailResult =
  /** Accepted. `providerId` is the provider's own reference, for the delivery receipt. */
  | { result: 'sent'; providerId: string }
  /**
   * Not accepted. `retryable` separates a provider that was unreachable from one
   * that refused the message: retrying a refusal only burns attempts, and a
   * rejected address never becomes valid by trying again.
   */
  | { result: 'failed'; retryable: boolean; reason: string };

export interface MailSender {
  /** The adapter's name, recorded on the delivery receipt as provenance. */
  readonly name: string;
  send(message: MailMessage): Promise<MailResult>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');
