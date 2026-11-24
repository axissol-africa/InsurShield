import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuditActor } from '../common/audit/audit.types.js';
import { toContract } from '../common/contract.js';
import type { PaymentStatus, ReconciliationKind } from '../common/domain/enums.js';
import { newReference } from '../common/domain/reference.js';
import { ApiException } from '../common/errors/api.exception.js';
import { takesNewBusiness } from '../common/insurer-standing.js';
import type { Transaction } from '../db/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { eventFit, isOpenPayment, isQuoteExpired } from './domain/payment.js';
import { PaymentsRepository, type PaymentRow } from './payments.repository.js';
import { PAYMENT_PROVIDER, type PaymentEvent, type PaymentProvider, type StatusResult } from './provider/payment-provider.js';

/** The provider answers for itself; nothing a customer or a browser says confirms money. */
const PROVIDER: AuditActor = { type: 'SYSTEM', id: null };
const HOUR_MS = 60 * 60_000;

/** What applying an event did, kept with the callback so a replay answers the same. */
export type EventOutcome =
  | 'POLICY_CREATED'
  | 'REFUND_REQUIRED'
  | 'AMOUNT_MISMATCH'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED'
  | 'ALREADY_APPLIED'
  | 'STATE_CONFLICT'
  | 'UNMATCHED';

export interface CallbackReceipt {
  eventId: string;
  outcome: string;
  replayed: boolean;
}

/**
 * Applies what the payment provider says: a verified callback, or the answer
 * to a status check, through one code path. A confirmed payment becomes a
 * policy waiting for the insurer's certificate, never an active one
 * (DEC-019). Money that was taken but cannot become a policy is never left
 * unaccounted for: it opens a reconciliation item for a person to refund.
 */
@Injectable()
export class PaymentEventsService {
  private readonly logger = new Logger(PaymentEventsService.name);

