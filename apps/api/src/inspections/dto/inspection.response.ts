import { toContract } from '../../common/contract.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { InspectionWithInsurer } from '../inspections.repository.js';
import { isLaterInspection, LATER_INSPECTION_PHOTO_SLOTS } from '../domain/later-inspection.js';

export interface InspectionPhotoResponse {
  slot: string;
  document: DocumentRecord;
}

export interface InspectedProductResponse {
  productName: string;
  passed: boolean;
}

export function toInspectionResponse(
  inspection: InspectionWithInsurer,
  photos: InspectionPhotoResponse[],
  products: InspectedProductResponse[] = [],
  report: DocumentRecord | null = null,
) {
  return {
    id: inspection.id,
    status: toContract.inspectionStatus(inspection.status),
    insurer: inspection.insurerName,
    vehiclePlate: inspection.vehiclePlate,
    vehicleLabel: inspection.vehicleLabel,
    preferredDate: inspection.preferredDate?.toISOString() ?? null,
    preferredTime: inspection.preferredTime,
    preferredLocation: inspection.preferredLocation,
    scheduledDate: inspection.scheduledDate?.toISOString() ?? null,
    inspectorName: inspection.inspectorName,
    inspectorPhone: inspection.inspectorPhone,
    location: inspection.location,
    notes: inspection.notes,
    createdAt: inspection.createdAt.toISOString(),
    photos,
    // Batch 13: an inspection a chosen product needs, and what it decided.
    purpose: inspection.purpose,
    method: inspection.method,
    stage: inspection.stage,
    quoteRequestId: inspection.quoteRequestId,
    result: inspection.result,
    resultReason: inspection.resultReason,
    products,
    ...(isLaterInspection(inspection.purpose) && {
      policyNumber: inspection.policyNumber,
      claimNumber: inspection.claimNumber,
      predecessorId: inspection.predecessorId,
      requiredPhotoSlots: inspection.method === 'SELF_CAPTURE' ? LATER_INSPECTION_PHOTO_SLOTS : [],
      report,
    }),
  };
}
