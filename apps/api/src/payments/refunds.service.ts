import { lockCustomerForFinance } from '../db/customer-lock.js';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApprovalRequestRow } from '../approvals/approval.repository.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor, type AuditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { RefundReason } from '../common/domain/enums.js';
import { ApiException } from '../common/errors/api.exception.js';
import { kwachaToNgwee, ngweeToKwacha } from '../common/money.js';
import type { Transaction } from '../db/database.module.js';
import { JobsRepository } from '../jobs/jobs.repository.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { PAYMENT_PROVIDER, type PaymentEvent, type PaymentProvider } from './provider/payment-provider.js';
import { isRefundablePayment } from './domain/payment.js';
import { RefundsRepository, type RefundRow } from './refunds.repository.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;
type PaymentRow = NonNullable<Awaited<ReturnType<RefundsRepository['lockPayment']>>>;

export const REFUND_SUBMIT = 'payments.refund-submit';
const SYSTEM: AuditActor = { type: 'SYSTEM', id: null };
const PROVIDER: AuditActor = { type: 'SYSTEM', id: null };
/** The kinds of item a full refund settles: each one was waiting for the money to go back. */
const SETTLED_BY_FULL_REFUND = ['REFUND_REQUIRED', 'ISSUANCE_FAILED', 'AMOUNT_MISMATCH', 'DUPLICATE'] as const;

export interface ProposeRefund {
  amount: number;
  reasonCode: RefundReason;
  reason: string;
  reconciliationItemId?: string;
}