  constructor(
    private readonly payments: PaymentsRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * A provider callback. The signature is checked on the raw body before
   * anything in it is read, and each event id is applied once: a replay
   * answers what the first delivery did, and the same id with other content
   * is refused.
   */
  async receiveCallback(route: string, rawBody: Buffer | undefined, headers: Readonly<Record<string, string | undefined>>): Promise<CallbackReceipt> {
    if (route !== this.provider.route) throw ApiException.notFound('Payment provider', route);
    if (!rawBody || rawBody.length === 0) {
      throw new ApiException('INVALID_CALLBACK', 'This payment callback is not in the expected format.', 400);
    }
    const event = this.provider.verifyCallback(rawBody, headers);
    const envelopeHash = createHash('sha256').update(rawBody).digest('hex');
    const at = new Date();

    return this.payments.transaction(async (tx) => {
      // The unique (provider, event id) makes a concurrent duplicate wait here for the first, then replay it.
      const recorded = await this.payments.insertCallback(tx, {
        provider: this.provider.name,
        eventId: event.eventId,
        eventType: event.type,
        envelopeHash,
      });
      if (!recorded) {
        const stored = await this.payments.findCallback(tx, this.provider.name, event.eventId);
        if (!stored || stored.envelopeHash !== envelopeHash) {
          throw ApiException.conflict('CALLBACK_EVENT_REUSED', 'This event id was already used for a different payment event.');
        }
        return { eventId: event.eventId, outcome: stored.outcome ?? 'ALREADY_APPLIED', replayed: true };
      }
      const payment = await this.findPayment(tx, event);
      const outcome = payment
        ? await this.apply(tx, payment, event, at, recorded.id)
        : await this.unmatched(tx, event, recorded.id);
      await this.payments.finishCallback(tx, recorded.id, { paymentId: payment?.id ?? null, outcome, at });
      return { eventId: event.eventId, outcome, replayed: false };
    });
  }

  private async findPayment(tx: Transaction, event: PaymentEvent): Promise<PaymentRow | undefined> {
    const byProviderId = await this.payments.lockByProviderId(tx, this.provider.name, event.providerPaymentId);
    if (byProviderId) return byProviderId;
    // The event can beat our own record of the provider's id; the provider echoes our payment id as well.
    if (!event.paymentId) return undefined;
    const byOurId = await this.payments.lockPayment(tx, event.paymentId);
    if (!byOurId || byOurId.provider !== this.provider.name) return undefined;
    if (byOurId.providerPaymentId && byOurId.providerPaymentId !== event.providerPaymentId) return undefined;
    return byOurId;
  }

  private async unmatched(tx: Transaction, event: PaymentEvent, callbackId: string): Promise<EventOutcome> {
    await this.openItem(tx, {
      kind: 'UNMATCHED_PROVIDER_EVENT',
      paymentCallbackId: callbackId,
      amountMinor: event.amountMinor,
      reason: `The provider sent ${event.type} for ${event.providerPaymentId}, which matches no payment here.`,
    });
    this.logger.warn(`Unmatched ${event.type} event ${event.eventId} from ${this.provider.name}`);
    return 'UNMATCHED';
  }

  /** Applies one event to a locked payment. */
  async apply(tx: Transaction, payment: PaymentRow, event: PaymentEvent, at: Date, callbackId: string | null): Promise<EventOutcome> {
    const fit = eventFit(event.type, payment.status);
    if (fit === 'already-applied') return 'ALREADY_APPLIED';
    if (fit !== 'apply') {
      // Refund events have no refund record to land on until refunds exist; either way a person looks at it.
      await this.openItem(tx, {
        kind: fit === 'unhandled' ? 'UNMATCHED_PROVIDER_EVENT' : 'STATE_CONFLICT',
        paymentId: payment.id,
        paymentCallbackId: callbackId,
        amountMinor: event.amountMinor,
        insurerId: await this.insurerOf(tx, payment),
        reason: `The provider sent ${event.type} for a payment that is ${payment.status.toLowerCase()}. Nothing was changed.`,
      });
      return fit === 'unhandled' ? 'UNMATCHED' : 'STATE_CONFLICT';
    }
    const providerPaymentId = payment.providerPaymentId ?? event.providerPaymentId;
    switch (event.type) {
      case 'payment.confirmed':
        return this.confirmed(tx, { ...payment, providerPaymentId }, event, at, callbackId);
      case 'payment.failed':
        await this.move(tx, payment, 'FAILED', { failureCode: 'DECLINED', failureReason: event.reason, providerPaymentId }, 'The provider declined the payment.');
        await this.tellCustomer(tx, payment, 'payment.failed');
        return 'FAILED';
      case 'payment.cancelled':
        await this.move(tx, payment, 'CANCELLED', { failureCode: 'CANCELLED', failureReason: event.reason, providerPaymentId }, 'The payment was cancelled at the provider.');
        return 'CANCELLED';
      case 'payment.reversed':
        await this.move(tx, payment, 'REVERSED', { reversedAt: at, reversalReference: event.reference }, 'The provider reversed the payment.');
        // A policy is not changed automatically: operations decide with the insurer.
        await this.openItem(tx, {
          kind: 'REVERSAL',
          paymentId: payment.id,
          paymentCallbackId: callbackId,
          policyNumber: (await this.payments.policyForPayment(tx, payment.id)) ?? null,
          insurerId: await this.insurerOf(tx, payment),
          amountMinor: event.amountMinor ?? payment.amountMinor,
          reason: 'The provider reversed a confirmed payment, for example after a chargeback.',
        });
        return 'REVERSED';
      default:
        return 'UNMATCHED';
    }
  }

  /**
   * Money was taken. It becomes a policy waiting for the insurer, unless the
   * amount is wrong or the quote can no longer be sold, in which case it is
   * kept as confirmed and a refund is owed (rule 9, decision 24).
   */
  private async confirmed(tx: Transaction, payment: PaymentRow, event: PaymentEvent, at: Date, callbackId: string | null): Promise<EventOutcome> {
    await this.move(
      tx,
      payment,
      'CONFIRMED',
      { confirmedAt: at, providerPaymentId: payment.providerPaymentId, providerReference: event.reference },
      'The provider confirmed the payment.',
    );
    const quote = await this.payments.lockQuote(tx, payment.insurerQuoteId);
    if (!quote) throw new Error(`Payment ${payment.id} has no quote`);
    const amountMatches = event.amountMinor === payment.amountMinor && (event.currency ?? payment.currency) === payment.currency;
    if (!amountMatches) {
      await this.openItem(tx, {
        kind: 'AMOUNT_MISMATCH',
        paymentId: payment.id,
        paymentCallbackId: callbackId,
        insurerId: quote.insurerId,
        amountMinor: event.amountMinor,
        reason: `The provider confirmed ${event.amountMinor ?? 'no amount'} ${event.currency ?? ''} against ${payment.amountMinor} ${payment.currency} expected.`.replace(/\s+/g, ' '),
      });
      await this.tellCustomer(tx, payment, 'payment.held');
      return 'AMOUNT_MISMATCH';
    }

    const standing = await this.payments.insurerStanding(tx, quote.insurerId);
    const request = await this.payments.lockRequest(tx, payment.quoteRequestId);
    if (!request) throw new Error(`Payment ${payment.id} has no request`);
    const unusable =
      (await this.payments.policyForRequest(tx, payment.quoteRequestId)) !== undefined
        ? 'This request already has a policy.'
        : quote.unpayableAt
          ? 'The insurer became unavailable while the payment was pending.'
          : quote.status !== 'ACTIVE'
            ? 'The quote was withdrawn or replaced while the payment was pending.'
            : !standing || !takesNewBusiness(standing, at)
              ? 'The insurer no longer takes new business.'
              : isQuoteExpired(quote.validUntil, at) && payment.pendingUntil && at > payment.pendingUntil
                ? 'The payment was confirmed after its price stopped being held.'
                : request.ncdCode && !(await this.redeemNcd(tx, request.ncdCode, quote.insurerId, payment.customerId, at))
                  ? "The request's no-claim discount code was already used on another request."
                  : null;
    if (unusable) {
      await this.openItem(tx, {
        kind: 'REFUND_REQUIRED',
        paymentId: payment.id,
        paymentCallbackId: callbackId,
        insurerId: quote.insurerId,
        amountMinor: payment.amountMinor,
        reason: unusable,
      });
      await this.tellCustomer(tx, payment, 'payment.held');
      return 'REFUND_REQUIRED';
    }

    const { value: deadline } = await this.settings.effective('ISSUANCE_DEADLINE', at, tx);
    const policy = await this.payments.insertPolicy(tx, {
      policyNumber: newReference('POL', at, randomInt),
      status: 'AWAITING_INSURER_CERTIFICATE',
      insurerId: quote.insurerId,
      customerId: payment.customerId,
      vehicleId: request.vehicleId,
      coverage: toContract.insuranceType(request.insuranceType),
      // The policy premium is the insurer's quoted price; the payment keeps the total and its lines.
      premiumMinor: quote.premiumMinor,
      policyStartDate: request.policyStartDate,
      policyEndDate: request.policyEndDate,
      quoteRequestId: request.id,
      insurerQuoteId: quote.id,
      insurerQuoteReference: quote.insurerReference,
      quoteDocumentId: quote.documentId,
      productVersionId: quote.productVersionId,
      paymentId: payment.id,
      receivedAt: at,
      issuanceDueAt: new Date(at.getTime() + deadline.hours * HOUR_MS),
    });
    await this.audit.write(tx, {
      actor: PROVIDER,
      action: 'policy.created',
      entityType: 'POLICY',
      entityId: policy.policyNumber,
      after: {
        insurerId: policy.insurerId,
        quoteRequestId: policy.quoteRequestId,
        insurerQuoteId: policy.insurerQuoteId,
        premiumMinor: policy.premiumMinor,
        issuanceDueAt: policy.issuanceDueAt?.toISOString() ?? null,
      },
      note: 'Paid policy received and awaiting the insurer certificate.',
      correlationId: payment.transactionId,
    });
    await this.audit.transition(tx, {
      actor: PROVIDER,
      entityType: 'POLICY',
      entityId: policy.policyNumber,
      fromStatus: null,
      toStatus: policy.status,
      note: 'Policy created after payment confirmation.',
      correlationId: payment.transactionId,
    });
    const insurer = standing?.name ?? '';
    await this.notifications.notify(tx, {
      customerId: payment.customerId,
      key: 'payment.confirmed',
      entity: { type: 'PAYMENT', id: payment.transactionId },
      values: { insurer },
    });
    await this.notifications.notify(tx, {
      customerId: payment.customerId,
      key: 'policy.created',
      entity: { type: 'POLICY', id: policy.policyNumber },
      values: { insurer, policyNumber: policy.policyNumber },
    });
    this.logger.log(`Payment ${payment.transactionId} confirmed; policy ${policy.policyNumber} awaits ${insurer}'s certificate`);
    return 'POLICY_CREATED';
  }

  /** A code discounts only its own insurer's quote, so another insurer's code stays unspent. */
  private async redeemNcd(tx: Transaction, code: string, insurerId: string, customerId: string, at: Date): Promise<boolean> {
    if (await this.payments.redeemNcdCode(tx, code, { insurerId, customerId }, at)) return true;
    return !(await this.payments.isNcdCodeIssuedBy(tx, code, insurerId));
  }

  /**
   * Asks the provider where an open attempt stands and applies the answer as
   * a callback would. At its pending deadline an attempt the provider has not
   * settled is stopped; one the provider cannot be asked about is handed to a
   * person an hour later.
   */
  async refresh(paymentId: string, now = new Date()): Promise<void> {
    const before = await this.payments.viewById(paymentId);
    if (!before || !isOpenPayment(before.status)) return;
    let answer: StatusResult;
    try {
      answer = await this.provider.status({ providerPaymentId: before.providerPaymentId, paymentId });
    } catch (error) {
      await this.payments.recordStatusCheck(paymentId, now);
      this.logger.warn(`Status check for ${before.transactionId} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      if (before.pendingUntil && now.getTime() > before.pendingUntil.getTime() + HOUR_MS) {
        await this.payments.transaction((tx) =>
          this.openItem(tx, {
            kind: 'PENDING_TOO_LONG',
            paymentId,
            amountMinor: before.amountMinor,
            reason: 'The provider could not tell us whether this payment went through, an hour after its deadline.',
          }),
        );
      }
      return;
    }
    await this.applyStatus(paymentId, answer, now);
  }

  /** The provider's answer about one attempt, from a status check or a cancel request. */
  async applyStatus(paymentId: string, answer: StatusResult, now = new Date()): Promise<void> {
    await this.payments.transaction(async (tx) => {
      const payment = await this.payments.lockPayment(tx, paymentId);
      if (!payment) return;
      const type =
        answer.status === 'CONFIRMED'
          ? 'payment.confirmed'
          : answer.status === 'FAILED'
            ? 'payment.failed'
            : answer.status === 'CANCELLED'
              ? 'payment.cancelled'
              : null;
      if (type) {
        await this.apply(
          tx,
          payment,
          {
            // One synthetic id per payment and status, so a real callback that follows finds the work done.
            eventId: `status:${payment.id}:${answer.status}`,
            type,
            providerPaymentId: payment.providerPaymentId ?? '',
            paymentId: payment.id,
            amountMinor: answer.amountMinor,
            currency: answer.currency,
            reference: answer.reference,
            reason: answer.reason,
            occurredAt: now,
          },
          now,
          null,
        );
        return;
      }
      await this.payments.move(tx, payment.id, [payment.status], { lastStatusCheckAt: now });
      if (isOpenPayment(payment.status) && payment.pendingUntil && now >= payment.pendingUntil) {
        await this.move(tx, payment, 'EXPIRED', { failureCode: 'EXPIRED', failureReason: 'No outcome by the pending deadline.' }, 'Nothing was settled by the pending deadline.');
        await this.tellCustomer(tx, payment, 'payment.expired');
      }
    });
  }

  private async move(tx: Transaction, payment: PaymentRow, to: PaymentStatus, patch: Partial<PaymentRow>, note: string): Promise<void> {
    if (!(await this.payments.move(tx, payment.id, [payment.status], { ...patch, status: to }))) {
      throw ApiException.conflict('PAYMENT_CHANGED', 'This payment changed while the provider event was applied. It will be retried.');
    }
    await this.audit.transition(tx, {
      actor: PROVIDER,
      entityType: 'PAYMENT',
      entityId: payment.transactionId,
      fromStatus: payment.status,
      toStatus: to,
      note,
      correlationId: payment.transactionId,
    });
  }

  private async tellCustomer(tx: Transaction, payment: PaymentRow, key: 'payment.failed' | 'payment.expired' | 'payment.held'): Promise<void> {
    const quote = await this.payments.lockQuote(tx, payment.insurerQuoteId);
    const standing = quote ? await this.payments.insurerStanding(tx, quote.insurerId) : undefined;
    await this.notifications.notify(tx, {
      customerId: payment.customerId,
      key,
      entity: { type: 'PAYMENT', id: payment.transactionId },
      values: { insurer: standing?.name ?? 'your insurer' },
    });
  }

  private async insurerOf(tx: Transaction, payment: PaymentRow): Promise<string | null> {
    return (await this.payments.lockQuote(tx, payment.insurerQuoteId))?.insurerId ?? null;
  }

  /** Opens an item once per kind and payment, and audits it in the same transaction. */
  private async openItem(
    tx: Transaction,
    item: {
      kind: ReconciliationKind;
      paymentId?: string;
      paymentCallbackId?: string | null;
      policyNumber?: string | null;
      insurerId?: string | null;
      amountMinor: number | null;
      reason: string;
    },
  ): Promise<void> {
    const opened = await this.payments.openItem(tx, { ...item, paymentCallbackId: item.paymentCallbackId ?? null });
    if (!opened) return;
    await this.audit.transition(tx, {
      actor: PROVIDER,
      entityType: 'RECONCILIATION_ITEM',
      entityId: opened.id,
      fromStatus: null,
      toStatus: 'OPEN',
      note: `${item.kind}: ${item.reason}`,
      correlationId: item.paymentId ?? item.paymentCallbackId ?? opened.id,
    });
  }
}
