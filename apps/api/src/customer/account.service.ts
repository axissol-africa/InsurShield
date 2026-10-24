import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { AccountRepository } from './account.repository.js';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(private readonly repository: AccountRepository) {}

  /**
   * Closes the account.
   *
   * Refused while cover is in force: a customer with a policy, active or paid
   * and awaiting its certificate, still has a live insurance contract, and the
   * records behind it must stay reachable. Otherwise the row is soft-deleted,
   * so the guard refuses the token from then on, and quotes, claims and
   * payments remain for audit and regulatory retention rather than being
   * destroyed.
   */
  async close(customerId: string): Promise<{ closed: true; closedAt: string }> {
    const closedAt = new Date();
    // The unlocked read of policies sees a payment committed while the lock was awaited only at READ COMMITTED.
    await this.repository.transaction(
      async (tx) => {
        await this.repository.lockCustomer(tx, customerId);
        const inForce = (await this.repository.policiesInForce(tx, customerId)).length;
        if (inForce > 0) {
          throw ApiException.conflict(
            'ACTIVE_POLICY_EXISTS',
            `This account holds ${inForce} ${inForce === 1 ? 'policy' : 'policies'} in force. Cover must end before the account can be closed.`,
          );
        }
        await this.repository.close(tx, customerId, closedAt);
      },
      { isolationLevel: 'read committed' },
    );

    this.logger.log(`Customer ${customerId} closed their account`);
    return { closed: true, closedAt: closedAt.toISOString() };
  }
}
