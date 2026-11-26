import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { ACCOUNT_CLOSED } from '../common/auth/messages.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { fromContract } from '../common/contract.js';
import { MAX_NGWEE } from '../common/domain/money-limits.js';
import { newReference } from '../common/domain/reference.js';
import { ApiException } from '../common/errors/api.exception.js';
import { INSURER_UNAVAILABLE, insurerUnavailable, takesNewBusiness } from '../common/insurer-standing.js';
import { kwachaToNgwee, ngweeToKwacha } from '../common/money.js';
import type { Env } from '../config/env.js';
import type { CustomerPrincipal } from '../customer/customer-principal.js';
import { isUniqueViolation } from '../db/errors.js';
import type { Transaction } from '../db/database.module.js';
import { unacceptedCriticalConditions } from '../insurer-portal/domain/quote-content.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  isOpenPayment,
  isQuoteExpired,
  maskMsisdn,
  paymentBreakdown,
  replayOutcome,
  rtsaFeeOf,
  totalOf,
  type PaymentAttempt,
  type PaymentCharge,
} from './domain/payment.js';
import { CHOOSE_A_PAYMENT_METHOD, type PayDto } from './dto/payment.dto.js';
import { toPaymentResponse, type PaymentResponse } from './dto/payment.response.js';
import { PaymentEventsService } from './payment-events.service.js';
import { PaymentsRepository, type PaymentRow } from './payments.repository.js';
import { PAYMENT_PROVIDER, ProviderUnavailableError, type PaymentProvider } from './provider/payment-provider.js';

const IDEMPOTENCY_KEY_CONSTRAINT = 'payments_idempotencyKey_key';
const OPEN_PAYMENT_CONSTRAINT = 'payments_quoteRequestId_open_key';
const MINUTE_MS = 60_000;
/** A customer waiting on the page prompts a provider check at most this often. */
const POLL_CHECK_INTERVAL_MS = 5_000;

/** Thrown inside the transaction when the open attempt is the one this key already started. */
class SameAttempt extends Error {}

