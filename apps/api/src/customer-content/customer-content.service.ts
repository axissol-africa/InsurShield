import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import type { CreateContentDto } from './customer-content.dto.js';
import { CustomerContentRepository, type ContentVersion } from './customer-content.repository.js';
import { plainText, publishedVersions, transitionAllowed } from './domain/content.js';

export function publicContent(row: ContentVersion) {
  return { id: row.id, slug: row.slug, type: row.type, version: row.version, title: row.title, body: row.body,
    effectiveFrom: row.effectiveFrom, expiresOn: row.expiresOn };
}
export function staffContent(row: ContentVersion) {
  return { ...publicContent(row), audience: row.audience, channel: row.channel, status: row.status,
    ownerStaffId: row.ownerStaffId, approvedByStaffId: row.approvedByStaffId, approvedAt: row.approvedAt,
    withdrawnByStaffId: row.withdrawnByStaffId, withdrawnAt: row.withdrawnAt,
    withdrawalReason: row.withdrawalReason, createdAt: row.createdAt };
}
@Injectable()
export class CustomerContentService {
  constructor(private readonly repository: CustomerContentRepository, private readonly audit: AuditService) {}
  async published() {
    const day = lusakaDay(new Date());
    return { items: publishedVersions(await this.repository.publicCandidates(day), day).map(publicContent) };
  }
  async list(page: number, principal: Principal) {
    this.manager(principal);
    const rows = await this.repository.list((page - 1) * 20, 21);
    return { items: rows.slice(0, 20).map(staffContent), page, hasMore: rows.length > 20 };
  }
  async history(slug: string, principal: Principal) {
    this.manager(principal);
    return { items: (await this.repository.history(slug)).map(staffContent) };
  }
  async create(slug: string, dto: CreateContentDto, principal: Principal) {
    const actor = this.manager(principal);
    if (!plainText(dto.title) || !plainText(dto.body)) throw new ApiException('CONTENT_TEXT_INVALID', 'Use nonempty plain text without HTML or control characters.');
    if (dto.expiresOn && dto.expiresOn < dto.effectiveFrom) throw new ApiException('CONTENT_DATES_INVALID', 'Expiry cannot precede the effective date.');
    return this.repository.transaction(async tx => {
      const rows = await this.repository.lock(tx, slug);
      const latest = rows[0];
      if ((latest?.version ?? 0) !== dto.expectedVersion) throw this.changed();
      if (latest && latest.type !== dto.type) throw ApiException.conflict('CONTENT_TYPE_CHANGED', 'Use a separate slug for a different content type.');
      const row = await this.repository.create(tx, {
        slug, type: dto.type, version: dto.expectedVersion + 1, title: dto.title, body: dto.body,
        effectiveFrom: dto.effectiveFrom, expiresOn: dto.expiresOn ?? null, ownerStaffId: actor.id,
        status: 'DRAFT', audience: 'CUSTOMER', channel: 'SUPPORT',
      });
      await this.record(tx, principal, 'customer_content.drafted', row, null);
      return staffContent(row);
    });
  }
  async approve(slug: string, id: string, principal: Principal) {
    const actor = this.manager(principal);
    return this.repository.transaction(async tx => {
      const rows = await this.repository.lock(tx, slug);
      const row = rows.find(row => row.id === id);
      if (!row) throw ApiException.notFound('Content version');
      if (row.ownerStaffId === actor.id) throw new ApiException('CONTENT_SELF_APPROVAL', 'Another administrator must approve this wording.', HttpStatus.FORBIDDEN);
      if (rows[0]?.id !== id || !transitionAllowed(row.status, 'approve')) throw this.changed();
      const now = new Date();
      if (row.expiresOn && row.expiresOn < lusakaDay(now)) throw ApiException.conflict('CONTENT_EXPIRED', 'Create a new version with current publication dates.');
      const updated = await this.repository.decide(tx, id, { status: 'APPROVED', approvedByStaffId: actor.id, approvedAt: now });
      await this.record(tx, principal, 'customer_content.approved', updated, row.status);
      return staffContent(updated);
    });
  }
  async withdraw(slug: string, id: string, reason: string, principal: Principal) {
    const actor = this.manager(principal);
    if (!plainText(reason)) throw new ApiException('CONTENT_TEXT_INVALID', 'Give a plain-text reason for withdrawal.');
    return this.repository.transaction(async tx => {
      const rows = await this.repository.lock(tx, slug);
      const row = rows.find(row => row.id === id);
      if (!row) throw ApiException.notFound('Content version');
      if (!transitionAllowed(row.status, 'withdraw')) throw this.changed();
      const updated = await this.repository.decide(tx, id, { status: 'WITHDRAWN', withdrawnByStaffId: actor.id, withdrawnAt: new Date(), withdrawalReason: reason });
      await this.record(tx, principal, 'customer_content.withdrawn', updated, row.status);
      return staffContent(updated);
    });
  }
  private record(tx: Transaction, principal: Principal, action: string, row: ContentVersion, previous: string | null) {
    return this.audit.write(tx, { actor: auditActor(principal), action, entityType: 'CUSTOMER_CONTENT', entityId: row.id,
      correlationId: row.slug, before: { status: previous }, after: { slug: row.slug, type: row.type, version: row.version,
        status: row.status, ownerStaffId: row.ownerStaffId, audience: row.audience, channel: row.channel,
        effectiveFrom: row.effectiveFrom, expiresOn: row.expiresOn, approvedByStaffId: row.approvedByStaffId,
        approvedAt: row.approvedAt?.toISOString() ?? null, withdrawnByStaffId: row.withdrawnByStaffId,
        withdrawnAt: row.withdrawnAt?.toISOString() ?? null }, note: row.withdrawalReason });
  }
  private manager(principal: Principal) {
    if (principal.kind !== 'staff' || principal.insurerId !== null || !holds(principal, 'admin:content:manage')) throw ApiException.forbidden();
    return principal;
  }
  private changed() { return ApiException.conflict('CONTENT_VERSION_CHANGED', 'This content has changed. Refresh its history before continuing.'); }
}
