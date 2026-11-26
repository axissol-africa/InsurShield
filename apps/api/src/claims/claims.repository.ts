import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, exists, isNull, or, sql } from 'drizzle-orm';
import type { Principal } from '../common/auth/auth.types.js';
import {
  DATABASE,
  type Database,
  type Transaction,
} from '../db/database.module.js';
import {
  claimAttachments,
  claimNotifications,
  claimUpdates,
  insurers,
  policies,
} from '../db/schema.js';
import { servicesExistingBusinessWhere } from '../common/insurer-standing.js';

export type LifecycleClaim = typeof claimNotifications.$inferSelect;

@Injectable()
export class ClaimsRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  async find(
    tx: Transaction,
    principal: Principal,
    claimNumber: string,
    lock = false,
  ) {
    const query = tx
      .select()
      .from(claimNotifications)
      .where(
        and(
          eq(claimNotifications.claimNumber, claimNumber),
          principal.kind === 'customer'
            ? eq(claimNotifications.customerId, principal.id)
            : eq(claimNotifications.insurerId, principal.insurerId ?? ''),
          or(
            isNull(claimNotifications.policyNumber),
            exists(
              tx
                .select({ one: sql`1` })
                .from(policies)
                .where(
                  and(
                    eq(policies.policyNumber, claimNotifications.policyNumber),
                    eq(policies.insurerId, claimNotifications.insurerId),
                    principal.kind === 'customer'
                      ? eq(policies.customerId, claimNotifications.customerId)
                      : or(
                          isNull(claimNotifications.customerId),
                          eq(
                            policies.customerId,
                            claimNotifications.customerId,
                          ),
                        ),
                  ),
                ),
            ),
          ),
        ),
      );
    const [claim] = await query.for(lock ? 'update' : 'share');
    return claim;
  }

  async lockServicingInsurer(tx: Transaction, insurerId: string) {
    const [insurer] = await tx
      .select({ id: insurers.id })
      .from(insurers)
      .where(
        and(eq(insurers.id, insurerId), ...servicesExistingBusinessWhere()),
      )
      .for('share');
    return insurer;
  }

  updates(tx: Transaction, claimNumber: string) {
    return tx
      .select()
      .from(claimUpdates)
      .where(eq(claimUpdates.claimNumber, claimNumber))
      .orderBy(asc(claimUpdates.createdAt), asc(claimUpdates.id));
  }

  attachments(tx: Transaction, claimNumber: string) {
    return tx
      .select()
      .from(claimAttachments)
      .where(eq(claimAttachments.claimNumber, claimNumber))
      .orderBy(asc(claimAttachments.id));
  }

  async append(
    tx: Transaction,
    event: typeof claimUpdates.$inferInsert,
    documentIds: string[],
  ) {
    const [update] = await tx
      .insert(claimUpdates)
      .values({ ...event, createdAt: sql`clock_timestamp()` })
      .returning();
    if (documentIds.length)
      await tx.insert(claimAttachments).values(
        documentIds.map((documentId) => ({
          claimNumber: event.claimNumber,
          claimUpdateId: update.id,
          documentId,
        })),
      );
    return update;
  }

  async changeStatus(
    tx: Transaction,
    claim: LifecycleClaim,
    status: LifecycleClaim['status'],
  ) {
    const [updated] = await tx
      .update(claimNotifications)
      .set({ status })
      .where(
        and(
          eq(claimNotifications.claimNumber, claim.claimNumber),
          eq(claimNotifications.status, claim.status),
        ),
      )
      .returning();
    return updated;
  }
}
