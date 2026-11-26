import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { ngweeToKwacha } from '../common/money.js';
import { DATABASE, type Database } from '../db/database.module.js';
import { payments } from '../db/schema.js';
import { isRefundablePayment } from './domain/payment.js';
import type { AssignItemDto, ListItemsQuery, ResolveItemDto } from './dto/reconciliation.dto.js';
import { RefundsRepository, type RefundRow } from './refunds.repository.js';
import { toRefundResponse } from './refunds.service.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;
const PAGE = 50;
const DAY_MS = 86_400_000;

/**
 * The queue of money InsurShield has to account for. Every item has an
 * amount, a reason, an owner and an age, and ends with an outcome and a note.
 * Resolving an item never moves money: a refund does that, under its own
 * approval.
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly refunds: RefundsRepository,
    private readonly audit: AuditService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async list(principal: StaffPrincipal, query: ListItemsQuery) {
    const limit = query.limit ?? PAGE;
    const rows = await this.refunds.listItems({
      status: query.status,
      kind: query.kind,
      insurerId: query.insurerId,
      ownerStaffId: query.owner === 'me' ? principal.id : query.owner,
      after: decodeCursor(query.cursor),
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const paymentIds = [...new Set(page.flatMap((row) => (row.item.paymentId ? [row.item.paymentId] : [])))];
    const refunds = await this.refunds.refundsOf(paymentIds);
    const paymentRows = paymentIds.length ? await this.db.select({
      id: payments.id,
      transactionId: payments.transactionId,
      status: payments.status,
      amountMinor: payments.amountMinor,
      providerPaymentId: payments.providerPaymentId,
      reservedNcdCode: payments.reservedNcdCode,
      confirmedAt: payments.confirmedAt,
    }).from(payments).where(inArray(payments.id, paymentIds)) : [];
    const paymentsById = new Map(paymentRows.map((payment) => [payment.id, payment]));
    const now = Date.now();
    return {
      items: page.map((row) => {
        const payment = row.item.paymentId ? paymentsById.get(row.item.paymentId) : undefined;
        const own = refunds.filter((refund) => refund.paymentId === row.item.paymentId);
        return {
          id: row.item.id,
          kind: row.item.kind,
          status: row.item.status,
          outcome: row.item.outcome,
          amount: row.item.amountMinor === null ? null : ngweeToKwacha(row.item.amountMinor),
          reason: row.item.reason,
          openedAt: row.item.openedAt.toISOString(),
          ageDays: Math.floor((now - row.item.openedAt.getTime()) / DAY_MS),
          owner: row.item.ownerStaffId ? { id: row.item.ownerStaffId, name: row.ownerName } : null,
          insurerId: row.item.insurerId,
          insurer: row.insurerName,
          policyNumber: row.item.policyNumber,
          payment: payment
            ? {
                transactionId: payment.transactionId,
                status: payment.status,
                amount: ngweeToKwacha(payment.amountMinor),
                refunded: ngweeToKwacha(completedOf(own)),
                refundable: Boolean(payment.providerPaymentId) && isRefundablePayment(payment),
                requiresExternalRefund: payment.status === 'CONFIRMED' && !payment.providerPaymentId,
              }
            : null,
          refunds: payment ? own.map((refund) => toRefundResponse(refund, payment.transactionId)) : [],
          resolutionNote: row.item.resolutionNote,
          resolvedAt: row.item.resolvedAt?.toISOString() ?? null,
        };
      }),
      next: rows.length > limit ? encodeCursor(page[page.length - 1].item) : null,
    };
  }

  async assign(principal: StaffPrincipal, id: string, dto: AssignItemDto) {
    return this.refunds.transaction(async (tx) => {
      const item = await this.refunds.lockItem(tx, id);
      if (!item) throw ApiException.notFound('Reconciliation item', id);
      if (item.status === 'RESOLVED') throw ApiException.conflict('ITEM_RESOLVED', 'This item is already resolved.');
      if (dto.staffId && !(await this.refunds.insurshieldAdmin(tx, dto.staffId))) {
        throw new ApiException('VALIDATION_FAILED', 'Choose an active InsurShield administrator.', 400, { staffId: 'Not an InsurShield administrator.' });
      }
      const status = dto.staffId ? 'IN_PROGRESS' : 'OPEN';
      const moved = await this.refunds.moveItem(tx, id, { ownerStaffId: dto.staffId, status });
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'reconciliation.assigned',
        entityType: 'RECONCILIATION_ITEM',
        entityId: id,
        before: { ownerStaffId: item.ownerStaffId },
        after: { ownerStaffId: dto.staffId },
        correlationId: id,
      });
      return { id, status: moved!.status, ownerStaffId: moved!.ownerStaffId };
    });
  }

  async resolve(principal: StaffPrincipal, id: string, dto: ResolveItemDto) {
    const note = dto.note.trim();
    return this.refunds.transaction(async (tx) => {
      const item = await this.refunds.lockItem(tx, id);
      if (!item) throw ApiException.notFound('Reconciliation item', id);
      if (item.status === 'RESOLVED') throw ApiException.conflict('ITEM_RESOLVED', 'This item is already resolved.');
      // Saying money went back is only true once a refund has completed.
      // A payment from before the provider can only be refunded outside InsurShield, so its word is taken.
      if (
        dto.outcome === 'REFUNDED' &&
        item.paymentId &&
        (await this.refunds.providerPaymentIdOf(tx, item.paymentId)) &&
        (await this.refunds.refundedMinor(tx, item.paymentId)) === 0
      ) {
        throw ApiException.conflict('NO_REFUND_COMPLETED', 'No refund has completed for this payment yet. Propose one, or choose another outcome.');
      }
      const resolved = await this.refunds.resolveItem(tx, id, dto.outcome, note, new Date(), principal.id);
      await this.audit.transition(tx, {
        actor: auditActor(principal),
        entityType: 'RECONCILIATION_ITEM',
        entityId: id,
        fromStatus: item.status,
        toStatus: 'RESOLVED',
        note: `${dto.outcome}: ${note}`,
        correlationId: id,
      });
      return { id, status: resolved!.status, outcome: resolved!.outcome, resolutionNote: resolved!.resolutionNote, resolvedAt: resolved!.resolvedAt!.toISOString() };
    });
  }
}

function completedOf(refunds: RefundRow[]): number {
  return refunds.filter((refund) => refund.status === 'COMPLETED').reduce((sum, refund) => sum + refund.amountMinor, 0);
}

function encodeCursor(item: { openedAt: Date; id: string }): string {
  return Buffer.from(`${item.openedAt.toISOString()}|${item.id}`).toString('base64url');
}

function decodeCursor(cursor: string | undefined): { openedAt: Date; id: string } | undefined {
  if (!cursor) return undefined;
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const openedAt = new Date(at ?? '');
  if (Number.isNaN(openedAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id ?? '')) {
    throw new ApiException('VALIDATION_FAILED', 'This page link is not valid. Start from the first page.', 400);
  }
  return { openedAt, id };
}
