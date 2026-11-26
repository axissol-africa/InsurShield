import { claimCoverType, claimResponseDay, claimTypeMatches, coveredOnIncidentDay, reportingDaysSince } from './claim-intake.js';

const start = new Date('2026-10-01T00:00:00Z');
const end = new Date('2026-10-31T00:00:00Z');
const active = {
  status: 'ACTIVE' as const, issuedAt: start, policyStartDate: start, policyEndDate: end,
  cancelledAt: null, cancellationDay: null,
};

it('counts reporting days at Lusaka midnight and includes the final reporting day', () => {
  expect(reportingDaysSince('2026-10-01', new Date('2026-10-15T21:59:00Z'))).toBe(14);
  expect(reportingDaysSince('2026-10-01', new Date('2026-10-15T22:00:00Z'))).toBe(15);
  expect(claimResponseDay(new Date('2026-10-28T22:00:00Z'), 7)).toBe('2026-11-05');
});

it('checks issued cover on the inclusive range and applies an earlier cancellation', () => {
  expect(coveredOnIncidentDay(active, '2026-09-30')).toBe(false);
  expect(coveredOnIncidentDay(active, '2026-10-01')).toBe(true);
  expect(coveredOnIncidentDay(active, '2026-10-31')).toBe(true);
  expect(coveredOnIncidentDay(active, '2026-11-01')).toBe(false);
  expect(coveredOnIncidentDay({ ...active, status: 'AWAITING_INSURER_CERTIFICATE' }, '2026-10-15')).toBe(false);
  const cancelled = { ...active, status: 'CANCELLED' as const, cancellationDay: '2026-10-12' };
  expect(coveredOnIncidentDay(cancelled, '2026-10-11')).toBe(true);
  expect(coveredOnIncidentDay(cancelled, '2026-10-12')).toBe(false);
});

it('normalizes the stored cover label and configured claim type names', () => {
  expect(claimCoverType('Third-party')).toBe('THIRD_PARTY');
  expect(claimCoverType('Other')).toBe(null);
  expect(claimTypeMatches(['Theft'], ' THEFT ')).toBe(true);
});
