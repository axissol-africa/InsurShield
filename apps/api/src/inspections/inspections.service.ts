import { Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { toContract } from '../common/contract.js';
import { newReference } from '../common/domain/reference.js';
import type { RequestInspectionDto, UpdateInspectionDto } from '../customer/dto/customer.dto.js';
import { isCustomerEditable } from './domain/inspection.js';
import { toInspectionResponse, type InspectionPhotoResponse } from './dto/inspection.response.js';
import { InspectionsRepository, type PhotoRow } from './inspections.repository.js';
import type { CustomerPrincipal } from '../customer/customer-principal.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';

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
    private readonly audit: AuditService,
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

  async request(customer: CustomerPrincipal, dto: RequestInspectionDto) {
    const requestedAt = new Date();
    const inspection = await this.repository.transaction(async (tx) => {
      let insurerName: string | null = null;
      if (dto.insurerId) {
        const insurer = await this.repository.findInsurerTakingNewBusiness(tx, dto.insurerId, requestedAt);
        if (!insurer) throw ApiException.notFound('Insurer', dto.insurerId);
        insurerName = insurer.name;
      }

      const created = await this.repository.insert(tx, {
        id: newReference('INS', requestedAt, randomInt),
        customerId: customer.id,
        insurerId: dto.insurerId ?? null,
        vehiclePlate: dto.vehiclePlate.trim(),
        vehicleLabel: dto.vehicleLabel.trim(),
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : null,
        preferredTime: dto.preferredTime?.trim() ?? null,
        preferredLocation: dto.preferredLocation?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
      });
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'inspection.requested',
        entityType: 'INSPECTION',
        entityId: created.id,
        after: { insurerId: created.insurerId, hasPreferredDate: Boolean(created.preferredDate), hasPreferredLocation: Boolean(created.preferredLocation) },
        note: 'Customer requested a vehicle inspection.',
        correlationId: created.id,
      });
      await this.audit.transition(tx, {
        actor: auditActor(customer),
        entityType: 'INSPECTION',
        entityId: created.id,
        fromStatus: null,
        toStatus: created.status,
        note: 'Inspection requested.',
        correlationId: created.id,
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
  async update(customer: CustomerPrincipal, id: string, dto: UpdateInspectionDto) {
    // Read before the write, so nothing after its commit can fail; nothing in the API changes photos.
    const photos = await this.photoRecords(await this.repository.photosOfOwned(customer.id, id));

    const updated = await this.repository.transaction(async (tx) => {
      const inspection = await this.repository.lockOwned(tx, id, customer.id);
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
      await this.audit.write(tx, {
        actor: auditActor(customer),
        action: 'inspection.preferences_updated',
        entityType: 'INSPECTION',
        entityId: changed.id,
        before: {
          hasPreferredDate: Boolean(inspection.preferredDate),
          hasPreferredTime: Boolean(inspection.preferredTime),
          hasPreferredLocation: Boolean(inspection.preferredLocation),
          hasNotes: Boolean(inspection.notes),
        },
        after: {
          hasPreferredDate: Boolean(changed.preferredDate),
          hasPreferredTime: Boolean(changed.preferredTime),
          hasPreferredLocation: Boolean(changed.preferredLocation),
          hasNotes: Boolean(changed.notes),
        },
        note: 'Customer updated inspection preferences.',
        correlationId: changed.id,
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
