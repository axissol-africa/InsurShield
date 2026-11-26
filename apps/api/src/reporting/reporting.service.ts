import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { isInsurerRole } from '../common/domain/enums.js';
import { ApiException } from '../common/errors/api.exception.js';
import { reportCsv, reportPeriod, type Report, type ReportType } from './domain/report.js';
import type { ReportQueryDto } from './dto/report-query.dto.js';
import { ReportingRepository } from './reporting.repository.js';

@Injectable()
export class ReportingService {
  constructor(private readonly reports: ReportingRepository, private readonly audit: AuditService) {}

  async generate(principal: Principal, reportType: ReportType, scope: 'platform' | 'insurer', query: ReportQueryDto, format: 'json' | 'csv' = 'json') {
    const permission = scope === 'platform' ? 'admin:reports:read' : reportType === 'finance' ? 'portal:reports:finance' : 'portal:reports:operations';
    if (principal.kind !== 'staff' || !holds(principal, permission)) throw ApiException.forbidden();
    if (scope === 'platform' && (isInsurerRole(principal.role) || reportType !== 'operations')) throw ApiException.forbidden();
    if (scope === 'insurer' && (!isInsurerRole(principal.role) || !principal.insurerId)) throw ApiException.forbidden('This account is not linked to an insurer.');
    const insurerId = scope === 'insurer' ? principal.insurerId : null;
    const period = reportPeriod(query.from, query.to);
    if (!period) throw new ApiException('VALIDATION_FAILED', 'Choose real from/to dates in YYYY-MM-DD order, covering at most 366 inclusive Lusaka days.', 400);
    return this.reports.snapshot(async (tx) => {
      const dataAsOf = await this.reports.dataAsOf(tx);
      const metrics = reportType === 'finance' && insurerId !== null
        ? await this.reports.finance(tx, period, insurerId)
        : await this.reports.operations(tx, period, insurerId, new Date(dataAsOf));
      const report: Report = {
        reportId: randomUUID(), reportType, generatedAt: new Date().toISOString(), dataAsOf,
        filters: { from: period.from, to: period.to, timeZone: period.timeZone },
        scope: { kind: scope, insurerId }, owner: { organization: scope === 'platform' ? 'InsurShield' : 'insurer', insurerId },
        privacy: 'aggregate-only',
        limitations: [
          'Operational management information only; not a statutory or regulatory report. No regulatory approval is asserted.',
          'Filters are inclusive Lusaka calendar dates. Each metric defines its event date or cohort; current states are read at dataAsOf, not reconstructed historical states.',
          ...(reportType === 'finance' ? ['DEC-013 commercial model is not approved. Only established recorded financial facts are shown; no fees or commission are calculated, and no commercial approval is asserted. Existing settlement access remains separate.'] : []),
        ],
        metrics,
      };
      const csv = format === 'csv' ? reportCsv(report) : null;
      await this.audit.write(tx, {
        actor: auditActor(principal), action: format === 'csv' ? 'report.exported' : 'report.generated',
        entityType: 'REPORT', entityId: report.reportId,
        after: { permission, reportType, from: period.from, to: period.to, timeZone: period.timeZone, format, scope, insurerId, generatedAt: report.generatedAt, dataAsOf },
      });
      return { report, csv };
    });
  }
}
