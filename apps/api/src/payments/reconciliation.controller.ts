import { Body, Controller, Get, Header, HttpCode, HttpStatus, Inject, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiException } from '../common/errors/api.exception.js';
import type { Env } from '../config/env.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './provider/payment-provider.js';
import { StandInPaymentProvider } from './provider/stand-in-payment-provider.js';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { AssignItemDto, ImportStatementDto, ListItemsQuery, ProposeRefundDto, ResolveItemDto, StatementPeriodQuery } from './dto/reconciliation.dto.js';
import { StatementsService } from './statements.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { RefundsService } from './refunds.service.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

/** InsurShield's own queue of money to account for, and the refunds that settle it. */
@Controller('admin')
export class ReconciliationController {
  constructor(
    private readonly reconciliation: ReconciliationService,
    private readonly refunds: RefundsService,
    private readonly statements: StatementsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  /**
   * Development and test only: the statement the stand-in provider would
   * send for a period, to try the import with. Absent in production.
   */
  @Needs('reconciliation:manage')
  @Get('reconciliation/stand-in-statement')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  standInStatement(@Query() query: StatementPeriodQuery) {
    if (this.config.get('NODE_ENV', { infer: true }) === 'production' || !(this.provider instanceof StandInPaymentProvider)) {
      throw ApiException.notFound('Route', 'reconciliation/stand-in-statement');
    }
    return this.statements.standInStatement(new Date(query.from), new Date(query.to));
  }

  /** The provider's statement for a period, compared line by line with InsurShield's records. */
  @Needs('reconciliation:manage')
  @Post('reconciliation/statements')
  @HttpCode(HttpStatus.CREATED)
  importStatement(@Body() dto: ImportStatementDto, @CurrentUser() principal: StaffPrincipal) {
    return this.statements.import(principal, { fileName: dto.fileName, periodStart: new Date(dto.periodStart), periodEnd: new Date(dto.periodEnd), csv: dto.csv });
  }

  @Needs('reconciliation:read')
  @Get('reconciliation/statements')
  listStatements() {
    return this.statements.list();
  }

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
