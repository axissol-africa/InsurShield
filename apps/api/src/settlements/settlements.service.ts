import { Injectable } from '@nestjs/common';
import { randomInt, randomUUID } from 'node:crypto';
import type { ApprovalRequestRow } from '../approvals/approval.repository.js';
import { ApprovalService } from '../approvals/approval.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import type { AdjustmentKind } from '../common/domain/enums.js';
import { newReference } from '../common/domain/reference.js';
import { ApiException } from '../common/errors/api.exception.js';
import { kwachaToNgwee, ngweeToKwacha } from '../common/money.js';
import type { Transaction } from '../db/database.module.js';
import { RefundsRepository } from '../payments/refunds.repository.js';
import { SettingsService } from '../settings/settings.service.js';
import { monthlyPeriod, settlementCsv, settlementTotals, splitBreakdown } from './domain/settlement.js';
import { SettlementsRepository, type LineRow, type SettlementRow } from './settlements.repository.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

export interface ProposeAdjustment {
  insurerId: string;
  amount: number;
  kind: AdjustmentKind;
  reason: string;
  reconciliationItemId?: string;
}

/**
 * What InsurShield owes each insurer, period by period. A draft is worked out
 * from the records and can be drawn again; a second administrator approves
 * it, after which it and its lines never change and every record in it is
 * marked as settled, so no later settlement takes it again.
 */
