import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds, type Permission } from '../common/auth/permissions.js';
import { toContract } from '../common/contract.js';
import { currentOn } from '../common/domain/lusaka.js';
import { licenceValid } from '../common/insurer-standing.js';
import { ApiException } from '../common/errors/api.exception.js';
import { canDecideProfile } from './domain/insurer-profiles.js';
import type { ProfileContent, PublicInsurerProfile } from './dto/insurer-profiles.contract.js';
import { DecideInsurerProfileDto, InsurerProfileHistoryQueryDto, SubmitInsurerProfileDto } from './dto/insurer-profiles.dto.js';
import { InsurerProfilesRepository, type ProfileRevision } from './insurer-profiles.repository.js';

@Injectable()
export class InsurerProfilesService {
  constructor(private readonly profiles: InsurerProfilesRepository, private readonly audit: AuditService) {}

  async publicProfile(insurerId: string): Promise<PublicInsurerProfile> {
    return this.profiles.snapshot(async (tx) => {
      const insurer = await this.profiles.insurer(insurerId, tx);
      const revision = await this.profiles.approved(insurerId, tx);
      if (!insurer || !revision) throw ApiException.notFound('Insurer profile');
      const now = new Date();
      const evidence = await this.profiles.licenceEvidence(insurerId, tx);
      const products = await this.profiles.products(insurerId, now, tx);
      return {
        insurerId, name: insurer.name, tradingName: insurer.tradingName,
        status: toContract.insurerStatus(insurer.status),
        licence: { number: insurer.licenceNumber, expiresAt: insurer.licenceExpiry?.toISOString() ?? null,
          current: licenceValid(insurer.licenceExpiry, now) && evidence.some((row) => row.state === 'APPROVED' && currentOn(row.expiresAt, now)) },
        revisionId: revision.id, profile: contentOf(revision),
        products: products.slice(0, 100).map((product) => ({ productId: product.productId, versionId: product.versionId, name: product.name, coverType: toContract.insuranceType(product.coverType) })),
        productsTruncated: products.length > 100,
      };
    });
  }

  ownHistory(principal: Principal, query: InsurerProfileHistoryQueryDto) {
    return this.history(this.ownInsurer(principal), query);
  }

  adminHistory(insurerId: string, principal: Principal, query: InsurerProfileHistoryQueryDto) {
    this.require(principal, 'insurer:read');
    return this.history(insurerId, query);
  }

  private history(insurerId: string, query: InsurerProfileHistoryQueryDto) {
    const input = validated(InsurerProfileHistoryQueryDto, query);
    return this.profiles.snapshot(async (tx) => {
      if (!await this.profiles.insurer(insurerId, tx)) throw ApiException.notFound('Insurer profile');
      const rows = await this.profiles.history(insurerId, input.beforeVersion, input.limit ?? 20, tx);
      return rows.map(({ revision, decision }) => ({ ...internalRevision(revision), decision: decision ? {
        id: decision.id, decision: decision.decision, reason: decision.reason,
        decidedByStaffId: decision.decidedByStaffId, createdAt: decision.createdAt.toISOString(),
      } : null }));
    });
  }

  async submit(dto: SubmitInsurerProfileDto, principal: Principal) {
    const insurerId = this.ownInsurer(principal);
    if (principal.kind !== 'staff' || principal.role !== 'INSURER_ADMIN') throw ApiException.forbidden();
    const content = contentOf(validated(SubmitInsurerProfileDto, dto));
    return this.profiles.transaction(async (tx) => {
      if (!await this.profiles.insurer(insurerId, tx, true)) throw ApiException.notFound('Insurer profile');
      const latest = await this.profiles.latest(insurerId, tx);
      if (latest?.status === 'PENDING') throw ApiException.conflict('PROFILE_PENDING', 'Decide the pending profile revision before submitting another.');
      const revision = await this.profiles.submit(tx, insurerId, (latest?.versionNumber ?? 0) + 1, principal.id, content);
      await this.audit.write(tx, { actor: auditActor(principal), action: 'insurer_profile.submitted', entityType: 'INSURER_PROFILE', entityId: insurerId,
        after: { revisionId: revision.id, versionNumber: revision.versionNumber, status: revision.status } });
      return internalRevision(revision);
    });
  }

  async decide(insurerId: string, revisionId: string, dto: DecideInsurerProfileDto, principal: Principal) {
    this.require(principal, 'insurer:update');
    const input = validated(DecideInsurerProfileDto, dto);
    return this.profiles.transaction(async (tx) => {
      if (!await this.profiles.insurer(insurerId, tx, true)) throw ApiException.notFound('Insurer profile');
      const revision = await this.profiles.revision(insurerId, revisionId, tx);
      if (!revision) throw ApiException.notFound('Profile revision');
      if (!canDecideProfile(revision.status)) throw staleDecision();
      const previous = input.decision === 'APPROVE' ? await this.profiles.approved(insurerId, tx) : undefined;
      if (previous && !await this.profiles.transition(tx, previous.id, 'APPROVED', 'SUPERSEDED')) throw staleDecision();
      const updated = await this.profiles.transition(tx, revisionId, 'PENDING', input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED');
      if (!updated) throw staleDecision();
      const decision = await this.profiles.decide(tx, revisionId, input.decision, input.reason, principal.id);
      await this.audit.write(tx, { actor: auditActor(principal), action: 'insurer_profile.decided', entityType: 'INSURER_PROFILE', entityId: insurerId,
        before: { status: revision.status }, after: { revisionId, decisionId: decision.id, decision: input.decision, status: updated.status, supersededRevisionId: previous?.id ?? null } });
      return internalRevision(updated);
    });
  }

  private require(principal: Principal, permission: Permission) {
    if (!holds(principal, permission)) throw ApiException.forbidden();
  }

  private ownInsurer(principal: Principal): string {
    this.require(principal, 'portal:profile:read');
    if (principal.kind !== 'staff' || !principal.insurerId) throw ApiException.forbidden();
    return principal.insurerId;
  }
}

function staleDecision() { return ApiException.conflict('PROFILE_REVISION_DECIDED', 'This profile revision has already been decided.'); }
function validated<T extends object>(type: new () => T, input: T): T {
  const dto = plainToInstance(type, input);
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length) throw new ApiException('VALIDATION_ERROR', 'Invalid profile input.');
  return dto;
}
function contentOf(row: ProfileContent): ProfileContent {
  return { brandName: row.brandName, description: row.description, serviceInformation: row.serviceInformation,
    contactEmail: row.contactEmail, contactPhone: row.contactPhone, websiteUrl: row.websiteUrl, logoUrl: row.logoUrl };
}
function internalRevision(row: ProfileRevision) {
  return { id: row.id, insurerId: row.insurerId, versionNumber: row.versionNumber, status: row.status,
    profile: contentOf(row), submittedByStaffId: row.submittedByStaffId, createdAt: row.createdAt.toISOString() };
}
