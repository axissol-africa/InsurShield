import { Injectable } from '@nestjs/common';
import type { Transaction } from '../db/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { QuoteRequestsRepository } from './quote-requests.repository.js';

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
  ) {}

  async cancelForSuspendedInsurer(
    tx: Transaction,
    input: { insurerId: string; insurerName: string; suspendedAt: Date },
  ): Promise<{ cancelledDeliveries: number; unpayableQuotes: number }> {
    const cancelled = await this.quotes.cancelUnansweredForSuspension(tx, input.insurerId, input.suspendedAt);
    const customers = await this.quotes.customersForRequests(
      tx,
      cancelled.map((row) => row.quoteRequestId),
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
    return { cancelledDeliveries: cancelled.length, unpayableQuotes: unpayable.length };
  }
}
