import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApprovalDecisionDto } from '../approvals/approval.dto.js';
import { ApprovalService } from '../approvals/approval.service.js';
import type { ApprovalRequestRow } from '../approvals/approval.repository.js';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import { InsurersService } from '../insurers/insurers.service.js';
import { PiaService } from '../pia/pia.service.js';

/** The independent administrator's inbox for high-risk platform changes. */
@Controller('admin/approvals')
export class ApprovalsController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly insurers: InsurersService,
    private readonly pia: PiaService,
  ) {}

  @Needs('approval:read')
  @Get()
  list() {
    return this.approvals.listPending();
  }

  @Needs('approval:decide')
  @Post(':id/approve')
  approve(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.approvals.approve(id, principal, dto.reason, (tx, request) => this.execute(tx, request, principal));
  }

  @Needs('approval:decide')
  @Post(':id/reject')
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ApprovalDecisionDto,
    @CurrentUser() principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    return this.approvals.reject(id, principal, dto.reason);
  }

  private execute(tx: Transaction, request: ApprovalRequestRow, principal: Extract<Principal, { kind: 'staff' }>) {
    switch (request.action) {
      case 'PIA_FLOOR_CHANGE':
        return this.pia.executeApproved(tx, request, principal);
      case 'INSURER_ACTIVATE':
      case 'INSURER_DEACTIVATE':
      case 'INSURER_SUSPEND':
        return this.insurers.executeApproved(tx, request, principal);
      case 'INSURER_DELETE':
      case 'INSURER_RESTORE':
        if (principal.role !== 'SUPER_ADMIN') {
          throw ApiException.forbidden('Only a super administrator may approve insurer deletion or restoration.');
        }
        return this.insurers.executeApproved(tx, request, principal);
      default:
        throw ApiException.conflict('APPROVAL_ACTION_INVALID', 'This approval action cannot be executed.');
    }
  }
}
