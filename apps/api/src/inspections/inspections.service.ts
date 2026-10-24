import { Injectable, Logger } from '@nestjs/common';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { toContract } from '../common/contract.js';
import type { RequestInspectionDto, UpdateInspectionDto } from '../customer/dto/customer.dto.js';
import { isCustomerEditable } from './domain/inspection.js';
import { toInspectionResponse, type InspectionPhotoResponse } from './dto/inspection.response.js';
import { InspectionsRepository, type PhotoRow } from './inspections.repository.js';

const newReference = () =>
  `INS-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

/**
 * Scheduled vehicle inspections.
 *
 * Distinct from the seven self-capture photos attached to a quote request:
 * this is the appointment an insurer asks for when it wants the vehicle seen
 * in person, and the customer can follow it here.
 */
@Injectable()
export class InspectionsService {
  private readonly logger = new Logger(InspectionsService.name);

  constructor(
    private readonly repository: InspectionsRepository,
    private readonly documents: DocumentsService,
  ) {}

  async list(customerId: string) {
    const inspections = await this.repository.listForCustomer(customerId);
    const photos = await this.repository.photosOf(inspections.map((inspection) => inspection.id));
    return Promise.all(
      inspections.map(async (inspection) =>
        toInspectionResponse(
          inspection,
          await this.photoRecords(photos.filter((photo) => photo.inspectionId === inspection.id)),
        ),
      ),
    );
  }

  async request(customerId: string, dto: RequestInspectionDto) {
    const inspection = await this.repository.transaction(async (tx) => {
      let insurerName: string | null = null;
      if (dto.insurerId) {
        const insurer = await this.repository.findActiveInsurer(tx, dto.insurerId);
        if (!insurer) throw ApiException.notFound('Insurer', dto.insurerId);
        insurerName = insurer.name;
      }

      const created = await this.repository.insert(tx, {
        id: newReference(),
        customerId,
        insurerId: dto.insurerId ?? null,
        vehiclePlate: dto.vehiclePlate.trim(),
        vehicleLabel: dto.vehicleLabel.trim(),
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : null,
        preferredTime: dto.preferredTime?.trim() ?? null,
        preferredLocation: dto.preferredLocation?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
      });
      return { ...created, insurerName };
    });

    this.logger.log(`Inspection ${inspection.id} requested for ${inspection.vehiclePlate}`);
    return toInspectionResponse(inspection, []);
  }

  /**
   * Changes the customer's own preferences. Status, inspector and schedule
   * belong to whoever is carrying the inspection out, so they are not editable
   * from here — and once that work has started, neither are the preferences.
   */
  async update(customerId: string, id: string, dto: UpdateInspectionDto) {
    // Read before the write, so nothing after its commit can fail; nothing in the API changes photos.
    const photos = await this.photoRecords(await this.repository.photosOfOwned(customerId, id));

    const updated = await this.repository.transaction(async (tx) => {
      const inspection = await this.repository.lockOwned(tx, id, customerId);
      if (!inspection) throw ApiException.notFound('Inspection', id);

      if (!isCustomerEditable(inspection.status)) {
        throw ApiException.conflict(
          'INSPECTION_IN_PROGRESS',
          `This inspection is ${toContract.inspectionStatus(inspection.status).toLowerCase()}. Contact your insurer to change it.`,
        );
      }

      const changed = await this.repository.updatePreferences(tx, id, {
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : inspection.preferredDate,
        preferredTime: dto.preferredTime?.trim() ?? inspection.preferredTime,
        preferredLocation: dto.preferredLocation?.trim() ?? inspection.preferredLocation,
        notes: dto.notes?.trim() ?? inspection.notes,
      });
      return { ...changed, insurerName: inspection.insurerName };
    });

    return toInspectionResponse(updated, photos);
  }

  private photoRecords(photos: PhotoRow[]): Promise<InspectionPhotoResponse[]> {
    return Promise.all(
      photos.map(async (photo) => ({ slot: photo.slot, document: await this.documents.record(photo.documentId) })),
    );
  }
}
