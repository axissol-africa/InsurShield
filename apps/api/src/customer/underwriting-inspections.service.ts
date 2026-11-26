import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service.js';
import type { AuditActor } from '../common/audit/audit.types.js';
import type { InspectionMethod, InspectionStatus, InspectionTiming } from '../common/domain/enums.js';
import { newReference } from '../common/domain/reference.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import {
  isOpenInspection,
  nextInspectionStatus,
  planInspections,
  type InspectedProduct,
  type InspectionEvent,
} from '../inspections/domain/underwriting.js';
import { isOpenStatus } from './domain/quote-workflow.js';
import { QuoteProductsRepository } from './quote-products.repository.js';
import { customerDate } from './quote-workflow.service.js';
import { UnderwritingInspectionsRepository } from './underwriting-inspections.repository.js';

const SYSTEM: AuditActor = { type: 'SYSTEM', id: null };

type Inspection = NonNullable<Awaited<ReturnType<UnderwritingInspectionsRepository['lockForInsurer']>>>;

export interface InspectionAction {
  scheduledDate?: Date;
  location?: string;
  inspectorName?: string;
  inspectorPhone?: string;
  reason?: string;
}

const EVENT_NOTES: Record<InspectionEvent, string> = {
  SCHEDULE: 'Inspection booked.',
  ASSIGN: 'Inspector assigned.',
  APPROVE: 'Inspection passed.',
  FAIL: 'Inspection failed.',
  NO_SHOW: 'The vehicle was not presented.',
  CANCEL: 'Inspection cancelled.',
};

/**
 * Optional inspections. The live photos taken in the journey are enough under
 * normal circumstances, so an inspection never holds up a quote or a
 * purchase. One is opened at submit for the products whose terms ask for it,
 * for the insurer to book and record if it wants; a missed or cancelled
 * appointment is booked again, and a result is kept for the insurer's own
 * decision.
 */
