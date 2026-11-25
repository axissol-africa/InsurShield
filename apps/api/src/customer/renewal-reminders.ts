import { Injectable, Logger } from '@nestjs/common';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { daysUntil, LAPSED_NOTICE_DAYS, openRenewal, reminderDue, type ReminderDue } from './domain/renewal.js';
import { PoliciesRepository } from './policies.repository.js';
import { customerDate } from './quote-workflow.service.js';

export const RENEWAL_REMINDERS = 'policies.renewal-reminders';
const DAY_MS = 86_400_000;

/** One run a day, keyed by the day, so a restart cannot queue it twice. */
export function renewalReminderKey(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Tells customers their cover is ending, on the reminder days of the
 * `RENEWAL_POLICY` setting, and once after it has ended. Each reminder is
 * recorded before it is sent, so a second run sends nothing more; a policy
 * already being renewed, or renewed and paid, is left alone. Notifications
 * go through the notification service, so the customer's channel choices
 * apply (FR-REN-003).
 */
@Injectable()
export class RenewalReminders {
  private readonly logger = new Logger(RenewalReminders.name);

  constructor(
    private readonly policies: PoliciesRepository,
    private readonly jobs: JobsRepository,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async schedule(at: Date): Promise<void> {
    await this.jobs.transaction((tx) => this.jobs.enqueue(tx, { kind: RENEWAL_REMINDERS, key: renewalReminderKey(at), payload: {}, runAfter: at }));
  }

  async run(now = new Date()): Promise<number> {
    await this.schedule(new Date(now.getTime() + DAY_MS));
    const { value } = await this.settings.effective('RENEWAL_POLICY', now);
    const furthest = Math.max(...value.reminderDays);
    const ending = await this.policies.endingBetween(
      new Date(now.getTime() - (LAPSED_NOTICE_DAYS + 1) * DAY_MS),
      new Date(now.getTime() + (furthest + 1) * DAY_MS),
    );
    const numbers = ending.map((policy) => policy.policyNumber);
    const renewals = await this.policies.renewalsOf(numbers);
    const paid = await this.policies.paidRenewalsOf(numbers);
    const sent = await this.policies.remindersOf(numbers);

    let count = 0;
    for (const policy of ending) {
      if (paid.has(policy.policyNumber)) continue;
      if (openRenewal(renewals.filter((renewal) => renewal.renewalOfPolicyNumber === policy.policyNumber), now)) continue;
      const daysRemaining = daysUntil(policy.policyEndDate!, now);
      const already = sent
        .filter((reminder) => reminder.policyNumber === policy.policyNumber)
        .map((reminder) => ({ kind: reminder.kind, daysBefore: reminder.daysBefore }) as ReminderDue);
      const due = reminderDue(daysRemaining, value.reminderDays, already);
      if (!due) continue;
      const delivered = await this.policies.transaction(async (tx) => {
        if (!(await this.policies.recordReminder(tx, { policyNumber: policy.policyNumber, ...due }))) return false;
        await this.notifications.notify(tx, {
          customerId: policy.customerId,
          key: due.kind === 'LAPSED' ? 'policy.lapsed' : 'policy.renewal_due',
          entity: { type: 'POLICY', id: policy.policyNumber },
          values: {
            policyNumber: policy.policyNumber,
            insurer: policy.insurerName,
            endDate: customerDate(policy.policyEndDate!),
            daysRemaining: String(Math.max(daysRemaining, 0)),
          },
        });
        return true;
      });
      if (delivered) count += 1;
    }
    if (count > 0) this.logger.log(`Renewal reminders sent: ${count}`);
    return count;
  }
}