/**
 * Money going back to a customer. One administrator proposes it, a different
 * one approves it (decision 15), and only then is the provider asked. The
 * amount is checked against what is left to refund when it is proposed and
 * again, with the payment locked, when it is approved.
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);

  constructor(
    private readonly refunds: RefundsRepository,
    private readonly approvals: ApprovalService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly jobs: JobsRepository,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async propose(principal: StaffPrincipal, transactionId: string, dto: ProposeRefund) {
    const amountMinor = kwachaToNgwee(dto.amount);
    const reason = dto.reason.trim();
    return this.refunds.transaction(async (tx) => {
      const now = new Date();
      const customerId = await this.refunds.paymentCustomerId(tx, transactionId);
      if (!customerId) throw ApiException.notFound('Payment', transactionId);
      await lockCustomerForFinance(tx, customerId);
      const payment = await this.refunds.lockPaymentByTransaction(tx, transactionId);
      if (!payment) throw ApiException.notFound('Payment', transactionId);
      if (!isRefundablePayment(payment)) {
        throw ApiException.conflict('PAYMENT_NOT_REFUNDABLE', 'Only a confirmed payment can be refunded.');
      }
      if (!payment.providerPaymentId) {
        throw ApiException.conflict(
          'REFUND_NOT_POSSIBLE',
          'This payment was taken before payments went through a provider, so it cannot be refunded from here. Refund it outside InsurShield, then resolve the item.',
        );
      }
      await this.refunds.expireAbandoned(tx, payment.id, now);
      const open = await this.refunds.openRefund(tx, payment.id);
      if (open) {
        throw ApiException.conflict('REFUND_IN_PROGRESS', 'A refund for this payment is already waiting for approval or the provider.', {
          refundId: open.id,
          status: open.status,
        });
      }
      const remaining = payment.amountMinor - (await this.refunds.refundedMinor(tx, payment.id));
      if (amountMinor > remaining) {
        throw ApiException.conflict('REFUND_TOO_LARGE', `At most ${ngweeToKwacha(remaining)} is left to refund on this payment.`, {
          remaining: ngweeToKwacha(remaining),
        });
      }
      if (dto.reconciliationItemId) {
        const item = await this.refunds.lockItem(tx, dto.reconciliationItemId);
        if (!item || item.paymentId !== payment.id) throw ApiException.notFound('Reconciliation item', dto.reconciliationItemId);
        if (item.status === 'RESOLVED') throw ApiException.conflict('ITEM_RESOLVED', 'This item is already resolved.');
        if (item.status === 'OPEN') await this.refunds.moveItem(tx, item.id, { status: 'IN_PROGRESS', ownerStaffId: item.ownerStaffId ?? principal.id });
      }
      const refund = await this.refunds.insertRefund(tx, {
        paymentId: payment.id,
        amountMinor,
        reasonCode: dto.reasonCode,
        reason,
        provider: payment.provider,
        proposedByStaffId: principal.id,
        reconciliationItemId: dto.reconciliationItemId ?? null,
      });
      const approval = await this.approvals.requestIn(
        tx,
        {
          action: 'PAYMENT_REFUND',
          targetType: 'REFUND',
          targetId: refund.id,
          payload: { transactionId, amount: ngweeToKwacha(amountMinor), paidAmount: ngweeToKwacha(payment.amountMinor), reasonCode: dto.reasonCode, reason },
          requestedReason: reason,
        },
        principal,
      );
      const proposed = await this.refunds.moveRefund(tx, refund.id, ['PROPOSED'], { approvalRequestId: approval.id });
      await this.audit.transition(tx, {
        actor: auditActor(principal),
        entityType: 'REFUND',
        entityId: refund.id,
        fromStatus: null,
        toStatus: 'PROPOSED',
        note: `${ngweeToKwacha(amountMinor)} proposed for ${transactionId} (${dto.reasonCode}): ${reason}`,
        correlationId: transactionId,
      });
      return toRefundResponse(proposed!, transactionId);
    });
  }

  /** Runs inside the approving transaction: the amount is checked again with the payment locked. */
  async executeApproved(tx: Transaction, request: ApprovalRequestRow, principal: StaffPrincipal): Promise<void> {
    const refund = await this.refunds.lockRefund(tx, request.targetId);
    if (!refund || refund.status !== 'PROPOSED') {
      throw ApiException.conflict('REFUND_NOT_PROPOSED', 'This refund is no longer waiting for approval.');
    }
    const payment = await this.refunds.lockPayment(tx, refund.paymentId);
    if (!payment || !isRefundablePayment(payment)) {
      throw ApiException.conflict('PAYMENT_NOT_REFUNDABLE', 'The payment is no longer confirmed, so it cannot be refunded.');
    }
    const remaining = payment.amountMinor - (await this.refunds.refundedMinor(tx, payment.id));
    if (refund.amountMinor > remaining) {
      throw ApiException.conflict('REFUND_TOO_LARGE', `At most ${ngweeToKwacha(remaining)} is left to refund on this payment.`);
    }
    const at = new Date();
    await this.refunds.moveRefund(tx, refund.id, ['PROPOSED'], { status: 'APPROVED', approvedAt: at });
    await this.audit.transition(tx, {
      actor: auditActor(principal),
      entityType: 'REFUND',
      entityId: refund.id,
      fromStatus: 'PROPOSED',
      toStatus: 'APPROVED',
      note: 'Approved by a second administrator; sent to the provider next.',
      correlationId: payment.transactionId,
    });
    // Keyed by the refund, so a retried job can never send it twice.
    await this.jobs.enqueue(tx, { kind: REFUND_SUBMIT, key: refund.id, payload: {}, runAfter: at });
  }

  async rejected(tx: Transaction, request: ApprovalRequestRow, principal: StaffPrincipal): Promise<void> {
    const moved = await this.refunds.moveRefund(tx, request.targetId, ['PROPOSED'], { status: 'REJECTED' });
    if (!moved) return;
    await this.audit.transition(tx, {
      actor: auditActor(principal),
      entityType: 'REFUND',
      entityId: moved.id,
      fromStatus: 'PROPOSED',
      toStatus: 'REJECTED',
      note: 'The second administrator rejected the refund.',
      correlationId: moved.id,
    });
  }

  /**
   * Sends an approved refund to the provider, outside any transaction. The
   * provider is given the refund id as its idempotency key, so a retry after
   * a lost answer cannot pay out twice.
   */
  async submit(refundId: string): Promise<void> {
    const refund = await this.refunds.findRefund(refundId);
    if (!refund || refund.status !== 'APPROVED') return;
    const payment = await this.refunds.transaction(async (tx) => {
      // Match callback lock order: payment first, then the refund it owns.
      const lockedPayment = await this.refunds.lockPayment(tx, refund.paymentId);
      const lockedRefund = await this.refunds.lockRefund(tx, refund.id);
      if (!lockedRefund || lockedRefund.status !== 'APPROVED') return undefined;
      if (!lockedPayment || !isRefundablePayment(lockedPayment)) {
        await this.failRefund(tx, lockedRefund, 'The payment is no longer refundable; no instruction was sent to the provider.', new Date());
        return undefined;
      }
      if (!lockedPayment.providerPaymentId) {
        await this.failRefund(tx, lockedRefund, 'The payment has no provider reference to refund against.', new Date());
        return undefined;
      }
      return { ...lockedPayment, providerPaymentId: lockedPayment.providerPaymentId };
    });
    if (!payment) return;
    // A provider that does not answer throws, and the job runner tries again later with the same key.
    const result = await this.provider.refund({
      providerPaymentId: payment.providerPaymentId,
      refundId: refund.id,
      amountMinor: refund.amountMinor,
      idempotencyKey: refund.id,
    });
    await this.refunds.transaction(async (tx) => {
      const locked = await this.refunds.lockRefund(tx, refund.id);
      if (!locked || locked.status !== 'APPROVED') return;
      const at = new Date();
      const submitted = await this.refunds.moveRefund(tx, refund.id, ['APPROVED'], {
        status: 'SUBMITTED',
        providerRefundId: result.providerRefundId,
        submittedAt: at,
      });
      await this.audit.transition(tx, {
        actor: SYSTEM,
        entityType: 'REFUND',
        entityId: refund.id,
        fromStatus: 'APPROVED',
        toStatus: 'SUBMITTED',
        note: 'The provider accepted the refund.',
        correlationId: payment.transactionId,
      });
      if (result.status === 'COMPLETED') await this.complete(tx, submitted!, at);
      if (result.status === 'FAILED') await this.failRefund(tx, submitted!, 'The provider refused the refund.', at);
    });
  }

  /** For a submitted refund whose callback has not come. */
  async refresh(refundId: string): Promise<void> {
    const refund = await this.refunds.findRefund(refundId);
    if (refund?.status === 'APPROVED') return this.submit(refundId);
    if (refund?.status !== 'SUBMITTED' || !refund.providerRefundId) return;
    const answer = await this.provider.refundStatus({ providerRefundId: refund.providerRefundId });
    if (answer.status === 'SUBMITTED' || answer.status === 'NOT_FOUND') return;
    await this.refunds.transaction(async (tx) => {
      const locked = await this.refunds.lockRefund(tx, refundId);
      if (locked?.status !== 'SUBMITTED') return;
      if (answer.status === 'COMPLETED') await this.complete(tx, locked, new Date());
      else await this.failRefund(tx, locked, answer.reason ?? 'The provider refused the refund.', new Date());
    });
  }

  /** A refund event from the provider, applied with its payment locked. */
  async applyEvent(tx: Transaction, payment: PaymentRow, event: PaymentEvent, at: Date): Promise<'REFUNDED' | 'REFUND_FAILED' | 'ALREADY_APPLIED' | 'UNMATCHED'> {
    const refund = event.providerRefundId ? await this.refunds.lockRefundByProviderId(tx, payment.id, event.providerRefundId) : undefined;
    if (!refund) return 'UNMATCHED';
    if (event.type === 'refund.completed') {
      if (refund.status === 'COMPLETED') return 'ALREADY_APPLIED';
      if (refund.status !== 'SUBMITTED') return 'UNMATCHED';
      await this.complete(tx, refund, at);
      return 'REFUNDED';
    }
    if (refund.status === 'FAILED') return 'ALREADY_APPLIED';
    if (refund.status !== 'SUBMITTED') return 'UNMATCHED';
    await this.failRefund(tx, refund, event.reason ?? 'The provider refused the refund.', at);
    return 'REFUND_FAILED';
  }

  /**
   * The money is back with the customer. A payment refunded in full no longer
   * stands behind a policy that was never issued, so that policy is cancelled,
   * and the items that were waiting for the refund are resolved.
   */
  private async complete(tx: Transaction, refund: RefundRow, at: Date) {
    await this.refunds.moveRefund(tx, refund.id, ['SUBMITTED'], { status: 'COMPLETED', completedAt: at });
    const payment = (await this.refunds.lockPayment(tx, refund.paymentId))!;
    await this.audit.transition(tx, {
      actor: PROVIDER,
      entityType: 'REFUND',
      entityId: refund.id,
      fromStatus: 'SUBMITTED',
      toStatus: 'COMPLETED',
      note: `The provider returned ${ngweeToKwacha(refund.amountMinor)} to the customer.`,
      correlationId: payment.transactionId,
    });
    const full = (await this.refunds.refundedMinor(tx, payment.id)) >= payment.amountMinor;
    const resolving = full
      ? await this.refunds.openItemsFor(tx, payment.id, SETTLED_BY_FULL_REFUND)
      : refund.reconciliationItemId
        ? [await this.refunds.lockItem(tx, refund.reconciliationItemId)].filter((item) => item && item.status !== 'RESOLVED')
        : [];
    for (const item of resolving) {
      if (!item) continue;
      await this.refunds.resolveItem(tx, item.id, 'REFUNDED', `Refunded ${ngweeToKwacha(refund.amountMinor)} (refund ${refund.id}).`, at, null);
      await this.audit.transition(tx, {
        actor: SYSTEM,
        entityType: 'RECONCILIATION_ITEM',
        entityId: item.id,
        fromStatus: item.status,
        toStatus: 'RESOLVED',
        note: 'Resolved as REFUNDED when the refund completed.',
        correlationId: payment.transactionId,
      });
    }
    if (full) {
      const cancelled = await this.refunds.cancelFailedPolicy(tx, payment.id, at);
      if (cancelled) {
        await this.audit.transition(tx, {
          actor: SYSTEM,
          entityType: 'POLICY',
          entityId: cancelled.policyNumber,
          fromStatus: 'ISSUANCE_FAILED',
          toStatus: 'CANCELLED',
          note: 'Cancelled once the payment behind it was refunded in full.',
          correlationId: payment.transactionId,
        });
      }
    }
    await this.notifications.notify(tx, {
      customerId: payment.customerId,
      key: 'payment.refunded',
      entity: { type: 'PAYMENT', id: payment.transactionId },
      values: { amount: `ZMW ${ngweeToKwacha(refund.amountMinor).toFixed(2)}`, transactionId: payment.transactionId },
    });
    this.logger.log(`Refund ${refund.id} completed for ${payment.transactionId}`);
  }

  /** A refund the provider would not make. The item stays open, and a new refund can be proposed. */
  private async failRefund(tx: Transaction, refund: RefundRow, reason: string, at: Date) {
    const moved = await this.refunds.moveRefund(tx, refund.id, ['APPROVED', 'SUBMITTED'], { status: 'FAILED', failureReason: reason, updatedAt: at });
    if (!moved) return;
    await this.audit.transition(tx, {
      actor: PROVIDER,
      entityType: 'REFUND',
      entityId: refund.id,
      fromStatus: refund.status,
      toStatus: 'FAILED',
      note: reason,
      correlationId: refund.paymentId,
    });
  }
}

export function toRefundResponse(refund: RefundRow, transactionId: string) {
  return {
    id: refund.id,
    transactionId,
    amount: ngweeToKwacha(refund.amountMinor),
    reasonCode: refund.reasonCode,
    reason: refund.reason,
    status: refund.status,
    approvalRequestId: refund.approvalRequestId,
    reconciliationItemId: refund.reconciliationItemId,
    failureReason: refund.failureReason,
    createdAt: refund.createdAt.toISOString(),
    completedAt: refund.completedAt?.toISOString() ?? null,
  };
}
