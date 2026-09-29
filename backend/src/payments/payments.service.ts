import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { fromContract, toContract } from '../common/contract.js';
import { PaymentStatus, PolicyStatus } from '../generated/prisma/enums.js';
import type { PayDto } from './dto/payment.dto.js';

/** How far the amount may differ from the quote before it is refused (rounding only). */
const AMOUNT_TOLERANCE = 0.01;

const newReference = (prefix: string) =>
  `${prefix}-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

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

  constructor(private readonly prisma: PrismaService) {}

  async pay(customerId: string, idempotencyKey: string, dto: PayDto) {
    // A retried POST must never charge twice. The stored key is the guard, so
    // a repeat returns the original receipt instead of creating a second one.
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
      include: { policy: { select: { policyNumber: true } } },
    });
    if (existing) {
      if (existing.customerId !== customerId) throw ApiException.forbidden();
      this.logger.log(`Replayed payment ${existing.transactionId} for key ${idempotencyKey}`);
      return this.receipt(existing, existing.policy?.policyNumber ?? null);
    }

    const request = await this.prisma.quoteRequest.findFirst({
      where: { id: dto.quoteRequestId, customerId },
      include: {
        vehicle: true,
        quotes: { include: { insurer: { select: { id: true, name: true } } } },
        policies: { select: { policyNumber: true } },
      },
    });
    if (!request) throw ApiException.notFound('Quote request', dto.quoteRequestId);

    if (request.policies.length > 0) {
      throw ApiException.conflict(
        'ALREADY_PAID',
        `This request was already paid; policy ${request.policies[0].policyNumber} exists.`,
      );
    }

    const quote = request.quotes.find((item) => item.insurer.name === dto.insurer);
    if (!quote) {
      throw ApiException.notFound('Quote from', dto.insurer);
    }

    // An offer with a deadline: once it has passed the price is no longer the
    // insurer's, so the customer re-requests rather than pays a stale figure.
    if (quote.validUntil <= new Date()) {
      throw ApiException.conflict(
        'QUOTE_EXPIRED',
        `${quote.insurer.name}'s quote expired on ${quote.validUntil.toISOString().slice(0, 10)}. Request fresh quotes to continue.`,
      );
    }

    const expected = quote.premium.toNumber() + (dto.rtsaAnniversaryFee ?? 0);
    if (Math.abs(expected - dto.amount) > AMOUNT_TOLERANCE) {
      throw ApiException.conflict(
        'AMOUNT_MISMATCH',
        'The amount does not match the quoted premium. Reload the quote and try again.',
        { expected, received: dto.amount },
      );
    }

    const method = fromContract.paymentMethod(dto.method)!;
    const confirmedAt = new Date();

    // One transaction: money and cover are recorded together or not at all.
    const { payment, policyNumber } = await this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          transactionId: newReference('TXN'),
          status: PaymentStatus.CONFIRMED,
          method,
          amount: dto.amount,
          currency: 'ZMW',
          confirmedAt,
          providerReference: dto.mobileNumber ? `MM-${dto.mobileNumber.slice(-4)}` : null,
          idempotencyKey,
          customerId,
          quoteRequestId: request.id,
          insurerQuoteId: quote.id,
        },
      });

      const policy = await tx.policy.create({
        data: {
          policyNumber: newReference('POL'),
          status: PolicyStatus.AWAITING_INSURER_CERTIFICATE,
          insurerId: quote.insurer.id,
          customerId,
          vehicleId: request.vehicleId,
          coverage: toContract.insuranceType(request.insuranceType),
          premium: dto.amount,
          policyStartDate: request.policyStartDate,
          policyEndDate: request.policyEndDate,
          quoteRequestId: request.id,
          insurerQuoteId: quote.id,
          insurerQuoteReference: quote.insurerReference,
          quoteDocumentId: quote.documentId,
          paymentId: payment.id,
          receivedAt: confirmedAt,
        },
      });

      // The code is spent on the policy it discounted, not on the next one.
      if (request.ncdCode) {
        await tx.ncdCode.updateMany({
          where: { code: request.ncdCode, redeemedAt: null },
          data: { redeemedAt: confirmedAt },
        });
      }

      return { payment, policyNumber: policy.policyNumber };
    });

    this.logger.log(
      `Payment ${payment.transactionId} confirmed for ${request.id}; policy ${policyNumber} awaits ${quote.insurer.name}'s certificate`,
    );
    return this.receipt(payment, policyNumber);
  }

  /** A receipt the customer can quote, and the policy it created. */
  async status(customerId: string, transactionId: string) {
    const payment = await this.prisma.payment.findFirst({
      where: { transactionId, customerId },
      include: { policy: { select: { policyNumber: true } } },
    });
    if (!payment) throw ApiException.notFound('Payment', transactionId);
    return this.receipt(payment, payment.policy?.policyNumber ?? null);
  }

  private receipt(
    payment: {
      transactionId: string;
      status: PaymentStatus;
      method: Parameters<typeof toContract.paymentMethod>[0];
      amount: { toNumber(): number };
      currency: string;
      confirmedAt: Date | null;
      quoteRequestId: string;
    },
    policyNumber: string | null,
  ) {
    return {
      transactionId: payment.transactionId,
      status: toContract.paymentStatus(payment.status),
      method: toContract.paymentMethod(payment.method),
      amount: payment.amount.toNumber(),
      currency: payment.currency,
      confirmedAt: payment.confirmedAt?.toISOString() ?? null,
      quoteRequestId: payment.quoteRequestId,
      policyNumber,
    };
  }
}
