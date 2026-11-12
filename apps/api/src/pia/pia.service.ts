import { Injectable } from '@nestjs/common';
import { percentToBps } from '../common/money.js';
import type { Transaction } from '../db/database.module.js';
import { toPiaResponse } from './dto/pia.dto.js';
import { PiaRepository } from './pia.repository.js';
import { DEFAULT_PIA_RATE_BPS } from './pia-rate.js';
import type { Principal } from '../common/auth/auth.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { ApprovalService } from '../approvals/approval.service.js';
import type { ApprovalRequestRow } from '../approvals/approval.repository.js';

@Injectable()
export class PiaService {
  constructor(
    private readonly pia: PiaRepository,
    private readonly audit: AuditService,
    private readonly approvals: ApprovalService,
  ) {}

  async get() {
    return toPiaResponse(await this.pia.find());
  }

  /** The current regulatory rate in basis points, usable inside a caller transaction. */
  async currentRateBps(tx?: Transaction): Promise<number> {
    return (await this.pia.find(tx))?.piaRateBps ?? DEFAULT_PIA_RATE_BPS;
  }

  async set(piaRatePercentage: number, principal: Extract<Principal, { kind: 'staff' }>) {
    const saved = await this.pia.transaction(async (tx) => {
      await this.applyRate(tx, piaRatePercentage, principal, 'pia.minimum_rate_bps');
      return this.pia.find(tx);
    });
    return toPiaResponse(saved);
  }

  async proposeSet(piaRatePercentage: number, principal: Extract<Principal, { kind: 'staff' }>) {
    return this.approvals.request({
      action: 'PIA_FLOOR_CHANGE',
      targetType: 'SETTING',
      targetId: 'pia.minimum_rate_bps',
      payload: { piaRatePercentage },
      requestedReason: 'Update the PIA minimum rate.',
    }, principal);
  }

  async executeApproved(
    tx: Transaction,
    request: ApprovalRequestRow,
    principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    if (request.action !== 'PIA_FLOOR_CHANGE' || request.targetType !== 'SETTING' || request.targetId !== 'pia.minimum_rate_bps') {
      throw new Error('A non-PIA approval reached the PIA executor.');
    }
    const percentage = request.payload.piaRatePercentage;
    if (typeof percentage !== 'number' || !Number.isFinite(percentage)) {
      throw new Error('The approval request has an invalid PIA rate.');
    }
    await this.applyRate(tx, percentage, principal, request.id, 'Administrator approved the current PIA minimum rate.');
  }

  private async applyRate(
    tx: Transaction,
    percentage: number,
    principal: Extract<Principal, { kind: 'staff' }>,
    correlationId: string,
    note = 'Administrator updated the current PIA minimum rate.',
  ) {
    const piaRateBps = percentToBps(percentage);
    const previous = await this.pia.lockCurrent(tx);
    await this.pia.save(tx, piaRateBps, principal.id);
    await this.pia.appendHistory(tx, {
      piaRateBps,
      previousRateBps: previous?.piaRateBps ?? null,
      changedByStaffId: principal.id,
    });
    await this.audit.write(tx, {
      actor: auditActor(principal),
      action: 'setting.pia_floor_updated',
      entityType: 'SETTING',
      entityId: 'pia.minimum_rate_bps',
      before: previous ? { piaRateBps: previous.piaRateBps } : null,
      after: { piaRateBps },
      note,
      correlationId,
    });
  }
}
