import { Injectable } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { holds } from '../common/auth/permissions.js';
import { ApiException } from '../common/errors/api.exception.js';
import type { Transaction } from '../db/database.module.js';
import { nextStatus } from './domain/privacy-review.js';
import {
  CreatePrivacyRequestDto,
  StaffCreatePrivacyRequestDto,
  PrivacyTransitionDto,
  PrivacyHoldDto,
  PrivacyListDto,
} from './dto/privacy-review.dto.js';
import {
  PrivacyReviewRepository,
  type PrivacyRequestRow,
} from './privacy-review.repository.js';

@Injectable()
export class PrivacyReviewService {
  constructor(
    private readonly repository: PrivacyReviewRepository,
    private readonly audit: AuditService,
  ) {}
  private async authorize(principal: Principal, admin: boolean) {
    const allowed = admin
      ? principal.kind === 'staff' &&
        !principal.insurerId &&
        holds(principal, 'admin:privacy:review')
      : principal.kind === 'customer' &&
        principal.emailVerified &&
        holds(principal, 'account:privacy:request');
    if (allowed) return;
    await this.audit.refusal({
      actor: auditActor(principal),
      action: 'privacy.access_denied',
      entityType: 'PRIVACY_REQUEST',
      entityId: principal.id,
    });
    throw ApiException.forbidden();
  }
  private validate<T extends object>(type: new () => T, value: T): T {
    const dto = plainToInstance(type, value);
    if (
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length
    )
      throw new ApiException(
        'PRIVACY_INPUT_INVALID',
        'Check the privacy request fields.',
      );
    return dto;
  }
  private text(value: string | undefined, max: number) {
    if (typeof value !== 'string' || !value.trim() || value.length > max)
      throw new ApiException(
        'PRIVACY_INPUT_INVALID',
        'Provide the required decision, rationale and evidence references.',
      );
    return value.trim();
  }
  private summary(row: PrivacyRequestRow, admin: boolean) {
    const common = {
      id: row.id,
      kind: row.kind,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    };
    return admin
      ? {
          ...common,
          customerId: row.customerId,
          requestedByStaffId: row.requestedByStaffId,
          ownerStaffId: row.ownerStaffId,
          identityVerifiedAt: row.identityVerifiedAt?.toISOString() ?? null,
          held: row.held,
          version: row.version,
        }
      : common;
  }
  async create(
    principal: Principal,
    input: CreatePrivacyRequestDto | StaffCreatePrivacyRequestDto,
    admin = false,
  ) {
    await this.authorize(principal, admin);
    const dto = admin
      ? this.validate(
          StaffCreatePrivacyRequestDto,
          input as StaffCreatePrivacyRequestDto,
        )
      : this.validate(CreatePrivacyRequestDto, input);
    const customerId =
      admin && 'customerId' in dto ? (dto.customerId as string) : principal.id;
    return this.repository.transaction(async (tx) => {
      const customer = await this.repository.customer(tx, customerId);
      if (!customer || customer.anonymisedAt || (!admin && customer.deletedAt))
        throw ApiException.notFound('Customer');
      const row = await this.repository.create(tx, {
        customerId,
        kind: dto.kind,
        requestedByStaffId: admin ? principal.id : null,
      });
      await this.record(tx, row, principal, 'SUBMITTED');
      return this.summary(row, admin);
    });
  }
  async list(principal: Principal, input: PrivacyListDto = {}, admin = false) {
    await this.authorize(principal, admin);
    const query = this.validate(PrivacyListDto, input);
    if (!admin && query.customerId)
      throw new ApiException(
        'PRIVACY_INPUT_INVALID',
        'Customer scope comes from the signed-in account.',
      );
    const rows = await this.repository.list(
      query,
      admin ? query.customerId : principal.id,
    );
    if (admin) {
      await this.audit.recordRead({
        actor: auditActor(principal),
        action: 'privacy.list_viewed',
        entityType: 'PRIVACY_REQUEST',
        entityId: 'privacy-register',
        after: { page: query.page ?? 1, status: query.status, subjectFilter: Boolean(query.customerId), resultCount: rows.length },
      });
    }
    return {
      items: rows.map((row) => this.summary(row, admin)),
      page: query.page ?? 1,
      pageSize: 25,
    };
  }
  async detail(principal: Principal, id: string, input: PrivacyListDto = {}) {
    await this.authorize(principal, true);
    const query = this.validate(PrivacyListDto, input);
    const row = await this.repository.get(id);
    if (!row) throw ApiException.notFound('Privacy request');
    const events = await this.repository.events(id, query.page ?? 1);
    await this.audit.recordRead({
      actor: auditActor(principal),
      action: 'privacy.case_viewed',
      entityType: 'PRIVACY_REQUEST',
      entityId: row.id,
      correlationId: row.id,
      after: { page: query.page ?? 1, resultCount: events.length },
    });
    return {
      request: this.summary(row, true),
      events: events.map((event) => ({
        id: event.id,
        version: event.version,
        action: event.action,
        actorCustomerId: event.actorCustomerId,
        actorStaffId: event.actorStaffId,
        decisionReference: event.decisionReference,
        rationale: event.rationale,
        evidenceReference: event.evidenceReference,
        affectedRecords: event.affectedRecords,
        createdAt: event.createdAt.toISOString(),
      })),
      page: query.page ?? 1,
      pageSize: 25,
    };
  }
  private async locked(tx: Transaction, id: string, version: number) {
    const row = await this.repository.get(id, tx, true);
    if (!row) throw ApiException.notFound('Privacy request');
    if (row.version !== version)
      throw ApiException.conflict(
        'PRIVACY_VERSION_CONFLICT',
        'The request changed. Reload before updating.',
      );
    return row;
  }
  private async accountable(tx: Transaction, id: string | null) {
    const owner = id ? await this.repository.owner(tx, id) : undefined;
    if (
      !owner?.isActive ||
      owner.insurerId ||
      !holds(
        {
          kind: 'staff',
          id: owner.id,
          email: owner.email,
          role: owner.role,
          insurerId: owner.insurerId,
        },
        'admin:privacy:review',
      )
    )
      throw ApiException.conflict(
        'PRIVACY_OWNER_INVALID',
        'Assign an active privacy reviewer.',
      );
  }
  async transition(
    principal: Principal,
    id: string,
    input: PrivacyTransitionDto,
  ) {
    await this.authorize(principal, true);
    const dto = this.validate(PrivacyTransitionDto, input);
    return this.repository.transaction(async (tx) => {
      const row = await this.locked(tx, id, dto.version);
      const status = nextStatus(row.status, dto.action);
      if (!status)
        throw ApiException.conflict(
          'PRIVACY_TRANSITION_INVALID',
          'This action is not available in the current state.',
        );
      await this.accountable(
        tx,
        dto.action === 'ASSIGNED'
          ? (dto.ownerStaffId ?? null)
          : row.ownerStaffId,
      );
      if (dto.action !== 'ASSIGNED') {
        this.text(dto.rationale, 2000);
        this.text(dto.evidenceReference, 200);
      }
      if (dto.action === 'DECIDED' || dto.action === 'COMPLETED')
        this.text(dto.decisionReference, 200);
      if (dto.action === 'DECIDED' && !dto.affectedRecords?.length)
        throw new ApiException(
          'PRIVACY_INPUT_INVALID',
          'Identify the affected records.',
        );
      if (dto.action === 'COMPLETED' && row.held)
        throw ApiException.conflict(
          'PRIVACY_HOLD_ACTIVE',
          'Release this case hold before completing the request.',
        );
      for (const record of dto.affectedRecords ?? []) {
        if (
          !(await this.repository.recordBelongs(tx, row.customerId, record))
        ) {
          await this.audit.refusal({
            actor: auditActor(principal),
            action: 'privacy.record_access_denied',
            entityType: 'PRIVACY_REQUEST',
            entityId: row.id,
          });
          throw ApiException.notFound('Affected record');
        }
      }
      const now = new Date();
      const updated = await this.repository.update(tx, row, {
        status,
        ...(dto.action === 'ASSIGNED'
          ? { ownerStaffId: dto.ownerStaffId }
          : {}),
        ...(dto.action === 'VERIFIED' ? { identityVerifiedAt: now } : {}),
        ...(dto.action === 'COMPLETED' ? { completedAt: now } : {}),
      });
      if (!updated)
        throw ApiException.conflict(
          'PRIVACY_VERSION_CONFLICT',
          'The request changed. Reload before updating.',
        );
      await this.record(tx, updated, principal, dto.action, dto);
      return this.summary(updated, true);
    });
  }
  async hold(principal: Principal, id: string, input: PrivacyHoldDto) {
    await this.authorize(principal, true);
    const dto = this.validate(PrivacyHoldDto, input);
    this.text(dto.decisionReference, 200);
    this.text(dto.rationale, 2000);
    this.text(dto.evidenceReference, 200);
    return this.repository.transaction(async (tx) => {
      const initial = await this.repository.get(id, tx);
      if (!initial) throw ApiException.notFound('Privacy request');
      // Customer before advisory before case: retention uses customer before advisory too.
      const customer = await this.repository.customer(tx, initial.customerId);
      const started = await this.repository.fence(tx, initial.customerId);
      const row = await this.locked(tx, id, dto.version);
      if (row.status === 'COMPLETED' || row.held === dto.held)
        throw ApiException.conflict(
          'PRIVACY_TRANSITION_INVALID',
          'This hold action is not available.',
        );
      await this.accountable(tx, row.ownerStaffId);
      if (!row.identityVerifiedAt)
        throw ApiException.conflict(
          'PRIVACY_IDENTITY_REQUIRED',
          'Record identity verification before changing a hold.',
        );
      if (dto.held && (!customer || customer.anonymisedAt || started))
        throw ApiException.conflict(
          'PRIVACY_RETENTION_STARTED',
          'Retention has already started for affected records.',
        );
      const updated = await this.repository.update(tx, row, { held: dto.held });
      if (!updated)
        throw ApiException.conflict(
          'PRIVACY_VERSION_CONFLICT',
          'The request changed. Reload before updating.',
        );
      await this.record(
        tx,
        updated,
        principal,
        dto.held ? 'HOLD_APPROVED' : 'HOLD_RELEASED',
        dto,
      );
      return this.summary(updated, true);
    });
  }
  private async record(
    tx: Transaction,
    row: PrivacyRequestRow,
    principal: Principal,
    action: string,
    context?: {
      decisionReference?: string;
      rationale?: string;
      evidenceReference?: string;
      affectedRecords?: Array<{ type: string; id: string }>;
    },
  ) {
    await this.repository.event(tx, {
      requestId: row.id,
      version: row.version,
      action,
      actorCustomerId: principal.kind === 'customer' ? principal.id : null,
      actorStaffId: principal.kind === 'staff' ? principal.id : null,
      decisionReference: context?.decisionReference?.trim() ?? null,
      rationale: context?.rationale?.trim() ?? null,
      evidenceReference: context?.evidenceReference?.trim() ?? null,
      affectedRecords: context?.affectedRecords ?? [],
    });
    await this.audit.write(tx, {
      actor: auditActor(principal),
      action: `privacy.${action.toLowerCase()}`,
      entityType: 'PRIVACY_REQUEST',
      entityId: row.id,
      correlationId: row.id,
      after: {
        version: row.version,
        status: row.status,
        held: row.held,
        ownerStaffId: row.ownerStaffId,
      },
    });
  }
}
