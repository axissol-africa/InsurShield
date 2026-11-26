import { reportCsv, reportPeriod, type Report } from './report.js';

describe('report periods', () => {
  it('uses inclusive Lusaka days with an exclusive UTC end', () => {
    const period = reportPeriod('2026-09-01', '2026-09-30');
    expect(period?.start.toISOString()).toBe('2026-08-31T22:00:00.000Z');
    expect(period?.end.toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });
  it.each([
    ['', '2026-09-01'], ['2026-02-29', '2026-03-01'], ['2026-04-31', '2026-05-01'],
    ['2026-09-02', '2026-09-01'], ['2026-01-01', '2027-01-02'], ['2026-9-01', '2026-09-02'],
    ['2026-09-01T00:00:00Z', '2026-09-02'], ['0000-01-01', '0000-01-01'],
  ])('rejects invalid or unbounded dates %s to %s', (from, to) => {
    expect(reportPeriod(from, to)).toBeNull();
  });
  it('accepts one day, leap day, and the maximum 366-day period', () => {
    expect(reportPeriod('2026-09-01', '2026-09-01')).not.toBeNull();
    expect(reportPeriod('2024-02-29', '2024-02-29')).not.toBeNull();
    expect(reportPeriod('2024-01-01', '2024-12-31')).not.toBeNull();
  });
});

describe('aggregate CSV', () => {
  it('carries definitions, timestamps and scope, and safely quotes formula cells and exact large amounts', () => {
    const report: Report = {
      reportId: 'report-id', reportType: 'finance', generatedAt: '2026-10-01T00:00:00.000Z', dataAsOf: '2026-10-01T00:00:00.000Z',
      filters: { from: '2026-09-01', to: '2026-09-30', timeZone: 'Africa/Lusaka' },
      scope: { kind: 'insurer', insurerId: 'insurer-id' }, owner: { organization: 'insurer', insurerId: 'insurer-id' },
      privacy: 'aggregate-only', limitations: ['DEC-013 pending'],
      metrics: [{ key: 'amount', label: '=SUM(A1)', value: '9007199254740993', unit: 'minorUnits', currency: 'ZMW', definition: 'Recorded "amount", only\nNo approval.' }],
    };
    const csv = reportCsv(report);
    expect(csv).toContain('"\'=SUM(A1)"');
    expect(csv).toContain('"9007199254740993"');
    expect(csv).toContain('"Recorded ""amount"", only\nNo approval."');
    expect(csv).toContain('"Africa/Lusaka","insurer","insurer-id","insurer","aggregate-only"');
    expect(csv).toContain('"dataAsOf"');
    expect(csv).toContain('DEC-013 pending');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});
