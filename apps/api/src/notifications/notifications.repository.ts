import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, lt } from 'drizzle-orm';
import type {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
} from '../common/domain/enums.js';
import { DATABASE, type Database, type Transaction } from '../db/database.module.js';
import { contactPreferences, customers, marketingConsents, notificationTemplates, notifications } from '../db/schema.js';

export type NotificationRow = typeof notifications.$inferSelect;
export type TemplateRow = typeof notificationTemplates.$inferSelect;

/** What the runner needs to send a message: the wording, and who it goes to. */
export interface Deliverable {
  notification: NotificationRow;
  email: string;
}

@Injectable()
export class NotificationsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Every version of a key, for the domain to choose the active one from. */
  async templatesFor(tx: Transaction, key: string): Promise<TemplateRow[]> {
    return tx.select().from(notificationTemplates).where(eq(notificationTemplates.key, key));
  }

  /** Read in the caller's transaction, so a choice saved moments ago is seen. */
  async preferencesFor(tx: Transaction, customerId: string) {
    return tx
      .select({
        category: contactPreferences.category,
        channel: contactPreferences.channel,
        enabled: contactPreferences.enabled,
      })
      .from(contactPreferences)
      .where(eq(contactPreferences.customerId, customerId));
  }

  /** One row per customer, category and channel; saving again replaces the choice. */
  async setPreference(
    customerId: string,
    choice: { category: NotificationCategory; channel: NotificationChannel; enabled: boolean },
    now: Date,
  ): Promise<void> {
    await this.db
      .insert(contactPreferences)
      .values({ customerId, ...choice, updatedAt: now })
      .onConflictDoUpdate({
        target: [contactPreferences.customerId, contactPreferences.category, contactPreferences.channel],
        set: { enabled: choice.enabled, updatedAt: now },
      });
  }

  /** Append-only: a withdrawal is a new row, so the history survives. */
  async recordMarketingConsent(
    customerId: string,
    consent: { granted: boolean; noticeVersion: string; purpose: string; ipAddress?: string; userAgent?: string },
  ): Promise<void> {
    await this.db.insert(marketingConsents).values({ customerId, ...consent });
  }

  /** The latest answer, which is what a preference screen shows. */
  async marketingConsent(customerId: string): Promise<boolean> {
    const [latest] = await this.db
      .select({ granted: marketingConsents.granted })
      .from(marketingConsents)
      .where(eq(marketingConsents.customerId, customerId))
      .orderBy(desc(marketingConsents.recordedAt))
      .limit(1);
    // Never asked is not consent: marketing is the one category that stays off
    // until somebody says yes.
    return latest?.granted ?? false;
  }

  async insert(tx: Transaction, row: typeof notifications.$inferInsert): Promise<NotificationRow> {
    const [created] = await tx.insert(notifications).values(row).returning();
    return created;
  }

  /**
   * The message and its recipient, read at delivery rather than carried on the
   * job: the address may have changed since the job was enqueued, and a stale
   * copy would send to the old one.
   */
  async deliverable(id: string): Promise<Deliverable | undefined> {
    const [found] = await this.db
      .select({ notification: notifications, email: customers.email })
      .from(notifications)
      .innerJoin(customers, eq(customers.id, notifications.customerId))
      .where(eq(notifications.id, id));
    return found;
  }

  async recordDelivery(
    id: string,
    delivery: { status: NotificationDeliveryStatus; providerReference: string | null; deliveredAt: Date | null },
  ): Promise<void> {
    await this.db
      .update(notifications)
      .set({
        deliveryStatus: delivery.status,
        providerReference: delivery.providerReference,
        deliveredAt: delivery.deliveredAt,
      })
      .where(eq(notifications.id, id));
  }

  /** The centre, newest first, cursored by creation time. */
  async listFor(customerId: string, { before, limit }: { before?: Date; limit: number }): Promise<NotificationRow[]> {
    return this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customerId),
          eq(notifications.channel, 'IN_APP' satisfies NotificationChannel),
          before ? lt(notifications.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  async unreadCount(customerId: string): Promise<number> {
    const rows = await this.db
      .select({ id: notifications.id })
      .from(notifications)
      .where(
        and(
          eq(notifications.customerId, customerId),
          eq(notifications.channel, 'IN_APP' satisfies NotificationChannel),
          isNull(notifications.readAt),
        ),
      );
    return rows.length;
  }

  /** Scoped to the customer, so an id from elsewhere marks nothing. */
  async markRead(customerId: string, id: string, now: Date): Promise<boolean> {
    const updated = await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.id, id), eq(notifications.customerId, customerId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return updated.length > 0;
  }
}
