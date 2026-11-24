import { Injectable } from '@nestjs/common';
import type { Transaction } from '../db/database.module.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { PAYMENT_PROVIDER_CANCEL } from '../payments/payment-jobs.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { QuoteRequestsRepository } from './quote-requests.repository.js';
import { QuoteWorkflowService } from './quote-workflow.service.js';
import { UnderwritingInspectionsService } from './underwriting-inspections.service.js';

/**
 * Owns a quote's availability after it has been distributed. Insurers own
 * their suspension decision; customer quote data owns the cancellation marks
 * and the customer notice that follows that decision.
 */
@Injectable()
export class QuoteAvailabilityService {
  constructor(
    private readonly quotes: QuoteRequestsRepository,
    private readonly notifications: NotificationsService,
    private readonly workflow: QuoteWorkflowService,
    private readonly underwriting: UnderwritingInspectionsService,
    private readonly jobs: JobsRepository,
  ) {}

  async cancelForSuspendedInsurer(
    tx: Transaction,
    input: { insurerId: string; insurerName: string; suspendedAt: Date },
  ): Promise<{ cancelledDeliveries: number; unpayableQuotes: number; cancelledPayments: number }> {
    const cancelled = await this.quotes.cancelUnansweredForSuspension(tx, input.insurerId, input.suspendedAt);
    const cancelledSelections = await this.workflow.cancelForSuspendedInsurer(tx, input.insurerId, input.suspendedAt);
    await this.underwriting.cancelForSuspendedInsurer(tx, input.insurerId, input.suspendedAt);
    const customers = await this.quotes.customersForRequests(
      tx,
      [...new Set([...cancelled.map((row) => row.quoteRequestId), ...cancelledSelections])],
    );
    for (const customer of customers) {
      await this.notifications.notify(tx, {
        customerId: customer.customerId,
        key: 'quote.cancelled',
        entity: { type: 'QUOTE_REQUEST', id: customer.quoteRequestId },
        values: { insurer: input.insurerName, quoteRequestId: customer.quoteRequestId },
      });
    }
    const unpayable = await this.quotes.markUnpaidQuotesUnavailable(tx, input.insurerId, input.suspendedAt);
    // Attempts already with the provider are stopped there where possible, after this commits.
    // Any confirmation that still arrives finds the quote unpayable and is refunded, never issued.
    const open = await this.quotes.openPaymentsForInsurer(tx, input.insurerId);
    for (const payment of open) {
      await this.jobs.enqueue(tx, { kind: PAYMENT_PROVIDER_CANCEL, key: payment.id, payload: {}, runAfter: input.suspendedAt });
    }
    return { cancelledDeliveries: cancelled.length, unpayableQuotes: unpayable.length, cancelledPayments: open.length };
  }
}
