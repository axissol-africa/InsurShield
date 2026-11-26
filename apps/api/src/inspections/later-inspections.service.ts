import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor, type AuditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { toContract } from '../common/contract.js';
import type { ClaimStatus, InspectionMethod, InspectionStatus } from '../common/domain/enums.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { newReference } from '../common/domain/reference.js';
import { ApiException } from '../common/errors/api.exception.js';
import { assertOpenCustomer } from '../db/customer-lock.js';
import type { Transaction } from '../db/database.module.js';
import { DocumentsService } from '../documents/documents.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { acceptsEvidence, missingReportEvidence, type LaterInspectionPhotoSlot, type LaterInspectionPurpose } from './domain/later-inspection.js';
import type { InspectionRow } from './inspections.repository.js';
import { LaterInspectionsRepository } from './later-inspections.repository.js';

type Staff = Extract<Principal, { kind: 'staff' }>;
type LaterPhoto = { slot: LaterInspectionPhotoSlot; documentId: string };
type EvidenceRow = { slot: string; documentId: string; reference: string };

const PROVIDER: AuditActor = { type: 'SYSTEM', id: null };
const ASSESSABLE: readonly ClaimStatus[] = ['RECEIVED_BY_INSURER', 'UNDER_REVIEW', 'EVIDENCE_REQUIRED'];
const REINSPECTABLE: readonly InspectionStatus[] = ['FAILED', 'CANCELLED', 'NO_SHOW'];
const PHOTO_TYPES = ['image/jpeg', 'image/png'] as const;

function state(row: Pick<InspectionRow, 'id' | 'status'>) {
  return { id: row.id, status: row.status, statusLabel: toContract.inspectionStatus(row.status) };
}

@Injectable()
export class LaterInspectionsService {
  constructor(
    private readonly inspections: LaterInspectionsRepository,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Called inside confirmation's transaction, after the one policy for this payment has been inserted. */
  async openAfterPayment(tx: Transaction, policyNumber: string, at: Date, correlationId: string): Promise<void> {
    const purchase = await this.inspections.purchase(tx, policyNumber);
    if (!purchase) return;
    const { selected, policy, vehicle } = purchase;
    if (selected.inspectionTiming !== 'AFTER_PAYMENT' || selected.inspectionRule !== 'REQUIRED' || !selected.inspectionMethod) return;
    if (await this.inspections.findPaidRoot(tx, policyNumber)) return;
    await this.open(tx, {
      insurerId: policy.insurerId, customerId: policy.customerId, policyNumber, claimNumber: null,
      vehiclePlate: vehicle.plateNumber, vehicleLabel: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' '),
      method: selected.inspectionMethod, purpose: 'AFTER_PAYMENT', predecessorId: null,
    }, PROVIDER, at, correlationId);
  }

  async startClaim(principal: Principal, claimNumber: string, method: InspectionMethod) {
    const staff = this.staff(principal);
    if (!holds(staff, 'portal:claim:update')) throw ApiException.forbidden();
    return this.inspections.transaction(async (tx) => {
      const observed = await this.inspections.claim(tx, claimNumber, staff.insurerId);
      if (!observed?.claim.customerId) throw ApiException.notFound('Claim', claimNumber);
      await assertOpenCustomer(tx, observed.claim.customerId);
      await this.assertServicing(tx, staff.insurerId);
      const record = await this.inspections.claim(tx, claimNumber, staff.insurerId, true);
      if (!record || record.claim.customerId !== observed.claim.customerId) throw ApiException.notFound('Claim', claimNumber);
      this.assertClaimOpen(record.claim.status);

      const open = await this.inspections.findOpenForClaim(tx, claimNumber);
      if (open) {
        if (open.method !== method) throw ApiException.conflict('INSPECTION_ALREADY_OPEN', 'This claim already has an open inspection.');
        return state(open);
      }
      if (await this.inspections.hasClaimInspection(tx, claimNumber)) {
        throw ApiException.conflict('INSPECTION_REINSPECTION_REQUIRED', 'Use the existing inspection to request a new attempt.');
      }
      const { claim, policy, vehicle } = record;
      return state(await this.open(tx, {
        insurerId: staff.insurerId, customerId: observed.claim.customerId, policyNumber: policy.policyNumber,
        claimNumber: claim.claimNumber, vehiclePlate: vehicle.plateNumber,
        vehicleLabel: [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' '),
        method, purpose: 'CLAIM_ASSESSMENT', predecessorId: null,
      }, auditActor(staff), new Date(), claimNumber));
    });
  }

  addCustomerEvidence(principal: Extract<Principal, { kind: 'customer' }>, id: string, photos: LaterPhoto[]) {
    return this.addEvidence(principal, id, photos);
  }

  addInsurerEvidence(principal: Principal, id: string, photos: LaterPhoto[]) {
    return this.addEvidence(this.staff(principal), id, photos);
  }

