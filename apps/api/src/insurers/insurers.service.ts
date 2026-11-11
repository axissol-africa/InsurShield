import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import type { InsurerStatusChange } from '../common/contract.js';
import { canChangeInsurerStatus } from './domain/lifecycle.js';
import { isUniqueViolation } from '../db/errors.js';
import { toInsurerChanges, toNewContact, toNewInsurer, type CreateInsurerDto, type UpdateInsurerDto } from './dto/insurer.dto.js';
import { toInsurerResponse, toPublicInsurerResponse } from './dto/insurer-response.dto.js';
import { InsurersRepository } from './insurers.repository.js';
import type { Principal, StaffRoleName } from '../common/auth/auth.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';

const NAME_CONSTRAINT = 'insurers_name_key';

// Names are unique by constraint, so two requests for one name at once get one insurer and one refusal.
const nameClash = (name: string | undefined) => (error: unknown): never => {
  if (name !== undefined && isUniqueViolation(error, NAME_CONSTRAINT)) {
    throw ApiException.conflict('INSURER_EXISTS', `An insurer named ${name} already exists.`);
  }
  throw error;
};

@Injectable()
export class InsurersService {
  constructor(
    private readonly insurers: InsurersRepository,
    private readonly audit: AuditService,
  ) {}

  /** Every insurer the admin portal manages, deleted ones excluded by default. */
  async list(status: 'deleted' | undefined, role: StaffRoleName) {
    if (status === 'deleted') {
      if (role !== 'SUPER_ADMIN') throw ApiException.forbidden();
      return (await this.insurers.listDeleted()).map(toInsurerResponse);
    }
    return (await this.insurers.listNotDeleted()).map(toInsurerResponse);
  }

  /** Insurers that may take new business — the same rule a quote request fans out on. */
  async directory() {
    return (await this.insurers.listTakingNewBusiness(new Date())).map(toPublicInsurerResponse);
  }

  /** One insurer in full. Staff only. */
  async get(id: string) {
    const insurer = await this.insurers.find(id);
    if (!insurer || insurer.status === 'DELETED') {
      throw ApiException.notFound('Insurer', id);
    }
    return toInsurerResponse(insurer);
  }

  /**
   * The signed-in insurer's own record, for its portal. Scoped by the caller's
   * staff record, so it can only ever return the insurer they belong to.
   */
  async profile(insurerId: string) {
    const insurer = await this.insurers.find(insurerId);
    if (!insurer) throw ApiException.notFound('Insurer', insurerId);
    return toInsurerResponse(insurer);
  }

