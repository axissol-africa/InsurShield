import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, lte, notExists } from 'drizzle-orm';
import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE, type Database } from '../db/database.module.js';
import { insurers, payments, policies, reconciliationItems, staffUsers } from '../db/schema.js';
import { QUOTE_STAFF_EMAIL, customerDate } from '../customer/quote-workflow.service.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export const ISSUANCE_OVERDUE_CHECK = 'policies.issuance-overdue';
const HOUR_MS = 3_600_000;
const BATCH = 200;

/** One check per hour, keyed by the hour, so a restart cannot queue the same run twice. */
export function issuanceCheckKey(at: Date): string {
  return at.toISOString().slice(0, 13);
}

/**
 * A paid policy still not issued after its issuance deadline. The policy is
 * not failed here: operations confirm a failure with the insurer. What this
 * does is make the delay visible to everyone who has to act on it, once.
 */
@Injectable()
export class IssuanceJobs {
  private readonly logger = new Logger(IssuanceJobs.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jobs: JobsRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async schedule(at: Date): Promise<void> {
    await this.jobs.transaction((tx) =>
      this.jobs.enqueue(tx, { kind: ISSUANCE_OVERDUE_CHECK, key: issuanceCheckKey(at), payload: {}, runAfter: at }),
    );
  }

  async flagOverdue(now = new Date()): Promise<number> {
    await this.schedule(new Date(now.getTime() + HOUR_MS));
    const due = await this.db
      .select({
        policyNumber: policies.policyNumber,
        paymentId: policies.paymentId,
        customerId: policies.customerId,
        insurerId: policies.insurerId,
        insurerName: insurers.name,
        issuanceDueAt: policies.issuanceDueAt,
        amountMinor: payments.amountMinor,
      })
      .from(policies)
      .innerJoin(insurers, eq(insurers.id, policies.insurerId))
      .innerJoin(payments, eq(payments.id, policies.paymentId))
      .where(
        and(
          eq(policies.status, 'AWAITING_INSURER_CERTIFICATE'),
          lte(policies.issuanceDueAt, now),
          notExists(
            this.db
              .select({ id: reconciliationItems.id })
              .from(reconciliationItems)
              .where(and(eq(reconciliationItems.kind, 'ISSUANCE_OVERDUE'), eq(reconciliationItems.paymentId, policies.paymentId))),
          ),
        ),
      )
      .orderBy(asc(policies.issuanceDueAt))
      .limit(BATCH);

    let flagged = 0;
    for (const policy of due) {
      const opened = await this.db.transaction(async (tx) => {
        const [item] = await tx
          .insert(reconciliationItems)
          .values({
            kind: 'ISSUANCE_OVERDUE',
            paymentId: policy.paymentId,
            policyNumber: policy.policyNumber,
            insurerId: policy.insurerId,
            amountMinor: policy.amountMinor,
            reason: `${policy.insurerName} has not issued the policy, due by ${policy.issuanceDueAt!.toISOString()}.`,
          })
          .onConflictDoNothing()
          .returning({ id: reconciliationItems.id });
        if (!item) return false;
        await this.audit.transition(tx, {
          actor: { type: 'SYSTEM', id: null },
          entityType: 'RECONCILIATION_ITEM',
          entityId: item.id,
          fromStatus: null,
          toStatus: 'OPEN',
          note: 'ISSUANCE_OVERDUE: the insurer has not issued the paid policy in time.',
          correlationId: policy.policyNumber,
        });
        await this.notifications.notify(tx, {
          customerId: policy.customerId,
          key: 'policy.issuance_delayed',
          entity: { type: 'POLICY', id: policy.policyNumber },
          values: { insurer: policy.insurerName, policyNumber: policy.policyNumber },
        });
        const admins = await tx
          .select({ id: staffUsers.id, email: staffUsers.email })
          .from(staffUsers)
          .where(and(eq(staffUsers.insurerId, policy.insurerId), eq(staffUsers.isActive, true), eq(staffUsers.role, 'INSURER_ADMIN')))
          .orderBy(asc(staffUsers.email));
        for (const admin of admins) {
          await this.jobs.enqueue(tx, {
            kind: QUOTE_STAFF_EMAIL,
            key: `issuance-overdue:${policy.policyNumber}:${admin.id}`,
            payload: {
              to: admin.email,
              subject: `Policy ${policy.policyNumber} is overdue for issuing`,
              body:
                `The customer paid for policy ${policy.policyNumber} and it was due to be issued by ` +
                `${customerDate(policy.issuanceDueAt!)}. Open the InsurShield insurer portal to upload the certificate, ` +
                'or report that it cannot be issued so the customer can be refunded.',
            },
          });
        }
        return true;
      });
      if (opened) flagged += 1;
    }
    if (flagged > 0) this.logger.log(`Flagged ${flagged} policies overdue for issuing`);
    if (due.length === BATCH) await this.schedule(now);
    return flagged;
  }
}