  async insurerEvidence(principal: Principal, id: string) {
    const staff = this.staff(principal);
    const records = await this.inspections.transaction(async (tx) => {
      const inspection = await this.inspections.find(tx, id, { insurerId: staff.insurerId });
      if (!inspection || !this.hasScope(staff, inspection, false)) throw ApiException.notFound('Inspection', id);
      let before: EvidenceRow[] = [];
      if (inspection.claimNumber && inspection.policyNumber) {
        const claim = await this.inspections.claim(tx, inspection.claimNumber, staff.insurerId);
        if (!claim || claim.claim.customerId !== inspection.customerId || claim.policy.policyNumber !== inspection.policyNumber) {
          throw ApiException.notFound('Inspection', id);
        }
        before = await this.inspections.preLoss(tx, inspection.policyNumber, staff.insurerId, inspection.customerId, lusakaDay(claim.claim.incidentDate));
      }
      const current = await this.inspections.photos(tx, id);
      const report = await this.inspections.report(tx, id);
      return { before, current, report };
    });
    return {
      preLoss: await this.records(records.before),
      postLoss: await this.records(records.current),
      report: records.report ? await this.documents.record(records.report.documentId) : null,
    };
  }

  async submitReport(principal: Principal, id: string, documentId: string) {
    const staff = this.staff(principal);
    return this.inspections.transaction(async (tx) => {
      const inspection = await this.lockForWrite(tx, staff, id);
      const existing = await this.inspections.report(tx, id);
      if (existing?.documentId === documentId.toLowerCase()) return state(inspection);
      if (existing) throw ApiException.conflict('INSPECTION_REPORT_PUBLISHED', 'This report is published. A new inspection keeps the original report in the history.');
      const photos = await this.inspections.photos(tx, id);
      const refusal = missingReportEvidence(inspection.method, inspection.status, photos.map(({ slot }) => slot));
      if (refusal === 'BOOKING') throw ApiException.conflict('INSPECTION_NOT_READY', 'Book the physical inspection before publishing a report.');
      if (refusal === 'PHOTOS') throw ApiException.conflict('INSPECTION_EVIDENCE_INCOMPLETE', 'Complete all required photo views before publishing a report.');
      if (refusal === 'CLOSED') throw ApiException.conflict('INSPECTION_CLOSED', 'This inspection is finished.');
      await this.documents.assertAttachable(tx, staff, [documentId],
        inspection.claimNumber ? 'CLAIM_ATTACHMENT' : 'INSPECTION_REPORT', { requireClean: true });
      const moved = await this.inspections.publishReport(tx, id, documentId);
      const reference = inspection.claimNumber ?? inspection.policyNumber ?? id;
      await this.audit.transition(tx, {
        actor: auditActor(staff), entityType: 'INSPECTION', entityId: id, fromStatus: inspection.status,
        toStatus: moved.status, note: 'Inspection report published.', correlationId: reference,
      });
      await this.notifications.notify(tx, {
        customerId: inspection.customerId, key: 'inspection.report_ready', entity: { type: 'INSPECTION', id },
        values: { reference },
      });
      return state(moved);
    });
  }

  async reinspect(principal: Principal, id: string) {
    const staff = this.staff(principal);
    return this.inspections.transaction(async (tx) => {
      const previous = await this.lockForWrite(tx, staff, id);
      const successor = await this.inspections.successor(tx, id);
      if (successor) return state(successor);
      if (!REINSPECTABLE.includes(previous.status) || !previous.method || !previous.policyNumber) {
        throw ApiException.conflict('INSPECTION_REINSPECTION_UNAVAILABLE', 'This inspection cannot be repeated.');
      }
      if (previous.status === 'FAILED' && !previous.claimNumber && !(await this.inspections.allowsReinspection(tx, previous.policyNumber))) {
        throw ApiException.conflict('INSPECTION_REINSPECTION_UNAVAILABLE', 'The purchased product does not allow another attempt after a failed inspection.');
      }
      return state(await this.open(tx, {
        insurerId: staff.insurerId, customerId: previous.customerId, policyNumber: previous.policyNumber,
        claimNumber: previous.claimNumber, vehiclePlate: previous.vehiclePlate, vehicleLabel: previous.vehicleLabel,
        method: previous.method, purpose: previous.claimNumber ? 'CLAIM_ASSESSMENT' : 'AFTER_PAYMENT', predecessorId: id,
      }, auditActor(staff), new Date(), previous.claimNumber ?? previous.policyNumber));
    });
  }

