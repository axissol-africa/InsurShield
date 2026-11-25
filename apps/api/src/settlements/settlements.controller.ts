import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Needs } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { isInsurerRole } from '../common/domain/enums.js';
import { DraftSettlementDto, FinaliseSettlementDto, ListSettlementsQuery, ProposeAdjustmentDto } from './dto/settlement.dto.js';
import { SettlementsService } from './settlements.service.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

/** InsurShield's side: drawing up, approving and exporting settlements, and adjusting the next one. */
@Controller('admin')
export class AdminSettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Needs('settlement:manage')
  @Get('settlements')
  list(@Query() query: ListSettlementsQuery) {
    return this.settlements.list(query.insurerId);
  }

  @Needs('settlement:manage')
  @Post('settlements')
  @HttpCode(HttpStatus.CREATED)
  draft(@Body() dto: DraftSettlementDto, @CurrentUser() principal: StaffPrincipal) {
    return this.settlements.draft(principal, dto);
  }

  @Needs('settlement:manage')
  @Get('settlements/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.settlements.get(id);
  }

  @Needs('settlement:manage')
  @Get('settlements/:id/export')
  @Header('Cache-Control', 'no-store')
  async export(@Param('id', ParseUUIDPipe) id: string, @Res() response: Response) {
    send(response, await this.settlements.csv(id));
  }

  @Needs('settlement:manage')
  @Post('settlements/:id/finalise')
  @HttpCode(HttpStatus.OK)
  finalise(@Param('id', ParseUUIDPipe) id: string, @Body() dto: FinaliseSettlementDto, @CurrentUser() principal: StaffPrincipal) {
    return this.settlements.requestFinalise(principal, id, dto.reason.trim());
  }

  @Needs('adjustment:propose')
  @Post('money-adjustments')
  @HttpCode(HttpStatus.CREATED)
  proposeAdjustment(@Body() dto: ProposeAdjustmentDto, @CurrentUser() principal: StaffPrincipal) {
    return this.settlements.proposeAdjustment(principal, dto);
  }
}

/** The insurer's side: its own finalised settlements, read only. */
@Controller('insurer')
export class InsurerSettlementsController {
  constructor(private readonly settlements: SettlementsService) {}

  @Needs('portal:settlement:read')
  @Get('settlements')
  list(@CurrentUser() principal: Principal) {
    return this.settlements.listForInsurer(insurerOf(principal));
  }

  @Needs('portal:settlement:read')
  @Get('settlements/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() principal: Principal) {
    return this.settlements.getForInsurer(insurerOf(principal), id);
  }

  @Needs('portal:settlement:read')
  @Get('settlements/:id/export')
  @Header('Cache-Control', 'no-store')
  async export(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() principal: Principal, @Res() response: Response) {
    send(response, await this.settlements.csvForInsurer(insurerOf(principal), id));
  }
}

function insurerOf(principal: Principal): string {
  if (principal.kind !== 'staff' || !isInsurerRole(principal.role) || !principal.insurerId) {
    throw ApiException.forbidden('This account is not linked to an insurer.');
  }
  return principal.insurerId;
}

function send(response: Response, file: { fileName: string; body: string }) {
  response
    .status(200)
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${file.fileName}"`)
    .send(file.body);
}