@Injectable()
export class SettlementsService {
  constructor(
    private readonly settlements: SettlementsRepository,
    private readonly items: RefundsRepository,
    private readonly approvals: ApprovalService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  async draft(principal: StaffPrincipal, input: { insurerId: string; period: string }) {
    const period = monthlyPeriod(input.period);
    if (!period) throw new ApiException('VALIDATION_FAILED', 'Choose a month as YYYY-MM.', 400, { period: 'Not a month.' });
    if (period.end > new Date()) {
      throw ApiException.conflict('PERIOD_NOT_OVER', 'A month can be settled only once it has ended.');
    }
    const id = await this.settlements.transaction(async (tx) => {
      const insurerName = await this.settlements.insurerName(tx, input.insurerId);
      if (!insurerName) throw ApiException.notFound('Insurer', input.insurerId);
      const existing = await this.settlements.lockForPeriod(tx, input.insurerId, period.label);
      if (existing && existing.status !== 'DRAFT') {
        throw ApiException.conflict(
          'SETTLEMENT_LOCKED',
          existing.status === 'FINALISED' ? 'This month is already settled. Correct it with an adjustment in a later month.' : 'This settlement is waiting for approval.',
        );
      }
      if (existing) await this.settlements.remove(tx, existing.id);

      const paid = await this.settlements.unsettledPayments(tx, input.insurerId, period.end);
      const refunded = await this.settlements.unsettledRefunds(tx, input.insurerId, period.end);
      const adjusted = await this.settlements.unsettledAdjustments(tx, input.insurerId, period.end);
      // The commission in force when the period began, so a later change cannot reach back.
      const { value: commission, version } = await this.settings.effective('COMMISSION_RULE', period.start, tx);
      const paymentLines = paid.map((payment) => ({ payment, ...splitBreakdown(lineSource(payment)) }));
      const totals = settlementTotals({
        payments: paymentLines.map(({ payment, premiumMinor, feesMinor }) => ({ paymentId: payment.id, premiumMinor, feesMinor })),
        refunds: refunded.map((refund) => ({ refundId: refund.id, amountMinor: refund.amountMinor })),
        adjustments: adjusted.map((adjustment) => ({ adjustmentId: adjustment.id, amountMinor: adjustment.amountMinor })),
        commissionBps: commission.basisPoints,
      });
      const now = new Date();
      const created = await this.settlements.insert(
        tx,
        {
          reference: newReference('SET', now, randomInt),
          insurerId: input.insurerId,
          period: period.label,
          periodStart: period.start,
          periodEnd: period.end,
          ...totals,
          commissionBps: commission.basisPoints,
          ruleVersions: { COMMISSION_RULE: version },
          draftedByStaffId: principal.id,
        },
        [
          ...paymentLines.map(({ payment, premiumMinor, feesMinor }) => ({
            kind: 'PAYMENT' as const,
            paymentId: payment.id,
            amountMinor: premiumMinor,
            feeMinor: feesMinor,
            reference: payment.transactionId,
            occurredAt: payment.confirmedAt!,
          })),
          ...refunded.map((refund) => ({
            kind: 'REFUND' as const,
            refundId: refund.id,
            amountMinor: -refund.amountMinor,
            reference: refund.transactionId,
            occurredAt: refund.completedAt!,
          })),
          ...adjusted.map((adjustment) => ({
            kind: 'ADJUSTMENT' as const,
            adjustmentId: adjustment.id,
            amountMinor: adjustment.amountMinor,
            reference: adjustment.kind,
            occurredAt: adjustment.createdAt,
          })),
        ],
      );
      await this.audit.transition(tx, {
        actor: auditActor(principal),
        entityType: 'SETTLEMENT',
        entityId: created.id,
        fromStatus: null,
        toStatus: 'DRAFT',
        note: `${insurerName} ${period.label}: net ${ngweeToKwacha(totals.netPayableMinor)} from ${paid.length} payments, ${refunded.length} refunds, ${adjusted.length} adjustments.`,
        correlationId: created.reference,
      });
      return created.id;
    });
    return this.get(id);
  }

  async list(insurerId?: string) {
    const rows = await this.settlements.list({ insurerId });
    return rows.map((row) => toSummary(row.settlement, row.insurerName));
  }

  async get(id: string) {
    const found = await this.settlements.find(id);
    if (!found) throw ApiException.notFound('Settlement', id);
    return { ...toSummary(found.settlement, found.insurerName), lines: (await this.settlements.linesOf(id)).map(toLine) };
  }

  async csv(id: string) {
    const found = await this.settlements.find(id);
    if (!found) throw ApiException.notFound('Settlement', id);
    return this.csvOf(found.settlement, found.insurerName);
  }

  /** Sends a draft for a second administrator's approval. */
  async requestFinalise(principal: StaffPrincipal, id: string, reason: string) {
    return this.settlements.transaction(async (tx) => {
      const settlement = await this.settlements.lock(tx, id);
      if (!settlement) throw ApiException.notFound('Settlement', id);
      if (settlement.status !== 'DRAFT') throw ApiException.conflict('SETTLEMENT_LOCKED', 'Only a draft can be sent for approval.');
      const insurerName = await this.settlements.insurerName(tx, settlement.insurerId);
      const approval = await this.approvals.requestIn(
        tx,
        {
          action: 'SETTLEMENT_FINALISE',
          targetType: 'SETTLEMENT',
          targetId: settlement.id,
          payload: {
            reference: settlement.reference,
            insurer: insurerName ?? '',
            period: settlement.period,
            netPayable: ngweeToKwacha(settlement.netPayableMinor),
            grossPremium: ngweeToKwacha(settlement.grossPremiumMinor),
          },
          requestedReason: reason,
        },
        principal,
      );
      await this.settlements.move(tx, id, { status: 'PROPOSED', approvalRequestId: approval.id });
      await this.audit.transition(tx, {
        actor: auditActor(principal),
        entityType: 'SETTLEMENT',
        entityId: id,
        fromStatus: 'DRAFT',
        toStatus: 'PROPOSED',
        note: reason,
        correlationId: settlement.reference,
      });
      return { id, status: 'PROPOSED', approvalRequestId: approval.id };
    });
  }

  /** Runs inside the approving transaction. Anything already settled elsewhere means the draft is stale. */
  async executeFinalise(tx: Transaction, request: ApprovalRequestRow, principal: StaffPrincipal) {
    const settlement = await this.settlements.lock(tx, request.targetId);
    if (!settlement || settlement.status !== 'PROPOSED') {
      throw ApiException.conflict('SETTLEMENT_NOT_PROPOSED', 'This settlement is no longer waiting for approval.');
    }
    const lines = await this.settlements.linesOf(settlement.id, tx);
    if (!(await this.settlements.markSettled(tx, settlement.id, lines))) {
      throw ApiException.conflict('SETTLEMENT_STALE', 'Some of these records were settled meanwhile. Draw the settlement again.');
    }
    await this.settlements.move(tx, settlement.id, { status: 'FINALISED', finalisedAt: new Date() });
    await this.audit.transition(tx, {
      actor: auditActor(principal),
      entityType: 'SETTLEMENT',
      entityId: settlement.id,
      fromStatus: 'PROPOSED',
      toStatus: 'FINALISED',
      note: `Finalised by a second administrator: net ${ngweeToKwacha(settlement.netPayableMinor)}.`,
      correlationId: settlement.reference,
    });
  }

  async rejectedFinalise(tx: Transaction, request: ApprovalRequestRow, principal: StaffPrincipal) {
    const settlement = await this.settlements.lock(tx, request.targetId);
    if (settlement?.status !== 'PROPOSED') return;
    await this.settlements.move(tx, settlement.id, { status: 'DRAFT', approvalRequestId: null });
    await this.audit.transition(tx, {
      actor: auditActor(principal),
      entityType: 'SETTLEMENT',
      entityId: settlement.id,
      fromStatus: 'PROPOSED',
      toStatus: 'DRAFT',
      note: 'The second administrator rejected it; it is a draft again.',
      correlationId: settlement.reference,
    });
  }

  /** An adjustment exists only once approved; until then it is the approval request. */
  async proposeAdjustment(principal: StaffPrincipal, input: ProposeAdjustment) {
    // Signed: the stored range check is for amounts, so the size is checked and the sign put back.
    const amountMinor = Math.sign(input.amount) * kwachaToNgwee(Math.abs(input.amount));
    if (amountMinor === 0) throw new ApiException('VALIDATION_FAILED', 'An adjustment cannot be zero.', 400, { amount: 'Cannot be zero.' });
    const reason = input.reason.trim();
    return this.settlements.transaction(async (tx) => {
      const insurerName = await this.settlements.insurerName(tx, input.insurerId);
      if (!insurerName) throw ApiException.notFound('Insurer', input.insurerId);
      if (input.reconciliationItemId) {
        const item = await this.items.lockItem(tx, input.reconciliationItemId);
        if (!item || item.status === 'RESOLVED') throw ApiException.notFound('Open reconciliation item', input.reconciliationItemId);
      }
      const approval = await this.approvals.requestIn(
        tx,
        {
          action: 'MONEY_ADJUSTMENT',
          targetType: 'ADJUSTMENT',
          targetId: randomUUID(),
          payload: {
            insurerId: input.insurerId,
            insurer: insurerName,
            amountMinor,
            amount: ngweeToKwacha(amountMinor),
            kind: input.kind,
            reason,
            reconciliationItemId: input.reconciliationItemId ?? null,
          },
          requestedReason: reason,
        },
        principal,
      );
      return { approvalRequestId: approval.id, insurer: insurerName, amount: ngweeToKwacha(amountMinor), kind: input.kind, status: 'PENDING_APPROVAL' };
    });
  }

  async executeAdjustment(tx: Transaction, request: ApprovalRequestRow, principal: StaffPrincipal) {
    const payload = request.payload as {
      insurerId: string;
      amountMinor: number;
      kind: AdjustmentKind;
      reason: string;
      reconciliationItemId: string | null;
    };
    const created = await this.settlements.insertAdjustment(tx, {
      insurerId: payload.insurerId,
      kind: payload.kind,
      amountMinor: payload.amountMinor,
      reason: payload.reason,
      reconciliationItemId: payload.reconciliationItemId,
      approvalRequestId: request.id,
      proposedByStaffId: request.requestedByStaffId,
      approvedByStaffId: principal.id,
    });
    if (!created) return;
    await this.audit.write(tx, {
      actor: auditActor(principal),
      action: 'money_adjustment.approved',
      entityType: 'MONEY_ADJUSTMENT',
      entityId: created.id,
      after: { insurerId: created.insurerId, amountMinor: created.amountMinor, kind: created.kind },
      note: created.reason,
      correlationId: request.id,
    });
    if (payload.reconciliationItemId) {
      const resolved = await this.items.resolveItem(tx, payload.reconciliationItemId, 'ADJUSTED', `Adjusted ${ngweeToKwacha(created.amountMinor)} in the insurer's next settlement.`, new Date(), principal.id);
      if (resolved) {
        await this.audit.transition(tx, {
          actor: auditActor(principal),
          entityType: 'RECONCILIATION_ITEM',
          entityId: resolved.id,
          fromStatus: 'OPEN',
          toStatus: 'RESOLVED',
          note: 'Resolved as ADJUSTED when the adjustment was approved.',
          correlationId: request.id,
        });
      }
    }
  }

  /** An insurer's finalised settlements, and only theirs. */
  async listForInsurer(insurerId: string) {
    const rows = await this.settlements.list({ insurerId, finalisedOnly: true });
    return rows.map((row) => toSummary(row.settlement, row.insurerName));
  }

  async getForInsurer(insurerId: string, id: string) {
    const found = await this.settlements.find(id);
    if (!found || found.settlement.insurerId !== insurerId || found.settlement.status !== 'FINALISED') throw ApiException.notFound('Settlement', id);
    return this.get(id);
  }

  async csvForInsurer(insurerId: string, id: string) {
    await this.getForInsurer(insurerId, id);
    return this.csv(id);
  }

  private async csvOf(settlement: SettlementRow, insurerName: string) {
    const lines = await this.settlements.linesOf(settlement.id);
    return {
      fileName: `${settlement.reference}-${settlement.period}.csv`,
      body: settlementCsv({ insurer: insurerName, period: settlement.period, reference: settlement.reference }, lines, settlement),
    };
  }
}

function lineSource(payment: { amountBreakdown: { kind: string; amountMinor: number }[]; amountMinor: number }) {
  // A payment from before itemised breakdowns is all premium.
  return payment.amountBreakdown.length > 0 ? payment.amountBreakdown : [{ kind: 'PREMIUM', amountMinor: payment.amountMinor }];
}

function toSummary(settlement: SettlementRow, insurerName: string) {
  return {
    id: settlement.id,
    reference: settlement.reference,
    insurerId: settlement.insurerId,
    insurer: insurerName,
    period: settlement.period,
    status: settlement.status,
    grossPremium: ngweeToKwacha(settlement.grossPremiumMinor),
    fees: ngweeToKwacha(settlement.feesMinor),
    refunds: ngweeToKwacha(settlement.refundsMinor),
    adjustments: ngweeToKwacha(settlement.adjustmentsMinor),
    commission: ngweeToKwacha(settlement.commissionMinor),
    commissionBps: settlement.commissionBps,
    netPayable: ngweeToKwacha(settlement.netPayableMinor),
    approvalRequestId: settlement.approvalRequestId,
    finalisedAt: settlement.finalisedAt?.toISOString() ?? null,
    createdAt: settlement.createdAt.toISOString(),
  };
}

function toLine(line: LineRow) {
  return {
    kind: line.kind,
    reference: line.reference,
    occurredAt: line.occurredAt.toISOString(),
    amount: ngweeToKwacha(line.amountMinor),
    fee: ngweeToKwacha(line.feeMinor),
  };
}
