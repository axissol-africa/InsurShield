import { Injectable } from '@nestjs/common';
import { isInsurerRole, type InspectionMethod, type InspectionRule, type InspectionTiming, type InsuranceType, type ProductVersionStatus } from '../common/domain/enums.js';
import { holds, type Permission } from '../common/auth/permissions.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { InsurersService } from '../insurers/insurers.service.js';
import {
  ApproveProductVersionDto,
  CreateProductDto,
  type ProductDirectoryQueryDto,
  RejectProductVersionDto,
  UpdateDraftProductVersionDto,
  WithdrawProductVersionDto,
} from './dto/product.dto.js';
import { checkCoverGuide, type CoverGuide } from './domain/cover-guide.js';
import {
  asDay,
  calendarDate,
  canApproveProductVersion,
  canEditProductVersion,
  canSubmitProductVersion,
  canWithdrawProductVersion,
  inspectionErrors,
} from './domain/product-version.js';
import { ProductsRepository, type ProductRow, type ProductVersionRow } from './products.repository.js';
import type { Transaction } from '../db/database.module.js';
import { isUniqueViolation } from '../db/errors.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;
type VersionRecord = { product: ProductRow; version: ProductVersionRow; insurer: { id: string; name: string; tradingName: string | null; logoUrl: string | null } };
type InternalVersion = {
  id: string;
  versionNumber: number;
  status: ProductVersionStatus;
  name: string;
  coverType: InsuranceType;
  coverGuide: CoverGuide;
  inspection: { rule: InspectionRule; timing: InspectionTiming | null; method: InspectionMethod | null };
  effectiveFrom: string;
  effectiveUntil: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewComment: string | null;
  withdrawnAt: string | null;
  withdrawalReason: string | null;
  createdAt: string;
  updatedAt: string;
};
type VersionChanges = {
  name?: string;
  /** Present only when the durable product and its first version are created. */
  coverType?: InsuranceType;
  coverGuide?: Record<string, unknown>;
  inspectionRule?: InspectionRule;
  inspectionTiming?: InspectionTiming | null;
  inspectionMethod?: InspectionMethod | null;
  effectiveFrom?: string;
  effectiveUntil?: string | null;
};
type NormalisedVersion = {
  name: string | undefined;
  coverType: InsuranceType | undefined;
  coverGuide: Record<string, unknown>;
  coverGuideErrors: Record<string, string>;
  inspectionRule: InspectionRule | undefined;
  inspectionTiming: InspectionTiming | null;
  inspectionMethod: InspectionMethod | null;
  effectiveFrom: Date | undefined;
  effectiveUntil: Date | null;
};
type CompleteProductVersion = Omit<NormalisedVersion, 'name' | 'coverType' | 'inspectionRule' | 'effectiveFrom'> & {
  name: string;
  coverType: InsuranceType;
  inspectionRule: InspectionRule;
  effectiveFrom: Date;
};

