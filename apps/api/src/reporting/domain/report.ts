import { LUSAKA, lusakaDay } from '../../common/domain/lusaka.js';

const DAY_MS = 86_400_000;
export const MAX_REPORT_DAYS = 366;

export function reportPeriod(from: string, to: string) {
  const parse = (day: string) => {
    if (typeof day !== 'string' || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(day)) return null;
    const date = new Date(`${day}T00:00:00+02:00`);
    return Number.isFinite(date.getTime()) && lusakaDay(date) === day ? date : null;
  };
  const start = parse(from);
  const last = parse(to);
  if (!start || !last || last < start || last.getTime() - start.getTime() >= MAX_REPORT_DAYS * DAY_MS) return null;
  return { from, to, timeZone: LUSAKA, start, end: new Date(last.getTime() + DAY_MS) };
}
export type ReportPeriod = NonNullable<ReturnType<typeof reportPeriod>>;
export type ReportType = 'operations' | 'finance';
export interface ReportMetric {
  key: string;
  label: string;
  value: string;
  unit: 'count' | 'minorUnits';
  definition: string;
  currency?: 'ZMW';
}
export interface Report {
  reportId: string;
  reportType: ReportType;
  generatedAt: string;
  dataAsOf: string;
  filters: { from: string; to: string; timeZone: string };
  scope: { kind: 'platform' | 'insurer'; insurerId: string | null };
  owner: { organization: 'InsurShield' | 'insurer'; insurerId: string | null };
  privacy: 'aggregate-only';
  limitations: string[];
  metrics: ReportMetric[];
}

/** Quote all cells and neutralise spreadsheet formulas even if a future label comes from configuration. */
function cell(value: string): string {
  const safe = /^[\s]*[=+\-@\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function reportCsv(report: Report): string {
  const header = ['reportId', 'reportType', 'generatedAt', 'dataAsOf', 'from', 'to', 'timeZone', 'scope', 'insurerId', 'owner', 'privacy', 'limitations', 'key', 'label', 'value', 'unit', 'currency', 'definition'];
  return [header, ...report.metrics.map((metric) => [
    report.reportId, report.reportType, report.generatedAt, report.dataAsOf,
    report.filters.from, report.filters.to, report.filters.timeZone, report.scope.kind,
    report.scope.insurerId ?? '', report.owner.organization, report.privacy, report.limitations.join(' '),
    metric.key, metric.label, metric.value, metric.unit, metric.currency ?? '', metric.definition,
  ])].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
