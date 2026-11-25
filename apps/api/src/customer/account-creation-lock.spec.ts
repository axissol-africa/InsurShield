import { PgDialect } from 'drizzle-orm/pg-core';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { AuditService } from '../common/audit/audit.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { IntegrationsService } from '../integrations/integrations.service.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { RefundsRepository } from '../payments/refunds.repository.js';
import { RefundsService } from '../payments/refunds.service.js';
import { PAYMENT_PROVIDER } from '../payments/provider/payment-provider.js';
import { ServiceRequestsRepository } from '../service-requests/service-requests.repository.js';
import { ServiceRequestsService } from '../service-requests/service-requests.service.js';
import { QuoteRequestsRepository } from './quote-requests.repository.js';
import { QuoteRequestsService } from './quote-requests.service.js';
import { QuoteRequestDraftsRepository } from './quote-request-drafts.repository.js';
import { QuoteRequestDraftsService } from './quote-request-drafts.service.js';
import { QuoteProductsRepository } from './quote-products.repository.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { UnderwritingInspectionsService } from './underwriting-inspections.service.js';
import { PoliciesService } from './policies.service.js';
import { SubmitQuoteRequestDto } from './dto/customer.dto.js';
import type { CustomerPrincipal } from './customer-principal.js';

const customer: CustomerPrincipal = { kind: 'customer', id: 'customer', email: 'customer@example.test', emailVerified: true };
const submission = () => Object.assign(new SubmitQuoteRequestDto(), {
  insuranceType: 'Comprehensive', coverageDurationId: '4q', selectedProductVersionIds: [], renewalOfPolicyNumber: 'policy',
});

