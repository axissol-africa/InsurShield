import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DocumentsService } from '../documents/documents.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { toContract } from '../common/contract.js';
import { InspectionStatus, InsurerStatus } from '../generated/prisma/enums.js';
import type { RequestInspectionDto, UpdateInspectionDto } from '../customer/dto/customer.dto.js';

/** Once an inspector is on the job the appointment is no longer the customer's to move. */
const CUSTOMER_EDITABLE: InspectionStatus[] = [
  InspectionStatus.REQUESTED,
  InspectionStatus.SCHEDULED,
];

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
    private readonly prisma: PrismaService,
    private readonly documents: DocumentsService,
  ) {}

  async list(customerId: string) {
    const inspections = await this.prisma.inspection.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
      include: { insurer: { select: { name: true } }, photos: { select: { slot: true, documentId: true } } },
    });
    return Promise.all(inspections.map((inspection) => this.serialise(inspection)));
  }

  async request(customerId: string, dto: RequestInspectionDto) {
    if (dto.insurerId) {
      const insurer = await this.prisma.insurer.findFirst({
        where: { id: dto.insurerId, status: InsurerStatus.ACTIVE },
        select: { id: true },
      });
      if (!insurer) throw ApiException.notFound('Insurer', dto.insurerId);
    }

    const inspection = await this.prisma.inspection.create({
      data: {
        id: newReference(),
        customerId,
        insurerId: dto.insurerId ?? null,
        vehiclePlate: dto.vehiclePlate.trim(),
        vehicleLabel: dto.vehicleLabel.trim(),
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : null,
        preferredTime: dto.preferredTime?.trim() ?? null,
        preferredLocation: dto.preferredLocation?.trim() ?? null,
        notes: dto.notes?.trim() ?? null,
      },
      include: { insurer: { select: { name: true } }, photos: { select: { slot: true, documentId: true } } },
    });

    this.logger.log(`Inspection ${inspection.id} requested for ${inspection.vehiclePlate}`);
    return this.serialise(inspection);
  }

  /**
   * Changes the customer's own preferences. Status, inspector and schedule
   * belong to whoever is carrying the inspection out, so they are not editable
   * from here — and once that work has started, neither are the preferences.
   */
  async update(customerId: string, id: string, dto: UpdateInspectionDto) {
    const inspection = await this.prisma.inspection.findFirst({ where: { id, customerId } });
    if (!inspection) throw ApiException.notFound('Inspection', id);

    if (!CUSTOMER_EDITABLE.includes(inspection.status)) {
      throw ApiException.conflict(
        'INSPECTION_IN_PROGRESS',
        `This inspection is ${toContract.inspectionStatus(inspection.status).toLowerCase()}. Contact your insurer to change it.`,
      );
    }

    const updated = await this.prisma.inspection.update({
      where: { id },
      data: {
        preferredDate: dto.preferredDate ? new Date(dto.preferredDate) : inspection.preferredDate,
        preferredTime: dto.preferredTime?.trim() ?? inspection.preferredTime,
        preferredLocation: dto.preferredLocation?.trim() ?? inspection.preferredLocation,
        notes: dto.notes?.trim() ?? inspection.notes,
      },
      include: { insurer: { select: { name: true } }, photos: { select: { slot: true, documentId: true } } },
    });

    return this.serialise(updated);
  }

  private async serialise(
    inspection: Awaited<ReturnType<InspectionsService['loadRow']>>,
  ) {
    return {
      id: inspection.id,
      status: toContract.inspectionStatus(inspection.status),
      insurer: inspection.insurer?.name ?? null,
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
      photos: await Promise.all(
        inspection.photos.map(async (photo) => ({
          slot: photo.slot,
          document: await this.documents.record(photo.documentId),
        })),
      ),
    };
  }

  private loadRow(id: string, customerId: string) {
    return this.prisma.inspection.findFirstOrThrow({
      where: { id, customerId },
      include: { insurer: { select: { name: true } }, photos: { select: { slot: true, documentId: true } } },
    });
  }
}
