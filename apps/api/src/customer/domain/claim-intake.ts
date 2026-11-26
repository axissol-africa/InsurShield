import type { InsuranceType, PolicyStatus } from '../../common/domain/enums.js';
import { lusakaDay } from '../../common/domain/lusaka.js';
import { MS_PER_DAY } from './cover-period.js';

interface ClaimCover {
  status: PolicyStatus;
  issuedAt: Date | null;
  policyStartDate: Date | null;
  policyEndDate: Date | null;
  cancelledAt: Date | null;
  cancellationDay: string | null;
}

export const claimTypeMatches = (types: readonly string[], submittedType: string): boolean =>
  types.some((type) => type.toLowerCase() === submittedType.trim().toLowerCase());

export function claimCoverType(coverage: string): InsuranceType | null {
  const label = coverage.trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (label === 'comprehensive') return 'COMPREHENSIVE';
  if (label === 'third party') return 'THIRD_PARTY';
  return null;
}

export function reportingDaysSince(day: string, now: Date): number {
  return (Date.parse(lusakaDay(now)) - Date.parse(day)) / MS_PER_DAY;
}

export function claimResponseDay(now: Date, responseDays: number): string {
  return new Date(Date.parse(lusakaDay(now)) + responseDays * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Cover dates are inclusive unless an approved cancellation has already taken effect. */
export function coveredOnIncidentDay(cover: ClaimCover, incidentDay: string): boolean {
  const issued = cover.status === 'ACTIVE' || (cover.status === 'CANCELLED' && cover.issuedAt !== null);
  if (!issued || !cover.policyStartDate || !cover.policyEndDate) return false;
  if (incidentDay < lusakaDay(cover.policyStartDate) || incidentDay > lusakaDay(cover.policyEndDate)) return false;
  if (cover.status !== 'CANCELLED') return true;
  const cancellationDay = cover.cancellationDay ?? (cover.cancelledAt ? lusakaDay(cover.cancelledAt) : null);
  return cancellationDay !== null && incidentDay < cancellationDay;
}
