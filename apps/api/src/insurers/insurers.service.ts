import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import type { InsurerStatusChange } from '../common/contract.js';
import type { Transaction } from '../db/database.module.js';
import { activationBlocks, describeBlocks } from './domain/onboarding.js';

/** A staff member making an onboarding decision. */
type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;
import { canChangeInsurerStatus } from './domain/lifecycle.js';
import { isUniqueViolation } from '../db/errors.js';
import {
  toInsurerChanges,
  toNewContact,
  toNewInsurer,
  type ActivateInsurerDto,
  type CaptureEvidenceDto,
  type CreateInsurerDto,
  type InsurerIntegrationDto,
  type ReviewEvidenceDto,
  type UpdateInsurerDto,
} from './dto/insurer.dto.js';
import {
  toEvidenceResponse,
  toInsurerResponse,
  toIntegrationResponse,
  toPublicInsurerResponse,
} from './dto/insurer-response.dto.js';
import { InsurersRepository } from './insurers.repository.js';
import type { Principal, StaffRoleName } from '../common/auth/auth.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import { QuoteAvailabilityService } from '../customer/quote-availability.service.js';
import { ApprovalService } from '../approvals/approval.service.js';
import type { ApprovalRequestRow } from '../approvals/approval.repository.js';

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
    private readonly quoteAvailability: QuoteAvailabilityService,
    private readonly approvals: ApprovalService,
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
   * The signed-in insurer's own record, for its portal.
   *
   * The insurer comes from the principal rather than from an argument, so the
   * method itself can only ever answer with the caller's own insurer. It used
   * to take an id and say it was scoped, which was true only because its one
   * caller resolved the id first.
   */
  async profile(principal: Extract<Principal, { kind: 'staff' }>) {
    if (!principal.insurerId) throw ApiException.forbidden();
    const insurer = await this.insurers.find(principal.insurerId);
    if (!insurer) throw ApiException.notFound('Insurer', principal.insurerId);
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

  // ── The onboarding record ───────────────────────────────────────

  async evidence(id: string) {
    await this.mustExist(id);
    return (await this.insurers.evidenceOf(id)).map(toEvidenceResponse);
  }

  /** Captured as submitted; nobody has looked at it yet, so it is PENDING. */
  async captureEvidence(id: string, dto: CaptureEvidenceDto, principal: StaffPrincipal) {
    const captured = await this.insurers.transaction(async (tx) => {
      await this.mustExist(id, tx);
      const row = await this.insurers.insertEvidence(tx, {
        insurerId: id,
        kind: dto.kind,
        documentId: dto.documentId,
        reference: dto.reference ?? null,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      });
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer_evidence.captured',
        entityType: 'INSURER',
        entityId: id,
        after: { kind: row.kind, state: row.state },
        note: `Recorded ${row.kind} evidence for review.`,
        correlationId: id,
      });
      return row;
    });
    return toEvidenceResponse({ ...captured, reviewedByName: null });
  }

  async reviewEvidence(id: string, evidenceId: string, dto: ReviewEvidenceDto, principal: StaffPrincipal) {
    const reviewedAt = new Date();
    const reviewed = await this.insurers.transaction(async (tx) => {
      const before = await this.insurers.findEvidence(id, evidenceId, tx);
      if (!before) throw ApiException.notFound('Evidence', evidenceId);
      const row = await this.insurers.reviewEvidence(tx, evidenceId, id, {
        state: dto.state,
        reviewedBy: principal.id,
        reviewedAt,
        note: dto.note ?? null,
      });
      if (!row) throw ApiException.notFound('Evidence', evidenceId);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer_evidence.reviewed',
        entityType: 'INSURER',
        entityId: id,
        before: { kind: before.kind, state: before.state },
        after: { kind: row.kind, state: row.state },
        note: `Reviewed ${row.kind} evidence.`,
        correlationId: id,
      });
      // Read back through the join: the principal carries no name to show.
      const shown = await this.insurers.findEvidence(id, evidenceId, tx);
      if (!shown) throw ApiException.notFound('Evidence', evidenceId);
      return shown;
    });
    return toEvidenceResponse(reviewed);
  }

  async integration(id: string) {
    await this.mustExist(id);
    const model = await this.insurers.findIntegration(id);
    return model ? toIntegrationResponse(model) : null;
  }

  /** Captured whole, without the client secret: holding one needs a key nobody has decided on. */
  async setIntegration(id: string, dto: InsurerIntegrationDto, principal: StaffPrincipal) {
    const saved = await this.insurers.transaction(async (tx) => {
      await this.mustExist(id, tx);
      const row = await this.insurers.saveIntegration(tx, id, {
        apiBaseUrl: dto.apiBaseUrl,
        publicSigningKey: dto.publicSigningKey,
        clientId: dto.clientId,
        quoteCallbackUrl: dto.quoteCallbackUrl ?? null,
        claimsCallbackUrl: dto.claimsCallbackUrl ?? null,
        policyCallbackUrl: dto.policyCallbackUrl ?? null,
        sandboxMode: dto.sandboxMode ?? true,
      });
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'insurer_integration.recorded',
        entityType: 'INSURER',
        entityId: id,
        after: { sandboxMode: row.sandboxMode },
        note: 'Recorded the insurer technical model.',
        correlationId: id,
      });
      return row;
    });
    return toIntegrationResponse(saved);
  }

  /**
   * Lets an insurer trade, once its evidence says it may.
   *
   * Its own route rather than a status change, because activation is a decision
   * with a gate and a record: the generic status route cannot reach ACTIVE at
   * all, so the gate cannot be stepped around. The execution method below is
   * also the transaction-safe target for a future maker/checker approval.
   */
  async activate(id: string, dto: ActivateInsurerDto, principal: StaffPrincipal) {
    const insurer = await this.insurers.transaction(async (tx) => {
      await this.executeActivation(tx, id, dto, principal);
      const row = await this.insurers.find(id, tx);
      if (!row) throw ApiException.notFound('Insurer', id);
      return row;
    });
    return toInsurerResponse(insurer);
  }

  async executeActivation(tx: Transaction, id: string, dto: ActivateInsurerDto, principal: StaffPrincipal) {
    const approvedAt = new Date();
    const before = await this.assertActivationAllowed(tx, id, approvedAt);

    const row = await this.insurers.update(tx, id, {
      status: 'ACTIVE',
      deletedAt: null,
      effectiveFrom: new Date(dto.effectiveFrom),
      renewalDate: dto.renewalDate ? new Date(dto.renewalDate) : null,
      approvedBy: principal.id,
      approvedAt,
      activationConditions: dto.conditions ?? null,
    });
    if (!row) throw ApiException.notFound('Insurer', id);
    const updated = { ...row, contact: await this.insurers.findContact(tx, id) };
    await this.audit.write(tx, {
      actor: auditActor(principal),
      action: 'insurer.activated',
      entityType: 'INSURER',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status, effectiveFrom: dto.effectiveFrom, renewalDate: dto.renewalDate ?? null },
      note: 'Administrator activated the insurer against its approved evidence.',
      correlationId: id,
    });
  }

  /** An insurer nobody may see answers as absent, as everywhere else. */
  private async mustExist(id: string, tx?: Transaction) {
    const insurer = tx ? await this.insurers.lock(tx, id) : await this.insurers.find(id);
    if (!insurer || insurer.status === 'DELETED') throw ApiException.notFound('Insurer', id);
    return insurer;
  }

  /** Read-only preflight used by both the request and final decision paths. */
  private async assertActivationAllowed(tx: Transaction, id: string, at = new Date()) {
    const insurer = await this.insurers.lock(tx, id);
    if (!insurer || insurer.status === 'DELETED') throw ApiException.notFound('Insurer', id);
    this.assertStatusTransition(insurer.status, 'ACTIVE');

    const onFile = await this.insurers.evidenceOf(id, tx);
    const blocks = activationBlocks(
      onFile.map((piece) => ({ kind: piece.kind, state: piece.state, expiresAt: piece.expiresAt })),
      at,
    );
    if (blocks.length > 0) {
      throw ApiException.conflict(
        'ACTIVATION_BLOCKED',
        `This insurer cannot be activated yet: ${describeBlocks(blocks)}.`,
      );
    }
    return insurer;
  }

  /** Does not mutate; approval execution calls it again under the final lock. */
  private async assertStatusChangeAllowed(
    tx: Transaction,
    id: string,
    status: InsurerStatusChange,
    principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    if (status === 'DELETED' && principal.role !== 'SUPER_ADMIN') throw ApiException.forbidden();
    const insurer = await this.insurers.lock(tx, id);
    if (!insurer || insurer.status === 'DELETED') throw ApiException.notFound('Insurer', id);
    this.assertStatusTransition(insurer.status, status);
    if (status === 'DELETED') {
      const blockers = await this.insurers.deletionBlockers(tx, id);
      if (blockers.length) {
        throw ApiException.conflict(
          'INSURER_HAS_SERVICE_RECORDS',
          'This insurer still has customer work to service or a payment in progress. Suspend it instead until that work is complete.',
          { blockers },
        );
      }
    }
    return insurer;
  }

  private async assertSuspensionAllowed(tx: Transaction, id: string) {
    const insurer = await this.insurers.lock(tx, id);
    if (!insurer || insurer.status === 'DELETED') throw ApiException.notFound('Insurer', id);
    if (insurer.status === 'SUSPENDED') {
      throw ApiException.conflict('INSURER_STATUS_TRANSITION', 'This insurer is already SUSPENDED.');
    }
    this.assertStatusTransition(insurer.status, 'SUSPENDED');
    return insurer;
  }

  private assertStatusTransition(current: string, next: 'ACTIVE' | 'SUSPENDED' | InsurerStatusChange) {
    if (!canChangeInsurerStatus(current as Parameters<typeof canChangeInsurerStatus>[0], next)) {
      throw ApiException.conflict(
        'INSURER_STATUS_TRANSITION',
        `An insurer that is ${current} cannot become ${next}.`,
      );
    }
  }

  /** Deleting is for super admins on either route, so an admin cannot soft-delete through a status change. */
  async setStatus(id: string, status: InsurerStatusChange, principal: StaffPrincipal) {
    const insurer = await this.insurers.transaction(async (tx) => {
      await this.executeSetStatus(tx, id, status, principal);
      const row = await this.insurers.find(id, tx);
      if (!row) throw ApiException.notFound('Insurer', id);
      return row;
    });
    return toInsurerResponse(insurer);
  }

  async executeSetStatus(
    tx: Transaction,
    id: string,
    status: InsurerStatusChange,
    principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    const before = await this.assertStatusChangeAllowed(tx, id, status, principal);
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
  }

  /**
   * Stops new sales and makes the insurer's outstanding quote work safe in one
   * transaction. Existing paid policies and claims are intentionally not
   * touched: suspension changes future trading, not cover already purchased.
   */
  async suspend(id: string, reason: string, principal: StaffPrincipal) {
    const insurer = await this.insurers.transaction(async (tx) => {
      await this.executeSuspension(tx, id, reason, principal);
      const row = await this.insurers.find(id, tx);
      if (!row) throw ApiException.notFound('Insurer', id);
      return row;
    });
    return toInsurerResponse(insurer);
  }

  async executeSuspension(
    tx: Transaction,
    id: string,
    reason: string,
    principal: Extract<Principal, { kind: 'staff' }>,
  ) {
    const suspendedAt = new Date();
    const before = await this.insurers.lock(tx, id);
    if (!before || before.status === 'DELETED') throw ApiException.notFound('Insurer', id);
    // A timeout after a committed suspension is safe to retry. The first
    // transaction has already cancelled the work; do not reject the retry
    // or create a second set of customer notices.
    if (before.status === 'SUSPENDED') return;
    this.assertStatusTransition(before.status, 'SUSPENDED');
    const row = await this.insurers.update(tx, id, { status: 'SUSPENDED', deletedAt: null });
    if (!row) throw ApiException.notFound('Insurer', id);
    const marks = await this.quoteAvailability.cancelForSuspendedInsurer(tx, {
      insurerId: id,
      insurerName: row.name,
      suspendedAt,
    });
    const updated = { ...row, contact: await this.insurers.findContact(tx, id) };
    await this.audit.write(tx, {
      actor: auditActor(principal),
      action: 'insurer.suspended',
      entityType: 'INSURER',
      entityId: id,
      before: { status: before.status },
      after: { status: updated.status, ...marks },
      note: reason,
      correlationId: id,
    });
  }

  /**
   * Restore is deliberately not a general status update: only DELETED may
   * transition here, and it returns INACTIVE until a super admin activates it.
   */
  async restore(id: string, principal: StaffPrincipal) {
    const insurer = await this.insurers.transaction(async (tx) => {
      await this.executeRestore(tx, id, principal);
      const row = await this.insurers.find(id, tx);
      if (!row) throw ApiException.notFound('Insurer', id);
      return row;
    });
    return toInsurerResponse(insurer);
  }

  async executeRestore(tx: Transaction, id: string, principal: Extract<Principal, { kind: 'staff' }>) {
    if (principal.role !== 'SUPER_ADMIN') throw ApiException.forbidden();
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
      return;
    }

    if (!(await this.insurers.find(id, tx))) throw ApiException.notFound('Insurer', id);
    throw ApiException.conflict('INSURER_NOT_DELETED', 'This insurer has not been deleted.');
  }

  /**
   * Soft delete. Deactivation stops new deliveries immediately but prior
   * quotes, claims and policies stay readable, per INSURER_API_INTEGRATION.md.
   */
  async remove(id: string, principal: StaffPrincipal) {
    await this.setStatus(id, 'DELETED', principal);
    return { id, status: 'Deleted' as const };
  }

  async proposeActivation(id: string, dto: ActivateInsurerDto, principal: StaffPrincipal) {
    // Reject an unreviewable request early, while executeApproved repeats the
    // same gate inside its decision transaction to protect against stale
    // evidence or a concurrent lifecycle change.
    await this.insurers.transaction((tx) => this.assertActivationAllowed(tx, id));
    return this.approvals.request({
      action: 'INSURER_ACTIVATE',
      targetType: 'INSURER',
      targetId: id,
      payload: { effectiveFrom: dto.effectiveFrom, renewalDate: dto.renewalDate ?? null, conditions: dto.conditions ?? null },
      requestedReason: dto.conditions || 'Activate insurer after evidence review.',
    }, principal);
  }

  async proposeStatus(id: string, status: InsurerStatusChange, principal: StaffPrincipal) {
    if (status === 'DELETED' && principal.role !== 'SUPER_ADMIN') throw ApiException.forbidden();
    await this.insurers.transaction((tx) => this.assertStatusChangeAllowed(tx, id, status, principal));
    return this.approvals.request({
      action: status === 'DELETED' ? 'INSURER_DELETE' : 'INSURER_DEACTIVATE',
      targetType: 'INSURER',
      targetId: id,
      payload: {},
      requestedReason: status === 'DELETED' ? 'Remove insurer from the platform.' : 'Deactivate insurer for new business.',
    }, principal);
  }

  async proposeSuspension(id: string, reason: string, principal: StaffPrincipal) {
    await this.insurers.transaction((tx) => this.assertSuspensionAllowed(tx, id));
    return this.approvals.request({
      action: 'INSURER_SUSPEND',
      targetType: 'INSURER',
      targetId: id,
      payload: { reason },
      requestedReason: reason,
    }, principal);
  }

  async proposeRestore(id: string, principal: StaffPrincipal) {
    if (principal.role !== 'SUPER_ADMIN') throw ApiException.forbidden();
    const insurer = await this.insurers.find(id);
    if (!insurer) throw ApiException.notFound('Insurer', id);
    if (insurer.status !== 'DELETED') {
      throw ApiException.conflict('INSURER_NOT_DELETED', 'This insurer has not been deleted.');
    }
    return this.approvals.request({
      action: 'INSURER_RESTORE',
      targetType: 'INSURER',
      targetId: id,
      payload: {},
      requestedReason: 'Restore the deleted insurer as inactive.',
    }, principal);
  }

  async executeApproved(tx: Transaction, request: ApprovalRequestRow, principal: StaffPrincipal) {
    if (request.targetType !== 'INSURER') throw ApiException.conflict('APPROVAL_ACTION_INVALID', 'This approval does not target an insurer.');
    switch (request.action) {
      case 'INSURER_ACTIVATE': {
        const payload = activationPayload(request.payload);
        return this.executeActivation(tx, request.targetId, payload, principal);
      }
      case 'INSURER_DEACTIVATE':
        return this.executeSetStatus(tx, request.targetId, 'INACTIVE', principal);
      case 'INSURER_DELETE':
        return this.executeSetStatus(tx, request.targetId, 'DELETED', principal);
      case 'INSURER_SUSPEND':
        return this.executeSuspension(tx, request.targetId, suspensionPayload(request.payload), principal);
      case 'INSURER_RESTORE':
        return this.executeRestore(tx, request.targetId, principal);
      default:
        throw ApiException.conflict('APPROVAL_ACTION_INVALID', 'This approval action cannot be applied to an insurer.');
    }
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

function activationPayload(payload: Record<string, unknown>): ActivateInsurerDto {
  if (
    typeof payload.effectiveFrom !== 'string' ||
    (payload.renewalDate !== null && payload.renewalDate !== undefined && typeof payload.renewalDate !== 'string') ||
    (payload.conditions !== null && payload.conditions !== undefined && typeof payload.conditions !== 'string')
  ) {
    throw ApiException.conflict('APPROVAL_PAYLOAD_INVALID', 'This activation approval has an invalid frozen payload.');
  }
  return {
    effectiveFrom: payload.effectiveFrom,
    renewalDate: typeof payload.renewalDate === 'string' ? payload.renewalDate : undefined,
    conditions: typeof payload.conditions === 'string' ? payload.conditions : undefined,
  };
}

function suspensionPayload(payload: Record<string, unknown>): string {
  if (typeof payload.reason !== 'string' || payload.reason.trim().length < 3) {
    throw ApiException.conflict('APPROVAL_PAYLOAD_INVALID', 'This suspension approval has an invalid frozen payload.');
  }
  return payload.reason;
}
