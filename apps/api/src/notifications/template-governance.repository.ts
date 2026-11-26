import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ne, or, sql } from 'drizzle-orm';
import {
  DATABASE,
  type Database,
  type Transaction,
} from '../db/database.module.js';
import { jobs, notifications, notificationTemplates } from '../db/schema.js';
import type { TemplatePageDto } from './dto/template-governance.dto.js';

@Injectable()
export class TemplateGovernanceRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}
  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }
  list(page: TemplatePageDto) {
    return this.db
      .select()
      .from(notificationTemplates)
      .orderBy(
        asc(notificationTemplates.key),
        asc(notificationTemplates.channel),
        desc(notificationTemplates.version),
      )
      .limit(page.limit)
      .offset(page.offset);
  }
  async find(tx: Transaction, id: string) {
    const [row] = await tx
      .select()
      .from(notificationTemplates)
      .where(eq(notificationTemplates.id, id));
    return row;
  }
  async lockSeries(tx: Transaction, key: string, channel: 'IN_APP' | 'EMAIL') {
    // Every mutation locks the immutable first version first, including creation of the next version.
    await tx
      .select({ id: notificationTemplates.id })
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.key, key),
          eq(notificationTemplates.channel, channel),
        ),
      )
      .orderBy(asc(notificationTemplates.version))
      .limit(1)
      .for('update');
    return tx
      .select()
      .from(notificationTemplates)
      .where(
        and(
          eq(notificationTemplates.key, key),
          eq(notificationTemplates.channel, channel),
        ),
      )
      .orderBy(asc(notificationTemplates.version));
  }
  async insert(
    tx: Transaction,
    row: typeof notificationTemplates.$inferInsert,
  ) {
    const [created] = await tx
      .insert(notificationTemplates)
      .values(row)
      .returning();
    return created;
  }
  async review(
    tx: Transaction,
    id: string,
    expectedStatus: string,
    changes: Partial<typeof notificationTemplates.$inferInsert>,
  ) {
    const [updated] = await tx
      .update(notificationTemplates)
      .set(changes)
      .where(
        and(
          eq(notificationTemplates.id, id),
          eq(notificationTemplates.reviewStatus, expectedStatus),
        ),
      )
      .returning();
    return updated;
  }
  exceptions(page: TemplatePageDto) {
    return this.db
      .select({
        id: notifications.id,
        event: notifications.templateKey,
        version: notifications.templateVersion,
        channel: notifications.channel,
        owner: notificationTemplates.owner,
        deliveryStatus: notifications.deliveryStatus,
        retryState: jobs.status,
        attempt: jobs.attempt,
        maxAttempts: jobs.maxAttempts,
        runAfter: jobs.runAfter,
        createdAt: notifications.createdAt,
        templateStatus: notificationTemplates.reviewStatus,
        expiresAt: notificationTemplates.expiresAt,
      })
      .from(notifications)
      .leftJoin(
        notificationTemplates,
        and(
          eq(notificationTemplates.key, notifications.templateKey),
          eq(notificationTemplates.channel, notifications.channel),
          eq(notificationTemplates.version, notifications.templateVersion),
        ),
      )
      .leftJoin(
        jobs,
        and(
          eq(jobs.kind, 'notification.email'),
          eq(jobs.key, sql<string>`${notifications.id}::text`),
        ),
      )
      .where(
        and(
          eq(notifications.channel, 'EMAIL'),
          ne(notifications.deliveryStatus, 'SENT'),
          or(
            eq(notifications.deliveryStatus, 'FAILED'),
            gt(jobs.attempt, 0),
            eq(jobs.status, 'FAILED'),
          ),
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(page.limit)
      .offset(page.offset);
  }
}
