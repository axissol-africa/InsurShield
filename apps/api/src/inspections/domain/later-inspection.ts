import type { InspectionMethod, InspectionPurpose, InspectionStatus } from '../../common/domain/enums.js';

export const LATER_INSPECTION_PHOTO_SLOTS = ['front', 'rear', 'left', 'right', 'dashboard', 'engine_bay'] as const;
export type LaterInspectionPhotoSlot = (typeof LATER_INSPECTION_PHOTO_SLOTS)[number];
export type LaterInspectionPurpose = 'AFTER_PAYMENT' | 'CLAIM_ASSESSMENT';

export const isLaterInspection = (purpose: InspectionPurpose): purpose is LaterInspectionPurpose =>
  purpose === 'AFTER_PAYMENT' || purpose === 'CLAIM_ASSESSMENT';

const PHOTO_STATUSES: readonly InspectionStatus[] = ['REQUESTED', 'SCHEDULED', 'INSPECTOR_ASSIGNED', 'IN_PROGRESS', 'COMPLETED'];

export const acceptsEvidence = (status: InspectionStatus): boolean => PHOTO_STATUSES.includes(status);

export function missingReportEvidence(
  method: InspectionMethod | null,
  status: InspectionStatus,
  slots: readonly string[],
): 'BOOKING' | 'PHOTOS' | 'CLOSED' | null {
  if (!acceptsEvidence(status)) return 'CLOSED';
  if (method === 'PHYSICAL' && status === 'REQUESTED') return 'BOOKING';
  if (method === 'SELF_CAPTURE' && LATER_INSPECTION_PHOTO_SLOTS.some((slot) => !slots.includes(slot))) return 'PHOTOS';
  return null;
}
