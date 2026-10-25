import { toContract } from '../../common/contract.js';
import type { DocumentRecord } from '../../documents/documents.service.js';
import type { InspectionWithInsurer } from '../inspections.repository.js';

export interface InspectionPhotoResponse {
  slot: string;
  document: DocumentRecord;
}

export function toInspectionResponse(inspection: InspectionWithInsurer, photos: InspectionPhotoResponse[]) {
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
  };
}
