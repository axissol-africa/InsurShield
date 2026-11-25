import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE, type Transaction } from '../db/database.module.js';
import { AccountRepository } from './account.repository.js';
import { QuoteProductsRepository } from './quote-products.repository.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { MAIL_SENDER } from '../mail/mail.port.js';

describe('account quote withdrawal', () => {
  it('cancels open products through the workflow, closes unanswered questions and leaves terminal products alone', async () => {
    const at = new Date('2026-11-25T12:00:00Z');
    const versions = {
      lockUnpaidAccountRequests: vi.fn().mockResolvedValue(['request']),
      lockAccountVersions: vi.fn().mockResolvedValue([
        {
          id: 'question',
          quoteRequestId: 'request',
          productVersionId: 'product',
          status: 'VERIFICATION_REQUIRED',
        },
        {
          id: 'quoted',
          quoteRequestId: 'request',
          productVersionId: 'other',
          status: 'QUOTED',
        },
        { id: 'declined', status: 'DECLINED' },
        { id: 'cancelled', status: 'CANCELLED' },
      ]),
      move: vi.fn().mockResolvedValue(true),
      closeOpenInformationRequest: vi.fn(),
      withdrawAccountRequest: vi.fn(),
      expireAccountDrafts: vi.fn().mockResolvedValue(2),
    };
    const audit = { transition: vi.fn() };
    const tx = {};
    const module = await Test.createTestingModule({
      providers: [
        QuoteWorkflowService,
        AccountRepository,
        {
          provide: DATABASE,
          useValue: {
            transaction: (work: (transaction: object) => Promise<unknown>) => work(tx),
          },
        },
        { provide: QuoteProductsRepository, useValue: versions },
        { provide: AuditService, useValue: audit },
        { provide: NotificationsService, useValue: {} },
        { provide: SettingsService, useValue: {} },
        { provide: JobsRepository, useValue: {} },
        { provide: MAIL_SENDER, useValue: {} },
      ],
    }).compile();
    const result = await module
      .get(AccountRepository)
      .transaction((transaction: Transaction) =>
        module.get(QuoteWorkflowService).closeAccount(transaction, 'customer', { type: 'CUSTOMER', id: 'customer' }, at),
      );
    expect(result).toEqual({
      withdrawnRequests: 1,
      cancelledProducts: 2,
      expiredDrafts: 2,
    });
    expect(versions.move).toHaveBeenCalledTimes(2);
    expect(versions.closeOpenInformationRequest).toHaveBeenCalledWith(tx, 'request', 'product', at);
    expect(audit.transition).toHaveBeenCalledTimes(2);
    expect(versions.withdrawAccountRequest).toHaveBeenCalledWith(tx, 'request', at);
    expect(versions.expireAccountDrafts).toHaveBeenCalledWith(tx, 'customer', at);
  });
});