const PRODUCT_CODE_CONSTRAINT = 'insurer_products_insurerId_code_key';

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly insurers: InsurersService,
    private readonly audit: AuditService,
  ) {}

  async listOwn(principal: Principal) {
    this.require(principal, 'product:read-own');
    const insurerId = this.insurerId(principal);
    const records = await this.products.listForInsurer(insurerId);
    const grouped = new Map<string, { id: string; code: string; coverType: InsuranceType; createdAt: string; updatedAt: string; versions: InternalVersion[] }>();
    for (const record of records) {
      const product = grouped.get(record.product.id) ?? {
        id: record.product.id,
        code: record.product.code,
        coverType: record.product.coverType,
        createdAt: record.product.createdAt.toISOString(),
        updatedAt: record.product.updatedAt.toISOString(),
        versions: [],
      };
      if (record.version) product.versions.push(this.toInternalVersion(record.version));
      grouped.set(record.product.id, product);
    }
    return [...grouped.values()];
  }

  async getOwn(productId: string, principal: Principal) {
    this.require(principal, 'product:read-own');
    const insurerId = this.insurerId(principal);
    const product = await this.products.findProduct(productId);
    if (!product || product.insurerId !== insurerId) {
      await this.refuseIfForeign(product, principal, productId);
      throw ApiException.notFound('Product', productId);
    }
    const records = (await this.products.listForInsurer(insurerId)).filter((row) => row.product.id === productId);
    return {
      id: product.id,
      code: product.code,
      coverType: product.coverType,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      versions: records.flatMap((row) => (row.version ? [this.toInternalVersion(row.version)] : [])),
    };
  }

  async create(dto: CreateProductDto, principal: Principal) {
    this.require(principal, 'product:draft:manage');
    const insurerId = this.insurerId(principal);
    const normalized = this.normaliseVersion(dto, undefined);
    this.assertDraftInput(normalized);
    try {
      return await this.products.transaction(async (tx) => {
        await this.insurers.assertVerifiedActiveForProducts(tx, insurerId);
        const product = await this.products.createProduct(tx, { insurerId, code: dto.code, coverType: normalized.coverType });
        const version = await this.products.createVersion(tx, {
          productId: product.id,
          versionNumber: 1,
          status: 'DRAFT',
          ...normalized,
          createdByStaffId: principal.id,
        });
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'product.created',
          entityType: 'INSURER_PRODUCT',
          entityId: product.id,
          after: { code: product.code, versionNumber: version.versionNumber, status: version.status, coverType: version.coverType },
          note: 'Insurer administrator created a product draft.',
          correlationId: product.id,
        });
        return this.toInternalProductVersion(product, version);
      });
    } catch (error) {
      if (this.isUniqueProductCode(error)) {
        throw ApiException.conflict('PRODUCT_CODE_EXISTS', 'This insurer already uses that product code.');
      }
      throw error;
    }
  }

  async updateDraft(productId: string, versionId: string, dto: UpdateDraftProductVersionDto, principal: Principal) {
    this.require(principal, 'product:draft:manage');
    return this.products.transaction(async (tx) => {
      const record = await this.ownedLockedVersion(tx, productId, versionId, principal);
      await this.insurers.assertVerifiedActiveForProducts(tx, record.product.insurerId);
      if (!canEditProductVersion(record.version.status)) {
        throw ApiException.conflict('PRODUCT_VERSION_IMMUTABLE', 'Create a new draft to change a submitted or reviewed product version.');
      }
      const normalized = this.normaliseVersion(dto, record.version);
      this.assertDraftInput(normalized);
      const version = await this.products.updateVersion(tx, versionId, normalized);
      if (!version) throw ApiException.notFound('Product version', versionId);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'product_version.draft_updated',
        entityType: 'INSURER_PRODUCT_VERSION',
        entityId: version.id,
        before: { status: record.version.status, versionNumber: record.version.versionNumber },
        after: { status: version.status, versionNumber: version.versionNumber, coverType: version.coverType },
        note: 'Insurer administrator updated a product draft.',
        correlationId: productId,
      });
      return this.toInternalProductVersion(record.product, version);
    });
  }

  /** Clone a submitted, approved, rejected, or withdrawn version into a fresh editable draft. */
  async revise(productId: string, versionId: string, principal: Principal) {
    this.require(principal, 'product:draft:manage');
    return this.products.transaction(async (tx) => {
      const source = await this.ownedLockedVersion(tx, productId, versionId, principal);
      await this.insurers.assertVerifiedActiveForProducts(tx, source.product.insurerId);
      if (source.version.status === 'DRAFT') {
        throw ApiException.conflict('PRODUCT_DRAFT_EXISTS', 'This version is already a draft; update it instead of creating a copy.');
      }
      // Product lock serialises version-number allocation; no two revisions can take the same number.
      const product = await this.products.lockProduct(tx, productId);
      if (!product) throw ApiException.notFound('Product', productId);
      const version = await this.products.createVersion(tx, {
        productId,
        versionNumber: await this.products.nextVersionNumber(tx, productId),
        status: 'DRAFT',
        name: source.version.name,
        coverType: source.version.coverType,
        coverGuide: source.version.coverGuide,
        inspectionRule: source.version.inspectionRule,
        inspectionTiming: source.version.inspectionTiming,
        inspectionMethod: source.version.inspectionMethod,
        effectiveFrom: source.version.effectiveFrom,
        effectiveUntil: source.version.effectiveUntil,
        createdByStaffId: principal.id,
      });
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'product_version.revised',
        entityType: 'INSURER_PRODUCT_VERSION',
        entityId: version.id,
        before: { sourceVersionId: source.version.id, sourceVersionNumber: source.version.versionNumber, status: source.version.status },
        after: { versionNumber: version.versionNumber, status: version.status },
        note: 'Insurer administrator started a new draft from a reviewed product version.',
        correlationId: productId,
      });
      return this.toInternalProductVersion(product, version);
    });
  }

  async submit(productId: string, versionId: string, principal: Principal) {
    this.require(principal, 'product:submit');
    return this.products.transaction(async (tx) => {
      const record = await this.ownedLockedVersion(tx, productId, versionId, principal);
      if (!canSubmitProductVersion(record.version.status)) {
        throw ApiException.conflict('PRODUCT_VERSION_NOT_DRAFT', 'Only a draft product version can be submitted for review.');
      }
      await this.insurers.assertVerifiedActiveForProducts(tx, record.product.insurerId);
      this.assertSubmittable(record.version);
      const at = new Date();
      const version = await this.products.updateVersion(tx, versionId, {
        status: 'SUBMITTED',
        submittedByStaffId: principal.id,
        submittedAt: at,
      });
      if (!version) throw ApiException.notFound('Product version', versionId);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'product_version.submitted',
        entityType: 'INSURER_PRODUCT_VERSION',
        entityId: version.id,
        before: { status: record.version.status, versionNumber: record.version.versionNumber },
        after: { status: version.status, versionNumber: version.versionNumber },
        note: 'Insurer administrator submitted product terms for platform review.',
        correlationId: productId,
      });
      return this.toInternalProductVersion(record.product, version);
    });
  }

  async reviewQueue(principal: Principal, status?: ProductVersionStatus) {
    this.require(principal, 'admin:product:read');
    return (await this.products.listForReview(status)).map((record) => this.toAdminVersion(record));
  }

  async approve(productId: string, versionId: string, dto: ApproveProductVersionDto, principal: StaffPrincipal) {
    this.require(principal, 'admin:product:review');
    return this.products.transaction(async (tx) => {
      const record = await this.adminLockedVersion(tx, productId, versionId);
      if (!canApproveProductVersion(record.version.status)) {
        throw ApiException.conflict('PRODUCT_VERSION_NOT_SUBMITTED', 'Only a submitted product version can be approved.');
      }
      await this.insurers.assertVerifiedActiveForProducts(tx, record.product.insurerId);
      const candidate = this.normaliseVersion(dto, record.version);
      this.assertDraftInput(candidate);
      this.assertSubmittable(candidate);
      const at = new Date();
      const version = await this.products.updateVersion(tx, versionId, {
        effectiveFrom: candidate.effectiveFrom,
        effectiveUntil: candidate.effectiveUntil,
        status: 'APPROVED',
        reviewedByStaffId: principal.id,
        reviewedAt: at,
        reviewComment: dto.comment ?? null,
      });
      if (!version) throw ApiException.notFound('Product version', versionId);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'product_version.approved',
        entityType: 'INSURER_PRODUCT_VERSION',
        entityId: version.id,
        before: { status: record.version.status, versionNumber: record.version.versionNumber },
        after: { status: version.status, effectiveFrom: asDay(version.effectiveFrom), effectiveUntil: asDay(version.effectiveUntil) },
        note: dto.comment ?? 'Platform administrator approved the product version.',
        correlationId: productId,
      });
      return this.toAdminVersion({ ...record, version });
    });
  }

  async reject(productId: string, versionId: string, dto: RejectProductVersionDto, principal: StaffPrincipal) {
    this.require(principal, 'admin:product:review');
    return this.products.transaction(async (tx) => {
      const record = await this.adminLockedVersion(tx, productId, versionId);
      if (!canApproveProductVersion(record.version.status)) {
        throw ApiException.conflict('PRODUCT_VERSION_NOT_SUBMITTED', 'Only a submitted product version can be rejected.');
      }
      const at = new Date();
      const version = await this.products.updateVersion(tx, versionId, {
        status: 'REJECTED',
        reviewedByStaffId: principal.id,
        reviewedAt: at,
        reviewComment: dto.comment,
      });
      if (!version) throw ApiException.notFound('Product version', versionId);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'product_version.rejected',
        entityType: 'INSURER_PRODUCT_VERSION',
        entityId: version.id,
        before: { status: record.version.status, versionNumber: record.version.versionNumber },
        after: { status: version.status },
        note: dto.comment,
        correlationId: productId,
      });
      return this.toAdminVersion({ ...record, version });
    });
  }

  async withdraw(productId: string, versionId: string, dto: WithdrawProductVersionDto, principal: StaffPrincipal) {
    this.require(principal, 'admin:product:review');
    return this.products.transaction(async (tx) => {
      const record = await this.adminLockedVersion(tx, productId, versionId);
      if (!canWithdrawProductVersion(record.version.status)) {
        throw ApiException.conflict('PRODUCT_VERSION_NOT_APPROVED', 'Only an approved product version can be withdrawn.');
      }
      const at = new Date();
      const version = await this.products.updateVersion(tx, versionId, {
        status: 'WITHDRAWN',
        withdrawnByStaffId: principal.id,
        withdrawnAt: at,
        withdrawalReason: dto.reason,
      });
      if (!version) throw ApiException.notFound('Product version', versionId);
      await this.audit.write(tx, {
        actor: auditActor(principal),
        action: 'product_version.withdrawn',
        entityType: 'INSURER_PRODUCT_VERSION',
        entityId: version.id,
        before: { status: record.version.status, versionNumber: record.version.versionNumber },
        after: { status: version.status },
        note: dto.reason,
        correlationId: productId,
      });
      return this.toAdminVersion({ ...record, version });
    });
  }

  async directory(query: ProductDirectoryQueryDto) {
    return (await this.products.directory(new Date(), query.coverType, query.limit ?? 100)).map((record) => this.toPublicVersion(record));
  }

  private insurerId(principal: Principal) {
    if (principal.kind !== 'staff' || !isInsurerRole(principal.role) || !principal.insurerId) {
      throw ApiException.forbidden('This account is not linked to an insurer.');
    }
    return principal.insurerId;
  }

  private require(principal: Principal, permission: Permission) {
    if (!holds(principal, permission)) throw ApiException.forbidden();
  }

  private async ownedLockedVersion(tx: Transaction, productId: string, versionId: string, principal: Principal): Promise<VersionRecord> {
    const insurerId = this.insurerId(principal);
    const record = await this.products.lockVersion(tx, productId, versionId);
    if (!record || record.product.insurerId !== insurerId) {
      const product = record?.product ?? (await this.products.findProduct(productId, tx));
      await this.refuseIfForeign(product, principal, productId);
      throw ApiException.notFound('Product version', versionId);
    }
    return record;
  }

  private async adminLockedVersion(tx: Transaction, productId: string, versionId: string): Promise<VersionRecord> {
    const record = await this.products.lockVersion(tx, productId, versionId);
    if (!record) throw ApiException.notFound('Product version', versionId);
    return record;
  }

  private async refuseIfForeign(product: ProductRow | undefined, principal: Principal, productId: string) {
    if (product && principal.kind === 'staff' && product.insurerId !== principal.insurerId) {
      await this.audit.refusal({
        actor: auditActor(principal),
        action: 'product.access_refused',
        entityType: 'INSURER_PRODUCT',
        entityId: productId,
        note: 'Insurer staff attempted to access another insurer’s product.',
        correlationId: productId,
      });
    }
  }

  private normaliseVersion(
    dto: VersionChanges,
    existing: ProductVersionRow | undefined,
  ) {
    const inspectionRule = dto.inspectionRule ?? existing?.inspectionRule;
    const inspectionTiming = inspectionRule === 'NOT_REQUIRED'
      ? null
      : dto.inspectionTiming === undefined ? existing?.inspectionTiming ?? null : dto.inspectionTiming;
    const inspectionMethod = inspectionRule === 'NOT_REQUIRED'
      ? null
      : dto.inspectionMethod === undefined ? existing?.inspectionMethod ?? null : dto.inspectionMethod;
    const currentGuide = existing?.coverGuide ?? {};
    const rawGuide = dto.coverGuide === undefined ? currentGuide : { ...currentGuide, ...dto.coverGuide };
    const checked = checkCoverGuide(rawGuide, false);
    const coverGuide: Record<string, unknown> = { ...checked.guide };
    return {
      name: dto.name ?? existing?.name,
      coverType: existing?.coverType ?? dto.coverType,
      coverGuide,
      coverGuideErrors: checked.errors,
      inspectionRule,
      inspectionTiming,
      inspectionMethod,
      effectiveFrom: dto.effectiveFrom === undefined ? existing?.effectiveFrom : calendarDate(dto.effectiveFrom),
      effectiveUntil: dto.effectiveUntil === undefined
        ? existing?.effectiveUntil ?? null
        : dto.effectiveUntil === null ? null : calendarDate(dto.effectiveUntil),
    };
  }

  private assertDraftInput(candidate: NormalisedVersion): asserts candidate is CompleteProductVersion {
    const errors: Record<string, string> = { ...candidate.coverGuideErrors };
    if (!candidate.name) errors.name = 'Enter a product name.';
    if (!candidate.coverType) errors.coverType = 'Choose a cover type.';
    if (!candidate.inspectionRule) errors.inspectionRule = 'Choose whether an inspection is required.';
    if (!candidate.effectiveFrom) errors.effectiveFrom = 'Choose an effective-from date.';
    Object.assign(errors, candidate.inspectionRule ? inspectionErrors(candidate.inspectionRule, candidate.inspectionTiming, candidate.inspectionMethod) : {});
    if (candidate.effectiveFrom && candidate.effectiveUntil && candidate.effectiveUntil < candidate.effectiveFrom) {
      errors.effectiveUntil = 'The end date cannot be before the start date.';
    }
    if (Object.keys(errors).length) throw new ApiException('PRODUCT_DRAFT_INVALID', 'Correct the highlighted product fields.', 400, errors);
  }

  private assertSubmittable(version: Pick<ProductVersionRow, 'name' | 'coverType' | 'coverGuide' | 'inspectionRule' | 'inspectionTiming' | 'inspectionMethod' | 'effectiveFrom' | 'effectiveUntil'> | CompleteProductVersion) {
    const checked = checkCoverGuide(version.coverGuide, true);
    const errors: Record<string, string> = {
      ...checked.errors,
      ...inspectionErrors(version.inspectionRule, version.inspectionTiming, version.inspectionMethod),
    };
    if (version.effectiveUntil && version.effectiveUntil < version.effectiveFrom) errors.effectiveUntil = 'The end date cannot be before the start date.';
    if (Object.keys(errors).length) throw new ApiException('PRODUCT_VERSION_INCOMPLETE', 'Complete the product terms before submitting them for review.', 400, errors);
  }

  private toInternalProductVersion(product: ProductRow, version: ProductVersionRow) {
    return { product: { id: product.id, code: product.code, coverType: product.coverType }, ...this.toInternalVersion(version) };
  }

  private toInternalVersion(version: ProductVersionRow): InternalVersion {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      name: version.name,
      coverType: version.coverType,
      coverGuide: checkCoverGuide(version.coverGuide, false).guide,
      inspection: { rule: version.inspectionRule, timing: version.inspectionTiming, method: version.inspectionMethod },
      effectiveFrom: asDay(version.effectiveFrom)!,
      effectiveUntil: asDay(version.effectiveUntil),
      submittedAt: version.submittedAt?.toISOString() ?? null,
      reviewedAt: version.reviewedAt?.toISOString() ?? null,
      reviewComment: version.reviewComment,
      withdrawnAt: version.withdrawnAt?.toISOString() ?? null,
      withdrawalReason: version.withdrawalReason,
      createdAt: version.createdAt.toISOString(),
      updatedAt: version.updatedAt.toISOString(),
    };
  }

  private toAdminVersion(record: VersionRecord) {
    return {
      insurer: record.insurer,
      ...this.toInternalProductVersion(record.product, record.version),
      createdByStaffId: record.version.createdByStaffId,
      submittedByStaffId: record.version.submittedByStaffId,
      reviewedByStaffId: record.version.reviewedByStaffId,
      withdrawnByStaffId: record.version.withdrawnByStaffId,
    };
  }

  private toPublicVersion(record: VersionRecord) {
    return {
      insurer: record.insurer,
      product: { id: record.product.id, code: record.product.code, coverType: record.product.coverType },
      version: {
        id: record.version.id,
        number: record.version.versionNumber,
        name: record.version.name,
        coverType: record.version.coverType,
        coverGuide: checkCoverGuide(record.version.coverGuide, false).guide as CoverGuide,
        inspection: { rule: record.version.inspectionRule, timing: record.version.inspectionTiming, method: record.version.inspectionMethod },
        effectiveFrom: asDay(record.version.effectiveFrom),
        effectiveUntil: asDay(record.version.effectiveUntil),
      },
    };
  }

  private isUniqueProductCode(error: unknown) {
    return isUniqueViolation(error, PRODUCT_CODE_CONSTRAINT);
  }
}
