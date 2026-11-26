import { ACCOUNT_CLOSED } from '../common/auth/messages.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { Injectable, Logger } from '@nestjs/common';
import { AuthService } from '../auth/auth.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { AccountRepository } from './account.repository.js';
import type { CustomerPrincipal } from './customer-principal.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly repository: AccountRepository,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly quotes: QuoteWorkflowService,
  ) {}

  async close(customer: CustomerPrincipal): Promise<{ closed: true; closedAt: string }> {
    const customerId = customer.id;
    const closedAt = new Date();
    await this.repository.transaction(async (tx) => {
      const lockedCustomer = await this.repository.lockCustomer(tx, customerId);
      if (!lockedCustomer || lockedCustomer.deletedAt) throw ApiException.forbidden(ACCOUNT_CLOSED);
      const inForce = (await this.repository.policiesInForce(tx, customerId, closedAt)).length;
      if (inForce > 0) {
        throw ApiException.conflict(
          'ACTIVE_POLICY_EXISTS',
          `This account holds ${inForce} ${inForce === 1 ? 'policy' : 'policies'} in force. Cover must end before the account can be closed.`,
        );
      }
      if (await this.repository.hasOpenServiceRequest(tx, customerId)) {
        throw ApiException.conflict(
          'OPEN_SERVICE_REQUEST_EXISTS',
          'Finish or withdraw your open service requests before closing this account.',
        );
      }
      if (await this.repository.hasOutstandingClaimEvidence(tx, customerId)) {
        throw ApiException.conflict('CLAIM_EVIDENCE_OUTSTANDING', 'Send the requested evidence for your claim before closing this account.');
      }
      if (await this.repository.hasOutstandingNcdEvidence(tx, customerId)) {
        throw ApiException.conflict('NCD_EVIDENCE_OUTSTANDING', 'Send the requested evidence for your No Claim Discount application before closing this account.');
      }
      if (await this.repository.hasOpenLaterInspection(tx, customerId)) {
        throw ApiException.conflict('INSPECTION_IN_PROGRESS', 'Complete the open policy or claim inspection before closing this account.');
      }
      if (await this.repository.hasOpenPayment(tx, customerId)) {
        throw ApiException.conflict('PAYMENT_IN_PROGRESS', 'Wait for your payment to finish before closing this account.');
      }
      if (await this.repository.hasOpenRefund(tx, customerId)) {
        throw ApiException.conflict('REFUND_IN_PROGRESS', 'Wait for your refund to finish before closing this account.');
      }
      const withdrawn = await this.quotes.closeAccount(tx, customerId, auditActor(customer), closedAt);
      await this.repository.close(tx, customerId, closedAt);
      if (lockedCustomer?.userId) await this.auth.revokeSessions(tx, lockedCustomer.userId);
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'customer.account_closed',
        entityType: 'CUSTOMER',
        entityId: customerId,
        after: { closed: true, ...withdrawn },
        note: 'Customer closed their account after closure checks passed.',
        correlationId: customerId,
      });
    });

    this.logger.log(`Customer ${customerId} closed their account`);
    return { closed: true, closedAt: closedAt.toISOString() };
  }
}