@Injectable()
export class UnderwritingInspectionsService {
  constructor(
    private readonly inspections: UnderwritingInspectionsRepository,
    private readonly versions: QuoteProductsRepository,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Opens the inspections a new request's chosen products need, one per insurer. */
  async openForRequest(
    tx: Transaction,
    request: { id: string; customerId: string; vehiclePlate: string; vehicleLabel: string; submittedAt: Date },
    products: readonly InspectedProduct[],
    actor: AuditActor,
  ): Promise<void> {
    for (const planned of planInspections(products)) {
      await this.open(tx, {
        request,
        insurerId: planned.insurerId,
        method: planned.method,
        stage: planned.stage,
        productVersionIds: planned.productVersionIds,
        predecessorId: null,
        at: request.submittedAt,
        actor,
      });
    }
  }

  private async open(
    tx: Transaction,
    input: {
      request: { id: string; customerId: string; vehiclePlate: string; vehicleLabel: string };
      insurerId: string;
      method: InspectionMethod;
      stage: InspectionTiming;
      productVersionIds: string[];
      predecessorId: string | null;
      at: Date;
      actor: AuditActor;
    },
  ) {
    const created = await this.inspections.insert(
      tx,
      {
        id: newReference('INS', input.at, randomInt),
        purpose: 'UNDERWRITING',
        status: 'REQUESTED',
        customerId: input.request.customerId,
        insurerId: input.insurerId,
        quoteRequestId: input.request.id,
        vehiclePlate: input.request.vehiclePlate,
        vehicleLabel: input.request.vehicleLabel,
        method: input.method,
        stage: input.stage,
        predecessorId: input.predecessorId,
      },
      input.productVersionIds.map((productVersionId) => ({
        quoteRequestId: input.request.id,
        productVersionId,
        stage: input.stage,
      })),
    );
    await this.audit.transition(tx, {
      actor: input.actor,
      entityType: 'INSPECTION',
      entityId: created.id,
      fromStatus: null,
      toStatus: 'REQUESTED',
      note: input.predecessorId
        ? `A new inspection replaces ${input.predecessorId}.`
        : 'Optional inspection opened for the products whose terms ask for one.',
      correlationId: input.request.id,
    });
    return created;
  }

  /** An insurer acts on one of its inspections. A foreign id answers as absent. */
  async act(
    tx: Transaction,
    insurerId: string,
    actor: AuditActor,
    staffId: string,
    id: string,
    event: InspectionEvent,
    input: InspectionAction,
    scope?: (inspection: Inspection) => boolean,
  ): Promise<Inspection | null> {
    const inspection = await this.inspections.lockForInsurer(tx, id, insurerId);
    if (!inspection || (scope && !scope(inspection))) return null;
    const later = inspection.purpose === 'AFTER_PAYMENT' || inspection.purpose === 'CLAIM_ASSESSMENT';
    if (later && event === 'APPROVE' && isOpenInspection(inspection.status) && inspection.status !== 'REPORT_READY') {
      throw ApiException.conflict('INSPECTION_NOT_READY', 'Publish the inspection report before approving this inspection.');
    }
    const to = nextInspectionStatus(inspection.status, inspection.method, event);
    if (!to) {
      throw ApiException.conflict(
        isOpenInspection(inspection.status) ? 'INSPECTION_NOT_READY' : 'INSPECTION_CLOSED',
        isOpenInspection(inspection.status)
          ? 'Book the inspection before recording that step.'
          : 'This inspection is finished. Any further inspection is a new one.',
      );
    }
    const at = new Date();
    const decided = event === 'APPROVE' || event === 'FAIL';
    const patch = {
      ...(event === 'SCHEDULE' && { scheduledDate: input.scheduledDate, location: input.location ?? null }),
      ...(event === 'ASSIGN' && { inspectorName: input.inspectorName, inspectorPhone: input.inspectorPhone ?? null }),
      ...(decided && {
        result: event === 'APPROVE' ? ('PASSED' as const) : ('FAILED' as const),
        decidedAt: at,
        decidedByStaffId: staffId,
      }),
      ...((event === 'FAIL' || event === 'CANCEL' || event === 'NO_SHOW') && { resultReason: input.reason ?? null }),
    };
    if (!(await this.inspections.move(tx, id, inspection.status, to, patch))) {
      throw ApiException.conflict('INSPECTION_CHANGED', 'This inspection changed while you were working on it. Reload and try again.');
    }
    await this.audit.transition(tx, {
      actor,
      entityType: 'INSPECTION',
      entityId: id,
      fromStatus: inspection.status,
      toStatus: to,
      note: EVENT_NOTES[event],
      correlationId: inspection.quoteRequestId ?? id,
    });
    const after = { ...inspection, ...patch, status: to as InspectionStatus };

    if (inspection.purpose === 'UNDERWRITING' && inspection.quoteRequestId) {
      if (event === 'APPROVE') await this.passed(tx, after);
      if (event === 'FAIL') await this.failed(tx, after);
      if (event === 'NO_SHOW' || event === 'CANCEL') await this.rebook(tx, after, actor, at, false);
    }
    await this.tell(tx, after, event);
    return after;
  }

  /** A pass is recorded on the products it served; nothing was waiting for it. */
  private async passed(tx: Transaction, inspection: Inspection) {
    await this.inspections.closeLinks(tx, inspection.id, true);
  }

  /**
   * A fail is recorded for the insurer to act on. Inspections are optional and
   * never decide a purchase by themselves: the insurer declines the product
   * through the normal decline action if it wants to.
   */
  private async failed(tx: Transaction, inspection: Inspection) {
    await this.inspections.closeLinks(tx, inspection.id, false);
  }

  /** A missed or cancelled appointment is booked again for the products still waiting on it. */
  private async rebook(tx: Transaction, inspection: Inspection, actor: AuditActor, at: Date, suspended: boolean) {
    await this.inspections.closeLinks(tx, inspection.id, false);
    if (suspended) return;
    const waiting: string[] = [];
    for (const link of await this.inspections.linksOf(tx, inspection.id)) {
      const version = await this.versions.lock(tx, link.quoteRequestId, link.productVersionId, { insurerId: inspection.insurerId! });
      if (version && (isOpenStatus(version.status) || version.status === 'QUOTED')) waiting.push(link.productVersionId);
    }
    if (waiting.length > 0) await this.successor(tx, inspection, waiting, actor, at);
  }

  private async successor(tx: Transaction, inspection: Inspection, productVersionIds: string[], actor: AuditActor, at: Date) {
    const next = await this.open(tx, {
      request: {
        id: inspection.quoteRequestId!,
        customerId: inspection.customerId,
        vehiclePlate: inspection.vehiclePlate,
        vehicleLabel: inspection.vehicleLabel,
      },
      insurerId: inspection.insurerId!,
      method: inspection.method!,
      stage: inspection.stage!,
      productVersionIds,
      predecessorId: inspection.id,
      at,
      actor,
    });
    await this.notifications.notify(tx, {
      customerId: inspection.customerId,
      key: 'inspection.rebooked',
      entity: { type: 'INSPECTION', id: next.id },
      values: { vehicle: inspection.vehiclePlate },
    });
  }

  private async tell(tx: Transaction, inspection: Inspection, event: InspectionEvent) {
    const key = { SCHEDULE: 'inspection.scheduled', APPROVE: 'inspection.approved', FAIL: 'inspection.failed' }[
      event as 'SCHEDULE' | 'APPROVE' | 'FAIL'
    ];
    if (!key) return;
    await this.notifications.notify(tx, {
      customerId: inspection.customerId,
      key,
      entity: { type: 'INSPECTION', id: inspection.id },
      values: {
        vehicle: inspection.vehiclePlate,
        date: inspection.scheduledDate ? customerDate(inspection.scheduledDate) : '',
      },
    });
  }

  /** Decision 24: the suspended insurer's open inspections are cancelled and none is booked again. */
  async cancelForSuspendedInsurer(tx: Transaction, insurerId: string, at: Date): Promise<void> {
    for (const inspection of await this.inspections.openForInsurer(tx, insurerId)) {
      await this.inspections.move(tx, inspection.id, inspection.status, 'CANCELLED', { resultReason: 'The insurer became unavailable.' });
      await this.audit.transition(tx, {
        actor: SYSTEM,
        entityType: 'INSPECTION',
        entityId: inspection.id,
        fromStatus: inspection.status,
        toStatus: 'CANCELLED',
        note: 'The insurer became unavailable.',
        correlationId: inspection.quoteRequestId ?? inspection.id,
      });
      await this.rebook(tx, inspection, SYSTEM, at, true);
    }
  }
}