  private addEvidence(principal: Principal, id: string, photos: LaterPhoto[]) {
    return this.inspections.transaction(async (tx) => {
      const inspection = await this.lockForWrite(tx, principal, id);
      const current = new Map((await this.inspections.photos(tx, id)).map(({ slot, documentId }) => [slot, documentId]));
      const additions: LaterPhoto[] = [];
      for (const { slot, documentId } of photos) {
        const previous = current.get(slot);
        if (previous === documentId.toLowerCase()) continue;
        if (previous) throw ApiException.conflict('INSPECTION_PHOTO_PUBLISHED', 'This view is already recorded. A new inspection can collect fresh evidence.');
        additions.push({ slot, documentId });
      }
      if (additions.length === 0) return state(inspection);
      if (!acceptsEvidence(inspection.status)) throw ApiException.conflict('INSPECTION_CLOSED', 'This inspection no longer accepts photos.');
      await this.documents.assertAttachable(tx, principal, additions.map((entry) => entry.documentId),
        inspection.claimNumber ? 'CLAIM_ATTACHMENT' : 'INSPECTION_PHOTO', { requireClean: true, mimeTypes: PHOTO_TYPES });
      await this.inspections.addPhotos(tx, id, additions);
      await this.audit.write(tx, {
        actor: auditActor(principal), action: 'inspection.evidence_filed', entityType: 'INSPECTION', entityId: id,
        after: { slots: additions.map(({ slot }) => slot) }, note: 'Inspection photos filed.',
        correlationId: inspection.claimNumber ?? inspection.policyNumber ?? id,
      });
      return state(inspection);
    });
  }

  private async lockForWrite(tx: Transaction, principal: Principal, id: string) {
    const staff = principal.kind === 'staff' ? this.staff(principal) : null;
    const owner = staff ? { insurerId: staff.insurerId } : { customerId: principal.id };
    const observed = await this.inspections.find(tx, id, owner);
    if (!observed || (staff && !this.hasScope(staff, observed, true))) throw ApiException.notFound('Inspection', id);
    await assertOpenCustomer(tx, observed.customerId);
    if (observed.insurerId) await this.assertServicing(tx, observed.insurerId);
    if (observed.claimNumber && observed.insurerId) {
      const claim = await this.inspections.claim(tx, observed.claimNumber, observed.insurerId, true);
      if (!claim || claim.claim.customerId !== observed.customerId || claim.policy.policyNumber !== observed.policyNumber) {
        throw ApiException.notFound('Inspection', id);
      }
      this.assertClaimOpen(claim.claim.status);
    }
    const locked = await this.inspections.find(tx, id, owner, true);
    if (!locked) throw ApiException.notFound('Inspection', id);
    return locked;
  }

  private assertClaimOpen(status: ClaimStatus) {
    if (!ASSESSABLE.includes(status)) throw ApiException.conflict('CLAIM_NOT_ASSESSABLE', 'This claim is outside its assessment stage.');
  }

  private async assertServicing(tx: Transaction, insurerId: string) {
    if (!(await this.inspections.servicingInsurer(tx, insurerId))) throw ApiException.notFound('Insurer', insurerId);
  }

  private staff(principal: Principal): Staff & { insurerId: string } {
    if (principal.kind !== 'staff' || !principal.insurerId) throw ApiException.forbidden();
    return { ...principal, insurerId: principal.insurerId };
  }

  private hasScope(staff: Staff, inspection: InspectionRow, manage: boolean) {
    return inspection.purpose === 'CLAIM_ASSESSMENT'
      ? holds(staff, manage ? 'portal:claim:update' : 'portal:claim:read')
      : holds(staff, manage ? 'portal:quote:send' : 'portal:request:read');
  }

  private async open(tx: Transaction, input: {
    insurerId: string; customerId: string; policyNumber: string; claimNumber: string | null;
    vehiclePlate: string; vehicleLabel: string; method: InspectionMethod; purpose: LaterInspectionPurpose; predecessorId: string | null;
  }, actor: AuditActor, at: Date, correlationId: string) {
    const entry = await this.inspections.insert(tx, {
      ...input, id: newReference('INS', at, randomInt), stage: input.purpose === 'AFTER_PAYMENT' ? 'AFTER_PAYMENT' : null,
    });
    if (!entry) throw ApiException.conflict('INSPECTION_ALREADY_OPEN', 'This inspection has already been requested. Refresh to see it.');
    await this.audit.transition(tx, {
      actor, entityType: 'INSPECTION', entityId: entry.id, fromStatus: null, toStatus: entry.status,
      note: 'Inspection requested.', correlationId,
    });
    await this.notifications.notify(tx, {
      customerId: entry.customerId, key: 'inspection.required', entity: { type: 'INSPECTION', id: entry.id },
      values: { reference: input.claimNumber ?? input.policyNumber, purpose: input.claimNumber ? 'claim assessment' : 'after-payment review' },
    });
    return entry;
  }

  private records(rows: EvidenceRow[]) {
    return Promise.all(rows.map(async ({ slot, reference, documentId }) => ({
      slot, reference, document: await this.documents.record(documentId),
    })));
  }
}
