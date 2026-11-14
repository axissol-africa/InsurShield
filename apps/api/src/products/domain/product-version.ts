import type { InspectionMethod, InspectionRule, InspectionTiming, ProductVersionStatus } from '../../common/domain/enums.js';

export function inspectionErrors(rule: InspectionRule, timing: InspectionTiming | null, method: InspectionMethod | null): Record<string, string> {
  if (rule === 'NOT_REQUIRED') {
    return timing === null && method === null ? {} : { inspection: 'A product with no inspection requirement cannot set a timing or method.' };
  }
  return timing && method ? {} : { inspection: 'Choose both an inspection timing and method when an inspection is optional or required.' };
}

export function canEditProductVersion(status: ProductVersionStatus): boolean {
  return status === 'DRAFT';
}

export function canSubmitProductVersion(status: ProductVersionStatus): boolean {
  return status === 'DRAFT';
}

export function canApproveProductVersion(status: ProductVersionStatus): boolean {
  return status === 'SUBMITTED';
}

export function canWithdrawProductVersion(status: ProductVersionStatus): boolean {
  return status === 'APPROVED';
}

export const asDay = (value: Date | null) => (value === null ? null : value.toISOString().slice(0, 10));
export const calendarDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
