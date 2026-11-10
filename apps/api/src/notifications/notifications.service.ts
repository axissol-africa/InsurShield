import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Transaction } from '../db/database.module.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { MAIL_SENDER, type MailSender } from '../mail/mail.port.js';
import { maySend, overriddenBy } from './domain/preference.js';
import { activeVersion, render } from './domain/template.js';
import { NotificationsRepository } from './notifications.repository.js';

/** The job kind the runner delivers a message under. */
export const NOTIFICATION_EMAIL = 'notification.email';

export interface NotifyRequest {
  customerId: string;
  /** The template key, which names the event rather than the wording. */
  key: string;
  entity: { type: string; id: string };
  /** Values for the template's placeholders. Identifiers and names, not records. */
  values?: Record<string, string>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly repository: NotificationsRepository,
    private readonly jobs: JobsRepository,
    @Inject(MAIL_SENDER) private readonly mail: MailSender,
  ) {}

  /**
   * Writes the message and schedules anything that has to leave the platform,
   * in the caller's transaction.
   *
   * A message therefore commits with the state change it announces, or not at
   * all: there is no moment where a customer has been told about a payment
   * that was rolled back.
   */
  async notify(tx: Transaction, request: NotifyRequest, now = new Date()): Promise<void> {
    const versions = await this.repository.templatesFor(tx, request.key);
    const byChannel = new Map<string, typeof versions>();
    for (const version of versions) {
      byChannel.set(version.channel, [...(byChannel.get(version.channel) ?? []), version]);
    }

    const preferences = await this.repository.preferencesFor(tx, request.customerId);

    let sent = 0;
    for (const [channel, candidates] of byChannel) {
      const template = activeVersion(candidates, now);
      // A key with no active version for this channel is not an error: a
      // template can be retired by letting its successor go unpublished.
      if (!template) continue;
      const addressed = {
        category: template.category,
        channel: channel as 'IN_APP' | 'EMAIL',
        mandatory: template.mandatory,
      };
      // A customer who turned this category off on this channel is not told,
      // unless the message is one they cannot turn off.
      if (!maySend(addressed, preferences)) continue;
      const values = request.values ?? {};
      const notification = await this.repository.insert(tx, {
        customerId: request.customerId,
        templateKey: template.key,
        templateVersion: template.version,
        channel: addressed.channel,
        category: template.category,
        // Recorded, not inferred: why a customer received a message they had
        // switched off is answerable from the row rather than from the code
        // that was running at the time.
        mandatory: overriddenBy(addressed, preferences) !== null || template.mandatory,
        entityType: request.entity.type,
        entityId: request.entity.id,
        subject: render(template.subject, values),
        body: render(template.body, values),
        // An in-app message is delivered by existing; only a channel that
        // leaves the platform has a delivery to wait for.
        deliveryStatus: channel === 'IN_APP' ? 'SENT' : 'PENDING',
        deliveredAt: channel === 'IN_APP' ? now : null,
      });
      if (channel === 'EMAIL') {
        await this.jobs.enqueue(tx, {
          kind: NOTIFICATION_EMAIL,
          // The notification's own id: this message, enqueued twice, is one job.
          key: notification.id,
          payload: { notificationId: notification.id },
        });
      }
      sent += 1;
    }

    if (sent === 0) {
      // Worth knowing: an event fired and nobody was told, because no template
      // for it has been published. Not an error the caller can act on.
      this.logger.warn(`No active notification template for ${request.key}`);
    }
  }

  /**
   * Sends one message. Registered as the handler for `notification.email`, so a
   * failure here is the runner's to retry rather than this method's to swallow.
   */
  async deliver(notificationId: string, now = new Date()): Promise<void> {
    const found = await this.repository.deliverable(notificationId);
    if (!found) return;
    const { notification, email } = found;
    if (notification.deliveryStatus === 'SENT') return;

    const result = await this.mail.send({
      to: email,
      subject: notification.subject,
      body: notification.body,
      idempotencyKey: `notification:${notification.id}`,
    });

    if (result.result === 'sent') {
      await this.repository.recordDelivery(notification.id, {
        status: 'SENT',
        providerReference: result.providerId,
        deliveredAt: now,
      });
      return;
    }

    if (!result.retryable) {
      // The provider refused the message; it will refuse it again. Recorded on
      // the notification, where it can be found, and the job is finished rather
      // than retried until its attempts run out on an answer that cannot change.
      await this.repository.recordDelivery(notification.id, {
        status: 'FAILED',
        providerReference: null,
        deliveredAt: null,
      });
      this.logger.error(`Mail refused for notification ${notification.id}: ${result.reason}`);
      return;
    }

    await this.repository.recordDelivery(notification.id, {
      status: 'PENDING',
      providerReference: null,
      deliveredAt: null,
    });
    // Thrown so the runner backs off and counts the attempt.
    throw new Error(`Mail failed: ${result.reason}`);
  }
}
