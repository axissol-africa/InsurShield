import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Needs } from '../common/auth/auth.guard.js';
import type { Principal } from '../common/auth/auth.types.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import { ReportQueryDto } from './dto/report-query.dto.js';
import { ReportingService } from './reporting.service.js';

@Controller('admin/reports')
export class AdminReportingController {
  constructor(private readonly reports: ReportingService) {}

  @Get('operations')
  @Needs('admin:reports:read')
  @Header('Cache-Control', 'no-store')
  async operations(@CurrentUser() principal: Principal, @Query() query: ReportQueryDto) {
    return (await this.reports.generate(principal, 'operations', 'platform', query)).report;
  }

  @Get('operations/export')
  @Needs('admin:reports:read')
  @Header('Cache-Control', 'no-store')
  async exportOperations(@CurrentUser() principal: Principal, @Query() query: ReportQueryDto, @Res() response: Response) {
    const result = await this.reports.generate(principal, 'operations', 'platform', query, 'csv');
    response.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="operations-report.csv"').send(result.csv);
  }
}

@Controller('insurer/reports')
export class InsurerReportingController {
  constructor(private readonly reports: ReportingService) {}

  @Get('operations')
  @Needs('portal:reports:operations')
  @Header('Cache-Control', 'no-store')
  async operations(@CurrentUser() principal: Principal, @Query() query: ReportQueryDto) {
    return (await this.reports.generate(principal, 'operations', 'insurer', query)).report;
  }

  @Get('operations/export')
  @Needs('portal:reports:operations')
  @Header('Cache-Control', 'no-store')
  async exportOperations(@CurrentUser() principal: Principal, @Query() query: ReportQueryDto, @Res() response: Response) {
    const result = await this.reports.generate(principal, 'operations', 'insurer', query, 'csv');
    response.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="operations-report.csv"').send(result.csv);
  }

  @Get('finance')
  @Needs('portal:reports:finance')
  @Header('Cache-Control', 'no-store')
  async finance(@CurrentUser() principal: Principal, @Query() query: ReportQueryDto) {
    return (await this.reports.generate(principal, 'finance', 'insurer', query)).report;
  }

  @Get('finance/export')
  @Needs('portal:reports:finance')
  @Header('Cache-Control', 'no-store')
  async exportFinance(@CurrentUser() principal: Principal, @Query() query: ReportQueryDto, @Res() response: Response) {
    const result = await this.reports.generate(principal, 'finance', 'insurer', query, 'csv');
    response.type('text/csv; charset=utf-8').set('Content-Disposition', 'attachment; filename="finance-report.csv"').send(result.csv);
  }
}
