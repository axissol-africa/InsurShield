import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { AuthService } from '../auth/auth.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { AccountRepository } from './account.repository.js';
import { AccountService } from './account.service.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import type { CustomerPrincipal } from './customer-principal.js';

const customer: CustomerPrincipal = {
  kind: 'customer',
  id: 'customer',
  email: 'customer@example.test',
  emailVerified: true,
};

describe('account closure', () => {
  const tx = {};
  const repository = {
    transaction: (work: (transaction: object) => Promise<unknown>) => work(tx),
    lockCustomer: vi.fn(),
    policiesInForce: vi.fn(),
    hasOpenServiceRequest: vi.fn(),
    hasOutstandingClaimEvidence: vi.fn(),
    hasOutstandingNcdEvidence: vi.fn(),
    hasOpenPayment: vi.fn(),
    hasOpenRefund: vi.fn(),
    close: vi.fn(),
  };
  const auth = { revokeSessions: vi.fn() };
  const audit = { write: vi.fn() };
  const quotes = { closeAccount: vi.fn() };
  let service: AccountService;

  beforeEach(async () => {
    vi.resetAllMocks();
    repository.lockCustomer.mockResolvedValue({
      userId: 'user',
      deletedAt: null,
    });
    repository.policiesInForce.mockResolvedValue([]);
    for (const check of [repository.hasOpenServiceRequest, repository.hasOutstandingClaimEvidence, repository.hasOutstandingNcdEvidence, repository.hasOpenPayment, repository.hasOpenRefund])
      check.mockResolvedValue(false);
    quotes.closeAccount.mockResolvedValue({
      withdrawnRequests: 2,
      cancelledProducts: 3,
      expiredDrafts: 1,
    });
    const module = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: AccountRepository, useValue: repository },
        { provide: AuthService, useValue: auth },
        { provide: AuditService, useValue: audit },
        { provide: QuoteWorkflowService, useValue: quotes },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it.each([
    ['policiesInForce', ['policy'], 'ACTIVE_POLICY_EXISTS'],
    ['hasOpenServiceRequest', true, 'OPEN_SERVICE_REQUEST_EXISTS'],
    ['hasOutstandingClaimEvidence', true, 'CLAIM_EVIDENCE_OUTSTANDING'],
    ['hasOutstandingNcdEvidence', true, 'NCD_EVIDENCE_OUTSTANDING'],
    ['hasOpenPayment', true, 'PAYMENT_IN_PROGRESS'],
    ['hasOpenRefund', true, 'REFUND_IN_PROGRESS'],
  ] as const)('refuses %s before any writes', async (check, value, code) => {
    repository[check].mockResolvedValue(value);
    await expect(service.close(customer)).rejects.toMatchObject({
      code,
      status: 409,
    });
    expect(repository.close).not.toHaveBeenCalled();
    expect(quotes.closeAccount).not.toHaveBeenCalled();
    expect(auth.revokeSessions).not.toHaveBeenCalled();
    expect(audit.write).not.toHaveBeenCalled();
  });

  it.each([undefined, { userId: 'user', deletedAt: new Date() }])('refuses stale principals', async (locked) => {
    repository.lockCustomer.mockResolvedValue(locked);
    await expect(service.close(customer)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(repository.close).not.toHaveBeenCalled();
  });

  it('withdraws quotes, closes, revokes sessions and audits counts in the same transaction', async () => {
    const result = await service.close(customer);
    const at = new Date(result.closedAt);
    expect(repository.policiesInForce).toHaveBeenCalledWith(tx, customer.id, at);
    expect(quotes.closeAccount).toHaveBeenCalledWith(tx, customer.id, expect.any(Object), at);
    expect(repository.close).toHaveBeenCalledWith(tx, customer.id, at);
    expect(auth.revokeSessions).toHaveBeenCalledWith(tx, 'user');
    expect(audit.write).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: 'customer.account_closed',
        after: {
          closed: true,
          withdrawnRequests: 2,
          cancelledProducts: 3,
          expiredDrafts: 1,
        },
      }),
    );
    expect(result.closed).toBe(true);
  });

  it('propagates revocation failure to the transaction instead of reporting success', async () => {
    auth.revokeSessions.mockRejectedValue(new Error('session deletion failed'));
    await expect(service.close(customer)).rejects.toThrow('session deletion failed');
    expect(audit.write).not.toHaveBeenCalled();
  });
});