  async create(dto: CreateInsurerDto, principal: Extract<Principal, { kind: 'staff' }>) {
    const insurer = await this.insurers
      .transaction(async (tx) => {
        const created = await this.insurers.insert(tx, toNewInsurer(dto), toNewContact(dto.contact));
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'insurer.created',
          entityType: 'INSURER',
          entityId: created.id,
          after: insurerSnapshot(created),
          note: 'Administrator onboarded an insurer.',
          correlationId: created.id,
        });
        return created;
      })
      .catch(nameClash(dto.name));
    return toInsurerResponse(insurer);
  }

  async update(id: string, dto: UpdateInsurerDto, principal: Extract<Principal, { kind: 'staff' }>) {
    const insurer = await this.insurers.transaction(async (tx) => {
      const before = await this.insurers.lock(tx, id);
      if (!before || before.status === 'DELETED') throw ApiException.notFound('Insurer', id);
      const row = await this.insurers.update(tx, id, toInsurerChanges(dto));
      if (!row) throw ApiException.notFound('Insurer', id);
      const contact = dto.contact
        ? await this.insurers.upsertContact(tx, id, toNewContact(dto.contact))
        : await this.insurers.findContact(tx, id);
      const updated = { ...row, contact };
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer.updated',
        entityType: 'INSURER',
        entityId: id,
        before: insurerSnapshot(before),
        after: insurerSnapshot(updated),
        note: 'Administrator updated an insurer profile.',
        correlationId: id,
      });
      return updated;
    }).catch(nameClash(dto.name));
    return toInsurerResponse(insurer);
  }

  /** Deleting is for super admins on either route, so an admin cannot soft-delete through a status change. */
  async setStatus(id: string, status: InsurerStatusChange, principal: Extract<Principal, { kind: 'staff' }>) {
    if (status === 'DELETED' && principal.role !== 'SUPER_ADMIN') throw ApiException.forbidden();
    const insurer = await this.insurers.transaction(async (tx) => {
      const before = await this.insurers.lock(tx, id);
      if (!before || before.status === 'DELETED') throw ApiException.notFound('Insurer', id);
      if (!canChangeInsurerStatus(before.status, status)) {
        throw ApiException.conflict(
          'INSURER_STATUS_TRANSITION',
          `An insurer that is ${before.status} cannot become ${status}.`,
        );
      }
      const row = await this.insurers.update(tx, id, { status, deletedAt: status === 'DELETED' ? new Date() : null });
      if (!row) throw ApiException.notFound('Insurer', id);
      const updated = { ...row, contact: await this.insurers.findContact(tx, id) };
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer.status_changed',
        entityType: 'INSURER',
        entityId: id,
        before: { status: before.status },
        after: { status: updated.status },
        note: `Administrator changed the insurer status from ${before.status} to ${updated.status}.`,
        correlationId: id,
      });
      return updated;
    });
    return toInsurerResponse(insurer);
  }

  /**
   * Restore is deliberately not a general status update: only DELETED may
   * transition here, and it returns INACTIVE until a super admin activates it.
   */
  async restore(id: string, principal: Extract<Principal, { kind: 'staff' }>) {
    if (principal.role !== 'SUPER_ADMIN') throw ApiException.forbidden();
    const insurer = await this.insurers.transaction(async (tx) => {
      const row = await this.insurers.restoreDeleted(tx, id);
      if (row) {
        const restored = { ...row, contact: await this.insurers.findContact(tx, id) };
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'insurer.restored',
          entityType: 'INSURER',
          entityId: id,
          // restoreDeleted only matches a currently deleted insurer, so this
          // transition is known without taking a separate lock before the
          // conditional update. Keeping the update first also preserves the
          // atomic single-winner restore contract under concurrent requests.
          before: { status: 'DELETED' },
          after: { status: restored.status },
          note: 'Super administrator restored a deleted insurer as inactive.',
          correlationId: id,
        });
        return restored;
      }

      if (!(await this.insurers.find(id, tx))) throw ApiException.notFound('Insurer', id);
      throw ApiException.conflict('INSURER_NOT_DELETED', 'This insurer has not been deleted.');
    });
    return toInsurerResponse(insurer);
  }

  /**
   * Soft delete. Deactivation stops new deliveries immediately but prior
   * quotes, claims and policies stay readable, per INSURER_API_INTEGRATION.md.
   */
  async remove(id: string, principal: Extract<Principal, { kind: 'staff' }>) {
    await this.setStatus(id, 'DELETED', principal);
    return { id, status: 'Deleted' as const };
  }
}

/** The audit log keeps decision fields, never contact or integration credentials. */
function insurerSnapshot(insurer: {
  name: string;
  status: string;
  licenceNumber: string | null;
  licenceExpiry: Date | null;
  registrationNumber: string | null;
  tpin: string | null;
  rateBps: number;
  quoteValidityDays: number;
  coverage: string;
  plan: string | null;
  ncdAccepted: boolean;
  inspectionRule: string;
  inspectionTiming: string;
  inspectionMethod: string;
}) {
  return {
    name: insurer.name,
    status: insurer.status,
    // Eligibility and identity fields, so a change to either is reconstructable from the log.
    licenceNumber: insurer.licenceNumber,
    licenceExpiry: insurer.licenceExpiry,
    registrationNumber: insurer.registrationNumber,
    tpin: insurer.tpin,
    rateBps: insurer.rateBps,
    quoteValidityDays: insurer.quoteValidityDays,
    coverage: insurer.coverage,
    plan: insurer.plan,
    ncdAccepted: insurer.ncdAccepted,
    inspectionRule: insurer.inspectionRule,
    inspectionTiming: insurer.inspectionTiming,
    inspectionMethod: insurer.inspectionMethod,
  };
}
