import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { AccountRepository } from './account.repository.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly repository: AccountRepository,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly workflow: QuoteWorkflowService,
  ) {}

  /**
   * Closes the account.
   *
   * Refused while cover is in force: a customer with a policy, active or paid
   * and awaiting its certificate, still has a live insurance contract, and the
   * records behind it must stay reachable. Refused too while a service
   * request, a payment or a refund is in progress, since each needs the
   * customer to hear how it ends. Otherwise open quote requests end, their
   * chosen products are cancelled for the insurers, drafts are deleted, the
   * row is soft-deleted and its sessions end with the closing transaction.
   * Quotes, claims and payments remain for audit and regulatory retention;
   * the identity itself is replaced after ACCOUNT_RETENTION.
   */
  async close(customer: CustomerPrincipal): Promise<{ closed: true; closedAt: string }> {
    const customerId = customer.id;
    const closedAt = new Date();
    await this.repository.transaction(async (tx) => {
      const lockedCustomer = await this.repository.lockCustomer(tx, customerId);
      const inForce = (await this.repository.policiesInForce(tx, customerId)).length;
      if (inForce > 0) {
        throw ApiException.conflict(
          'ACTIVE_POLICY_EXISTS',
          `This account holds ${inForce} ${inForce === 1 ? 'policy' : 'policies'} in force. Cover must end before the account can be closed.`,
        );
      }
      const pending = await this.repository.inProgress(tx, customerId);
      const blocking = [
        pending.serviceRequests.length > 0 && ['SERVICE_REQUEST_OPEN', `Your request ${pending.serviceRequests.join(', ')} is still open with the insurer. Withdraw it or wait for it to finish, then close the account.`],
        pending.payments.length > 0 && ['PAYMENT_IN_PROGRESS', `A payment (${pending.payments.join(', ')}) is still being processed. Wait for it to finish, then close the account.`],
        pending.refunds.length > 0 && ['REFUND_IN_PROGRESS', `A refund on ${pending.refunds.join(', ')} is still on its way to you. Wait for it to arrive, then close the account.`],
      ].find(Boolean) as [string, string] | undefined;
      if (blocking) throw ApiException.conflict(blocking[0], blocking[1]);

      const actor = auditActor(customer);
      const cancelledProducts = await this.workflow.cancelForClosedAccount(tx, customerId, actor, closedAt);
      const endedRequests = await this.repository.endOpenRequests(tx, customerId, closedAt);
      for (const { id, status } of endedRequests) {
        await this.audit.transition(tx, { actor, entityType: 'QUOTE_REQUEST', entityId: id, fromStatus: status, toStatus: 'EXPIRED', note: 'The customer closed their account.', correlationId: customerId });
      }
      const deletedDrafts = await this.repository.deleteDrafts(tx, customerId);
      await this.repository.close(tx, customerId, closedAt);
      if (lockedCustomer?.userId) await this.auth.revokeSessions(tx, lockedCustomer.userId);
      await this.audit.write(tx, {
        actor,
        action: 'customer.account_closed',
        entityType: 'CUSTOMER',
        entityId: customerId,
        after: { closed: true, endedRequests: endedRequests.length, cancelledProducts, deletedDrafts },
        note: 'Customer closed their account after no policies remained in force.',
        correlationId: customerId,
      });
    });

    this.logger.log(`Customer ${customerId} closed their account`);
    return { closed: true, closedAt: closedAt.toISOString() };
  }
}
