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
  ) {}

  /**
   * Closes the account.
   *
   * Refused while cover is in force: a customer with a policy, active or paid
   * and awaiting its certificate, still has a live insurance contract, and the
   * records behind it must stay reachable. Otherwise the row is soft-deleted,
   * its sessions end with the closing transaction, and quotes, claims and
   * payments remain for audit and regulatory retention rather than being
   * destroyed.
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
      await this.repository.close(tx, customerId, closedAt);
      if (lockedCustomer?.userId) await this.auth.revokeSessions(tx, lockedCustomer.userId);
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'customer.account_closed',
        entityType: 'CUSTOMER',
        entityId: customerId,
        after: { closed: true },
        note: 'Customer closed their account after no policies remained in force.',
        correlationId: customerId,
      });
    });

    this.logger.log(`Customer ${customerId} closed their account`);
    return { closed: true, closedAt: closedAt.toISOString() };
  }
}