describe('account-open creation protocol', () => {
  const query = { from: vi.fn(), where: vi.fn(), for: vi.fn() };
  const tx = { select: vi.fn(() => query) };
  const repository = {
    transaction: (work: (transaction: object) => Promise<unknown>) => work(tx),
    lockOwned: vi.fn(), lockOwnedPolicy: vi.fn(), create: vi.fn(), findOwnedActive: vi.fn(), deleteOwnedActive: vi.fn(),
    paymentCustomerId: vi.fn(), lockPaymentByTransaction: vi.fn(),
    expireAbandoned: vi.fn(), openRefund: vi.fn(), refundedMinor: vi.fn(), insertRefund: vi.fn(), moveRefund: vi.fn(),
  };
  const audit = { transition: vi.fn() };
  const approvals = { requestIn: vi.fn() };
  const policies = { assertRenewalAvailable: vi.fn() };
  let quote: QuoteRequestsService;
  let drafts: QuoteRequestDraftsService;
  let requests: ServiceRequestsService;
  let refunds: RefundsService;

  beforeEach(async () => {
    vi.clearAllMocks();
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.for.mockResolvedValue([]);
    repository.paymentCustomerId.mockResolvedValue(customer.id);
    const module = await Test.createTestingModule({ providers: [
      QuoteRequestsService, QuoteRequestDraftsService, ServiceRequestsService, RefundsService,
      ...[QuoteRequestsRepository, QuoteRequestDraftsRepository, ServiceRequestsRepository, RefundsRepository]
        .map((provide) => ({ provide, useValue: repository })),
      ...[DocumentsService, ConfigService, IntegrationsService, QuoteWorkflowService, QuoteProductsRepository,
        UnderwritingInspectionsService, NotificationsService, JobsRepository]
        .map((provide) => ({ provide, useValue: {} })),
      { provide: AuditService, useValue: audit },
      { provide: ApprovalService, useValue: approvals },
      { provide: PoliciesService, useValue: policies },
      { provide: PAYMENT_PROVIDER, useValue: {} },
      { provide: IdempotencyService, useValue: {
        execute: (_caller: unknown, _endpoint: unknown, _key: unknown, _dto: unknown, work: (transaction: object) => Promise<unknown>) => work(tx),
      } },
    ] }).compile();
    quote = module.get(QuoteRequestsService);
    drafts = module.get(QuoteRequestDraftsService);
    requests = module.get(ServiceRequestsService);
    refunds = module.get(RefundsService);
  });

  function invoke(command: string) {
    switch (command) {
      case 'quote': return quote.submit(customer, submission());
      case 'requote': return quote.requote(customer, 'request');
      case 'draft-create': return drafts.create(customer, { commonAnswers: {} });
      case 'draft-update': return drafts.update(customer, 'draft', { commonAnswers: {} });
      case 'draft-remove': return drafts.remove(customer, 'draft');
      case 'service-request': return requests.submit(customer, { policyNumber: 'policy', type: 'ASSISTANCE', reason: 'Help with my policy.' }, 'request-key');
      case 'refund': return refunds.propose({ kind: 'staff', id: 'staff', email: 'staff@example.test', role: 'ADMIN', insurerId: null }, 'payment', {
        amount: 10, reasonCode: 'CUSTOMER_REQUEST', reason: 'Requested refund.',
      });
      default: throw new Error('Unknown command');
    }
  }

  it.each(['quote', 'requote', 'draft-create', 'draft-update', 'draft-remove', 'service-request'])(
    '%s waits behind closure and refuses before locking or writing business records', async (command) => {
      let release: () => void = () => { throw new Error('The account lock has not been requested'); };
      const entered = new Promise<void>((enteredLock) => {
        query.for.mockImplementationOnce(() => new Promise<Array<{ id: string }>>((resolve) => {
          release = () => resolve([]);
          enteredLock();
        }));
      });
      const pending = invoke(command);
      const refused = expect(pending).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
      await entered;
      for (const method of [repository.lockOwned, repository.lockOwnedPolicy, repository.create,
        repository.findOwnedActive, repository.deleteOwnedActive, repository.lockPaymentByTransaction, policies.assertRenewalAvailable]) {
        expect(method).not.toHaveBeenCalled();
      }
      release(); // Closure committed while this creator was waiting.
      await refused;
      expect(query.for).toHaveBeenCalledWith('key share');
      expect(repository.lockPaymentByTransaction).not.toHaveBeenCalled();
    },
  );

  it('takes the account lock before the renewal policy lock', async () => {
    query.for.mockResolvedValueOnce([{ id: customer.id }]);
    policies.assertRenewalAvailable.mockRejectedValueOnce(new Error('renewal checked'));
    await expect(quote.submit(customer, submission())).rejects.toThrow('renewal checked');
    expect(policies.assertRenewalAvailable).toHaveBeenCalledWith(tx, customer.id, 'policy', expect.any(Date));
    expect(query.for.mock.invocationCallOrder[0]).toBeLessThan(policies.assertRenewalAvailable.mock.invocationCallOrder[0]);
  });

  it('waits for closure, then permits finance to propose a refund on the closed account', async () => {
    let release: () => void = () => { throw new Error('The account lock has not been requested'); };
    const entered = new Promise<void>((enteredLock) => {
      query.for.mockImplementationOnce(() => new Promise<Array<{ id: string; deletedAt: Date }>>((resolve) => {
        release = () => resolve([{ id: customer.id, deletedAt: new Date() }]);
        enteredLock();
      }));
    });
    repository.lockPaymentByTransaction.mockResolvedValueOnce({
      id: 'payment', status: 'CONFIRMED', providerPaymentId: 'provider-payment', provider: 'STAND_IN', amountMinor: 1000,
    });
    repository.openRefund.mockResolvedValueOnce(undefined);
    repository.refundedMinor.mockResolvedValueOnce(0);
    repository.insertRefund.mockResolvedValueOnce({ id: 'refund' });
    approvals.requestIn.mockResolvedValueOnce({ id: 'approval' });
    repository.moveRefund.mockResolvedValueOnce({
      id: 'refund', amountMinor: 1000, reasonCode: 'CUSTOMER_REQUEST', reason: 'Requested refund.',
      status: 'PROPOSED', approvalRequestId: 'approval', reconciliationItemId: null, failureReason: null,
      createdAt: new Date(), completedAt: null,
    });
    const pending = invoke('refund');
    await entered;
    expect(repository.lockPaymentByTransaction).not.toHaveBeenCalled();
    expect(repository.insertRefund).not.toHaveBeenCalled();
    release();
    await expect(pending).resolves.toMatchObject({ id: 'refund', status: 'PROPOSED', approvalRequestId: 'approval' });
    expect(query.for).toHaveBeenCalledWith('share');
    const predicate = new PgDialect().sqlToQuery(query.where.mock.calls[0][0]);
    expect(predicate.sql).not.toContain('deletedAt');
    expect(predicate.params).toEqual([customer.id]);
    expect(approvals.requestIn).toHaveBeenCalled();
    expect(audit.transition).toHaveBeenCalled();
  });

  it('discovers refund ownership, then locks the account before the payment', async () => {
    query.for.mockResolvedValueOnce([{ id: customer.id }]);
    repository.lockPaymentByTransaction.mockRejectedValueOnce(new Error('payment locked'));
    await expect(invoke('refund')).rejects.toThrow('payment locked');
    expect(repository.paymentCustomerId.mock.invocationCallOrder[0]).toBeLessThan(query.for.mock.invocationCallOrder[0]);
    expect(query.for.mock.invocationCallOrder[0]).toBeLessThan(repository.lockPaymentByTransaction.mock.invocationCallOrder[0]);
  });
});
