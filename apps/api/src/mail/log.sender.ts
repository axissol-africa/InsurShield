import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { MailMessage, MailResult, MailSender } from './mail.port.js';

/**
 * Writes the message to the log instead of sending it.
 *
 * It exists so a developer can follow a verification or reset link without a
 * provider account, and so the identity specs can drive those flows by reading
 * the link back out of the log. Batch 5's provider gate is what keeps it out of
 * production, so it does not check the environment itself.
 */
@Injectable()
export class LogMailSender implements MailSender {
  readonly name = 'log';

  private readonly logger = new Logger(LogMailSender.name);

  send(message: MailMessage): Promise<MailResult> {
    // One line per message, with the body last: the identity specs read a link
    // out of it, so the format is load-bearing, not decoration.
    this.logger.log(`Mail to ${message.to} — ${message.subject}\n${message.body}`);
    return Promise.resolve({ result: 'sent', providerId: `log:${randomUUID()}` });
  }
}