/**
 * Starting and following a payment for an accepted quote.
 *
 * The amount is worked out here from the chosen quote, its chosen add-ons and
 * the approved charges; the customer's figure is only compared. Starting a
 * payment never confirms it: the attempt is written before the provider is
 * called, and only the provider's callback or status answer moves it on.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly payments: PaymentsRepository,
    private readonly events: PaymentEventsService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async initiate(customer: CustomerPrincipal, idempotencyKey: string, dto: PayDto): Promise<PaymentResponse> {
    const method = fromContract.paymentMethod(dto.method);
    if (!method) throw new ApiException('BAD_REQUEST', CHOOSE_A_PAYMENT_METHOD);
    if (!dto.insurerQuoteId) {
      throw ApiException.conflict('RELOAD_REQUIRED', 'Reload your quotes and select the exact quote before paying.');
    }
    if (method === 'MOBILE_MONEY' && !maskMsisdn(dto.mobileNumber)) {
      throw new ApiException('VALIDATION_FAILED', 'Enter the mobile money number that should get the payment prompt.', 400, {
        mobileNumber: 'Enter a mobile money number.',
      });
    }
    const returnUrl = method === 'CARD' ? this.returnUrl(dto.returnUrl) : undefined;
    const attempt: PaymentAttempt = {
      customerId: customer.id,
      quoteRequestId: dto.quoteRequestId,
      insurerQuoteId: dto.insurerQuoteId,
      amountMinor: kwachaToNgwee(dto.amount),
      method,
    };

    const replayed = await this.replay(idempotencyKey, attempt);
    if (replayed) return replayed;

    const request = await this.payments.findRequest(customer.id, dto.quoteRequestId);
    if (!request) throw ApiException.notFound('Quote request', dto.quoteRequestId);
    const quote = await this.payments.findQuote(request.id, dto.insurerQuoteId);
    if (!quote) throw ApiException.notFound('Quote', dto.insurerQuoteId);

    const now = new Date();
    let started: PaymentRow;
    try {
      started = await this.payments.transaction(async (tx) => {
        // Paying is new business, so the insurer behind the quote has to be one
        // that may still take it. Held shared, so a deactivation waits for us.
        const standing = await this.payments.insurerStanding(tx, quote.insurerId);
        if (!standing) throw ApiException.notFound('Insurer', quote.insurerName);
        if (!takesNewBusiness(standing, now)) throw ApiException.conflict(INSURER_UNAVAILABLE, insurerUnavailable(quote.insurerName));
        if (!(await this.payments.lockOpenCustomer(tx, customer.id))) throw ApiException.forbidden(ACCOUNT_CLOSED);
        // Locked for update, so two attempts on one request take turns here.
        const lockedRequest = await this.payments.lockRequest(tx, request.id);
        if (!lockedRequest) throw ApiException.notFound('Quote request', dto.quoteRequestId);
        const locked = await this.payments.lockQuote(tx, quote.id);
        if (!locked) throw ApiException.notFound('Quote', dto.insurerQuoteId);
        if (locked.status !== 'ACTIVE') {
          throw ApiException.conflict('QUOTE_UNAVAILABLE', `${quote.insurerName} withdrew or replaced this quote. Reload your quotes and choose again.`);
        }
        if (locked.unpayableAt) {
          throw ApiException.conflict(
            'QUOTE_UNAVAILABLE',
            `${quote.insurerName}'s quote is no longer available for payment. Request fresh quotes to continue.`,
          );
        }
        const live = await this.payments.livePayment(tx, request.id);
        // The same key arriving twice at once: the second waited here for the first, so it answers with it.
        if (live && live.idempotencyKey === idempotencyKey) throw new SameAttempt();
        if (live?.status === 'CONFIRMED') {
          throw ApiException.conflict('ALREADY_PAID', 'This request is already paid for.', { transactionId: live.transactionId });
        }
        if (live) {
          throw ApiException.conflict('PAYMENT_IN_PROGRESS', 'A payment for this request is already under way.', {
            transactionId: live.transactionId,
            status: live.status,
          });
        }
        // An offer with a deadline: once it has passed the price is no longer the
        // insurer's, so the customer re-requests rather than pays a stale figure.
        if (isQuoteExpired(locked.validUntil, now)) {
          throw ApiException.conflict(
            'QUOTE_EXPIRED',
            `${quote.insurerName}'s quote expired on ${locked.validUntil.toISOString().slice(0, 10)}. Request fresh quotes to continue.`,
          );
        }

        // Every product-selection payment follows the customer's choice, which carries its add-ons.
        const selection = await this.payments.selection(tx, request.id);
        const chosen = selection?.insurerQuoteId === quote.id ? selection : undefined;
        if (request.model === 'PRODUCT_SELECTION' && !chosen) {
          throw ApiException.conflict('SELECTION_REQUIRED', 'Choose this quote before paying for it.');
        }
        const missing = unacceptedCriticalConditions(quote.conditions, chosen?.acceptedConditionCodes ?? []);
        if (missing.length > 0) {
          throw ApiException.conflict('CONDITIONS_NOT_ACCEPTED', 'Choose this quote and accept its required conditions before paying.', {
            missing,
          });
        }
        if (locked.ncdPercentage !== null && !lockedRequest.ncdCode) {
          throw ApiException.conflict('NCD_CODE_UNAVAILABLE', 'The discounted quote has no no-claim discount code. Request fresh quotes to continue.');
        }
        if (lockedRequest.ncdCode && !(await this.payments.ncdUsable(
          tx, lockedRequest.ncdCode, { insurerId: quote.insurerId, customerId: customer.id }, lockedRequest, now, locked.ncdPercentage,
        ))) {
          throw ApiException.conflict(
            'NCD_CODE_UNAVAILABLE',
            'The no-claim discount code is no longer valid for this request. Request fresh quotes to continue.',
          );
        }
        const reservedNcdCode = locked.ncdPercentage !== null ? lockedRequest.ncdCode : null;

        const lines = paymentBreakdown({
          premiumMinor: locked.premiumMinor,
          addOns: quote.addOns,
          selectedAddOnCodes: chosen?.selectedAddOnCodes ?? [],
          charges: await this.charges(now, tx),
          coverType: request.insuranceType,
          alignedToRtsaAnniversary: request.matchRtsaAnniversary,
        });
        const expectedMinor = totalOf(lines);
        if (expectedMinor > Number(MAX_NGWEE)) {
          throw ApiException.conflict('PAYMENT_AMOUNT_TOO_HIGH', 'The amount to pay exceeds the maximum payment amount.');
        }
        if (attempt.amountMinor !== expectedMinor) {
          throw ApiException.conflict('AMOUNT_MISMATCH', 'The amount does not match the quote. Reload the quote and try again.', {
            expected: ngweeToKwacha(expectedMinor),
            received: dto.amount,
            breakdown: lines.map((line) => ({ kind: line.kind, code: line.code, label: line.label, amount: ngweeToKwacha(line.amountMinor) })),
          });
        }

        const { value: timeout } = await this.settings.effective('PAYMENT_PENDING_TIMEOUT', now, tx);
        const payment = await this.payments.insertPayment(tx, {
          transactionId: newReference('TXN', now, randomInt),
          status: 'INITIATED',
          method,
          provider: this.provider.name,
          amountMinor: expectedMinor,
          rtsaAnniversaryFeeMinor: rtsaFeeOf(lines),
          amountBreakdown: lines,
          currency: 'ZMW',
          payerMsisdnMasked: method === 'MOBILE_MONEY' ? maskMsisdn(dto.mobileNumber) : null,
          idempotencyKey,
          customerId: customer.id,
          quoteRequestId: request.id,
          insurerQuoteId: quote.id,
          selectionId: chosen?.id ?? null,
          reservedNcdCode,
          initiatedAt: now,
          pendingUntil: new Date(now.getTime() + timeout.minutes * MINUTE_MS),
        });
        await this.audit.write(tx, {
          actor: auditActor(customer),
          action: 'payment.initiated',
          entityType: 'PAYMENT',
          entityId: payment.transactionId,
          after: {
            amountMinor: payment.amountMinor,
            lines: lines.map((line) => line.code),
            method: payment.method,
            quoteRequestId: payment.quoteRequestId,
            insurerQuoteId: payment.insurerQuoteId,
          },
          note: 'Payment started; waiting for the provider.',
          correlationId: payment.transactionId,
        });
        await this.audit.transition(tx, {
          actor: auditActor(customer),
          entityType: 'PAYMENT',
          entityId: payment.transactionId,
          fromStatus: null,
          toStatus: 'INITIATED',
          note: 'Written before the provider was asked.',
          correlationId: payment.transactionId,
        });
        return payment;
      });
    } catch (error) {
      if (error instanceof SameAttempt || isUniqueViolation(error, IDEMPOTENCY_KEY_CONSTRAINT)) {
        const winner = await this.replay(idempotencyKey, attempt);
        if (winner) return winner;
      }
      if (isUniqueViolation(error, OPEN_PAYMENT_CONSTRAINT)) {
        throw ApiException.conflict('PAYMENT_IN_PROGRESS', 'A payment for this request is already under way.');
      }
      if (isUniqueViolation(error, 'payment_open_ncd_code_idx')) {
        throw ApiException.conflict('NCD_CODE_UNAVAILABLE', 'A payment using this no-claim discount code is already under way.');
      }
      throw error;
    }

    await this.sendToProvider(started, dto.mobileNumber, returnUrl, quote.insurerName);
    return this.respond(customer.id, started.transactionId);
  }

  /** Outside any transaction: the attempt is already on record, whatever the provider does. */
  private async sendToProvider(payment: PaymentRow, mobileNumber: string | undefined, returnUrl: string | undefined, insurerName: string) {
    let result;
    try {
      result = await this.provider.initiate({
        paymentId: payment.id,
        amountMinor: payment.amountMinor,
        currency: payment.currency,
        method: payment.method,
        msisdn: payment.method === 'MOBILE_MONEY' ? mobileNumber : undefined,
        returnUrl,
        idempotencyKey: payment.id,
        description: `${insurerName} motor cover, ${payment.transactionId}`,
      });
    } catch (error) {
      // Unknown outcome: the attempt stays INITIATED and the status job asks the provider.
      if (!(error instanceof ProviderUnavailableError)) throw error;
      this.logger.warn(`Provider did not answer for ${payment.transactionId}; the status job will resolve it`);
      return;
    }
    await this.payments.transaction(async (tx) => {
      const accepted = result.outcome === 'ACCEPTED';
      const moved = await this.payments.move(
        tx,
        payment.id,
        ['INITIATED'],
        result.outcome === 'ACCEPTED'
          ? { status: 'PENDING', providerPaymentId: result.providerPaymentId, checkoutUrl: result.checkoutUrl }
          : { status: 'FAILED', failureCode: 'REFUSED', failureReason: result.reason },
      );
      if (!moved) return;
      await this.audit.transition(tx, {
        actor: { type: 'SYSTEM', id: null },
        entityType: 'PAYMENT',
        entityId: payment.transactionId,
        fromStatus: 'INITIATED',
        toStatus: accepted ? 'PENDING' : 'FAILED',
        note: result.outcome === 'ACCEPTED' ? 'The provider accepted the instruction.' : `The provider refused the instruction: ${result.code}.`,
        correlationId: payment.transactionId,
      });
      if (!accepted) {
        await this.notifications.notify(tx, {
          customerId: payment.customerId,
          key: 'payment.failed',
          entity: { type: 'PAYMENT', id: payment.transactionId },
          values: { insurer: insurerName },
        });
      }
    });
  }

  /**
   * Where an attempt stands. While it is open, a customer waiting on the page
   * prompts a fresh provider check every few seconds at most.
   */
  async status(customerId: string, transactionId: string): Promise<PaymentResponse> {
    const view = await this.payments.view(customerId, transactionId);
    if (!view) throw ApiException.notFound('Payment', transactionId);
    const now = new Date();
    const due = !view.lastStatusCheckAt || now.getTime() - view.lastStatusCheckAt.getTime() >= POLL_CHECK_INTERVAL_MS;
    if (!isOpenPayment(view.status) || !due) return toPaymentResponse(view);
    try {
      await this.events.refresh(view.id, now);
    } catch (error) {
      this.logger.warn(`Status check on read failed for ${transactionId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    return this.respond(customerId, transactionId);
  }

  /** Asks the provider to stop an open attempt; it is cancelled only on the provider's answer. */
  async cancel(customer: CustomerPrincipal, transactionId: string): Promise<PaymentResponse> {
    const view = await this.payments.view(customer.id, transactionId);
    if (!view) throw ApiException.notFound('Payment', transactionId);
    if (!isOpenPayment(view.status)) {
      throw ApiException.conflict('PAYMENT_NOT_OPEN', 'This payment has already finished, so it cannot be cancelled.');
    }
    let answer;
    try {
      answer = await this.provider.cancel({ providerPaymentId: view.providerPaymentId, paymentId: view.id });
    } catch (error) {
      if (!(error instanceof ProviderUnavailableError)) throw error;
      throw ApiException.conflict('PROVIDER_UNAVAILABLE', 'The payment provider did not answer. Try again in a moment.');
    }
    // A provider that never received the instruction has nothing to stop, so the attempt simply ends.
    await this.events.applyStatus(view.id, answer.status === 'NOT_FOUND' ? { ...answer, status: 'CANCELLED' } : answer);
    await this.payments.transaction((tx) =>
      this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'payment.cancel_requested',
        entityType: 'PAYMENT',
        entityId: transactionId,
        after: { providerAnswer: answer.status },
        note: 'The customer asked to stop the payment.',
        correlationId: transactionId,
      }),
    );
    return this.respond(customer.id, transactionId);
  }

  /** The approved charges in force. Until a version is stored, the RTSA fee keeps its configured amount. */
  private async charges(now: Date, tx: Transaction): Promise<PaymentCharge[]> {
    const { value, version } = await this.settings.effective('PAYMENT_CHARGES', now, tx);
    if (version !== null) return value.charges;
    const fee = this.config.get('RTSA_ANNIVERSARY_FEE_NGWEE', { infer: true });
    return value.charges.map((charge) => (charge.code === 'RTSA_ANNIVERSARY_FEE' ? { ...charge, amountMinor: fee } : charge));
  }

  /** Card checkout returns only to one of InsurShield's own web origins. */
  private returnUrl(requested: string | undefined): string {
    const origins = this.config.get('CORS_ORIGINS', { infer: true });
    if (!requested) return `${origins[0]}/`;
    let url: URL;
    try {
      url = new URL(requested);
    } catch {
      throw new ApiException('VALIDATION_FAILED', 'The return address is not valid.', 400, { returnUrl: 'Not a valid address.' });
    }
    if (!origins.includes(url.origin)) {
      throw new ApiException('VALIDATION_FAILED', 'The return address must be on InsurShield.', 400, { returnUrl: 'Not an InsurShield address.' });
    }
    return url.toString();
  }

  /** The attempt a key started, as it stands now; a refusal when the key was used for another payment. */
  private async replay(idempotencyKey: string, attempt: PaymentAttempt): Promise<PaymentResponse | undefined> {
    const stored = await this.payments.findByKey(idempotencyKey);
    if (!stored) return undefined;
    switch (replayOutcome(stored, attempt)) {
      case 'another-customer':
        throw ApiException.forbidden();
      case 'different-payment':
        throw ApiException.conflict('IDEMPOTENCY_KEY_REUSED', 'This payment key was already used for a different payment. Start the payment again.');
      case 'replay':
        return toPaymentResponse(stored);
    }
  }

  private async respond(customerId: string, transactionId: string): Promise<PaymentResponse> {
    const view = await this.payments.view(customerId, transactionId);
    if (!view) throw ApiException.notFound('Payment', transactionId);
    return toPaymentResponse(view);
  }
}
