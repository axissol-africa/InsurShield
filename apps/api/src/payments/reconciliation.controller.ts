import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { AssignItemDto, ListItemsQuery, ProposeRefundDto, ResolveItemDto } from './dto/reconciliation.dto.js';
import { ReconciliationService } from './reconciliation.service.js';
import { RefundsService } from './refunds.service.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

/** InsurShield's own queue of money to account for, and the refunds that settle it. */
@Controller('admin')
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly refunds: RefundsService,
  ) {}

  @Needs('reconciliation:read')
  @Get('reconciliation/items')
  list(@Query() query: ListItemsQuery, @CurrentUser() principal: StaffPrincipal) {
    return this.reconciliation.list(principal, query);
  }

  @Needs('reconciliation:manage')
  @Post('reconciliation/items/:id/assign')
  @HttpCode(HttpStatus.OK)
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignItemDto, @CurrentUser() principal: StaffPrincipal) {
    return this.reconciliation.assign(principal, id, dto);
  }

  @Needs('reconciliation:manage')
  @Post('reconciliation/items/:id/resolve')
  @HttpCode(HttpStatus.OK)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResolveItemDto, @CurrentUser() principal: StaffPrincipal) {
    return this.reconciliation.resolve(principal, id, dto);
  }

  /** Proposes a refund; a different administrator approves it in the approvals inbox before any money moves. */
  @Needs('refund:propose')
  @Post('payments/:transactionId/refunds')
  @HttpCode(HttpStatus.CREATED)
  proposeRefund(@Param('transactionId') transactionId: string, @Body() dto: ProposeRefundDto, @CurrentUser() principal: StaffPrincipal) {
    return this.refunds.propose(principal, transactionId, dto);
  }
}
