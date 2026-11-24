import { Inject, Injectable, Logger } from '@nestjs/common';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { isOpenPayment } from './domain/payment.js';
import { PaymentEventsService } from './payment-events.service.js';
import { PaymentsRepository } from './payments.repository.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.js';

export const PAYMENT_STATUS_CHECK = 'payments.status-check';
/** Queued by decision 24 for each attempt still open on a suspended insurer's quotes. */
export const PAYMENT_PROVIDER_CANCEL = 'payments.provider-cancel';

const INTERVAL_MS = 60_000;
/** A callback normally arrives within this; asking sooner only doubles the provider's work. */
const GRACE_MS = 30_000;
const BATCH = 200;

/** One check per minute, keyed by the minute, so a restart cannot queue the same run twice. */
export function statusCheckKey(at: Date): string {
  return at.toISOString().slice(0, 16);
}

/**
 * The provider is asked about every attempt still open after its grace
 * period, so a lost callback or a crash between our insert and the provider's
 * answer is recovered. At an attempt's pending deadline the last check
 * decides it.
 */
@Injectable()
export class PaymentJobs {
  private readonly logger = new Logger(PaymentJobs.name);

  constructor(
    private readonly jobs: JobsRepository,
    private readonly payments: PaymentsRepository,
    private readonly events: PaymentEventsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async schedule(at: Date): Promise<void> {
    await this.jobs.transaction((tx) =>
      this.jobs.enqueue(tx, { kind: PAYMENT_STATUS_CHECK, key: statusCheckKey(at), payload: {}, runAfter: at }),
    );
  }

  async checkOpen(now = new Date()): Promise<number> {
    await this.schedule(new Date(now.getTime() + INTERVAL_MS));
    const due = await this.payments.dueForStatusCheck(new Date(now.getTime() - GRACE_MS), new Date(now.getTime() - GRACE_MS), BATCH);
    for (const { id } of due) {
      try {
        await this.events.refresh(id, now);
      } catch (error) {
        // One payment's trouble must not hold up the rest; it is tried again next minute.
        this.logger.error(`Status check failed for payment ${id}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
    if (due.length === BATCH) await this.schedule(now);
    return due.length;
  }

  /** Decision 24: stops an attempt at the provider where it can. A confirmation that still comes is refunded. */
  async cancelAtProvider(paymentId: string): Promise<void> {
    const payment = await this.payments.viewById(paymentId);
    if (!payment || !isOpenPayment(payment.status)) return;
    const answer = await this.provider.cancel({ providerPaymentId: payment.providerPaymentId, paymentId });
    await this.events.applyStatus(paymentId, answer.status === 'NOT_FOUND' ? { ...answer, status: 'CANCELLED' } : answer);
  }
}
