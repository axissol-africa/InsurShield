import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { ACCOUNT_CLOSED } from '../common/auth/messages.js';
import { ApiException } from '../common/errors/api.exception.js';
import { fromContract, toContract } from '../common/contract.js';
import { kwachaToNgwee, ngweeToKwacha } from '../common/money.js';
import { newReference } from '../common/domain/reference.js';
import { isUniqueViolation } from '../db/errors.js';
import {
  expectedAmountMinor,
  isQuoteExpired,
  providerReference,
  replayOutcome,
  type PaymentAttempt,
} from './domain/payment.js';
import { toReceipt, type ReceiptResponse } from './dto/receipt.dto.js';
import { PaymentsRepository, type ReceiptRow } from './payments.repository.js';
import { CHOOSE_A_PAYMENT_METHOD, type PayDto } from './dto/payment.dto.js';

const IDEMPOTENCY_KEY_CONSTRAINT = 'payments_idempotencyKey_key';

/**
 * Taking payment for an accepted quote.
 *
 * Two rules shape everything here. The amount is never taken from the request
 * — it is checked against the insurer's own quote, so a tampered client cannot
 * decide what it pays. And payment alone never issues a policy (DEC-019): a
 * confirmed payment creates a policy `AWAITING_INSURER_CERTIFICATE`, and only
 * the insurer's certificate makes it active.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(private readonly payments: PaymentsRepository) {}

  async pay(customerId: string, idempotencyKey: string, dto: PayDto): Promise<ReceiptResponse> {
    const method = fromContract.paymentMethod(dto.method);
    if (!method) throw new ApiException('BAD_REQUEST', CHOOSE_A_PAYMENT_METHOD);
    const attempt: PaymentAttempt = {
      customerId,
      quoteRequestId: dto.quoteRequestId,
      insurerName: dto.insurer,
      amountMinor: kwachaToNgwee(dto.amount),
      method,
    };

    const replayed = await this.replay(idempotencyKey, attempt);
    if (replayed) return replayed;

    const request = await this.payments.findRequest(customerId, dto.quoteRequestId);
    if (!request) throw ApiException.notFound('Quote request', dto.quoteRequestId);

    const quote = await this.payments.findQuote(request.id, dto.insurer);
    if (!quote) throw ApiException.notFound('Quote from', dto.insurer);

    const expectedMinor = expectedAmountMinor(quote.premiumMinor, kwachaToNgwee(dto.rtsaAnniversaryFee ?? 0));
    const confirmedAt = new Date();

    let paid: ReceiptRow;
    try {
      paid = await this.payments.transaction(async (tx) => {
        if (!(await this.payments.lockOpenCustomer(tx, customerId))) throw ApiException.forbidden(ACCOUNT_CLOSED);
        await this.payments.lockRequest(tx, request.id);

        // Inserted before the checks, so a second request with this key waits on the first and replays it.
        const payment = await this.payments.insertPayment(tx, {
          transactionId: newReference('TXN', confirmedAt, randomInt),
          status: 'CONFIRMED',
          method,
          amountMinor: attempt.amountMinor,
          currency: 'ZMW',
          confirmedAt,
          providerReference: providerReference(dto.mobileNumber),
          idempotencyKey,
          customerId,
          quoteRequestId: request.id,
          insurerQuoteId: quote.id,
        });

        const existingPolicy = await this.payments.findPolicyNumberForRequest(tx, request.id);
        if (existingPolicy) {
          throw ApiException.conflict('ALREADY_PAID', `This request was already paid; policy ${existingPolicy} exists.`);
        }
        // An offer with a deadline: once it has passed the price is no longer the
        // insurer's, so the customer re-requests rather than pays a stale figure.
        if (isQuoteExpired(quote.validUntil, confirmedAt)) {
          throw ApiException.conflict(
            'QUOTE_EXPIRED',
            `${quote.insurerName}'s quote expired on ${quote.validUntil.toISOString().slice(0, 10)}. Request fresh quotes to continue.`,
          );
        }
        if (attempt.amountMinor !== expectedMinor) {
          throw ApiException.conflict(
            'AMOUNT_MISMATCH',
            'The amount does not match the quoted premium. Reload the quote and try again.',
            { expected: ngweeToKwacha(expectedMinor), received: dto.amount },
          );
        }

        const policy = await this.payments.insertPolicy(tx, {
          policyNumber: newReference('POL', confirmedAt, randomInt),
          status: 'AWAITING_INSURER_CERTIFICATE',
          insurerId: quote.insurerId,
          customerId,
          vehicleId: request.vehicleId,
          coverage: toContract.insuranceType(request.insuranceType),
          premiumMinor: attempt.amountMinor,
          policyStartDate: request.policyStartDate,
          policyEndDate: request.policyEndDate,
          quoteRequestId: request.id,
          insurerQuoteId: quote.id,
          insurerQuoteReference: quote.insurerReference,
          quoteDocumentId: quote.documentId,
          paymentId: payment.id,
          receivedAt: confirmedAt,
        });

        // A code discounts only its own insurer's quote, so another insurer's code stays unspent.
        if (request.ncdCode) {
          const redeemed = await this.payments.redeemNcdCode(
            tx,
            request.ncdCode,
            { insurerId: quote.insurerId, customerId },
            confirmedAt,
          );
          if (!redeemed && (await this.payments.isNcdCodeIssuedBy(tx, request.ncdCode, quote.insurerId))) {
            throw ApiException.conflict(
              'NCD_CODE_UNAVAILABLE',
              'The no-claim discount code on this request has already been used. Request fresh quotes to continue.',
            );
          }
        }
        return { ...payment, policyNumber: policy.policyNumber };
      });
    } catch (error) {
      if (isUniqueViolation(error, IDEMPOTENCY_KEY_CONSTRAINT)) {
        const winner = await this.replay(idempotencyKey, attempt);
        if (winner) return winner;
      }
      throw error;
    }

    this.logger.log(
      `Payment ${paid.transactionId} confirmed for ${request.id}; policy ${paid.policyNumber} awaits ${quote.insurerName}'s certificate`,
    );
    return toReceipt(paid);
  }

  /** The original receipt when the key was used for this same payment; a refusal when it was used for another. */
  private async replay(idempotencyKey: string, attempt: PaymentAttempt): Promise<ReceiptResponse | undefined> {
    const stored = await this.payments.findByKey(idempotencyKey);
    if (!stored) return undefined;
    switch (replayOutcome(stored, attempt)) {
      case 'another-customer':
        throw ApiException.forbidden();
      case 'different-payment':
        throw ApiException.conflict(
          'IDEMPOTENCY_KEY_REUSED',
          'This payment key was already used for a different payment. Start the payment again.',
        );
      case 'replay':
        this.logger.log(`Replayed payment ${stored.transactionId} for key ${idempotencyKey}`);
        return toReceipt(stored);
    }
  }

  /** A receipt the customer can quote, and the policy it created. */
  async status(customerId: string, transactionId: string): Promise<ReceiptResponse> {
    const receipt = await this.payments.findReceipt(customerId, transactionId);
    if (!receipt) throw ApiException.notFound('Payment', transactionId);
    return toReceipt(receipt);
  }
}
