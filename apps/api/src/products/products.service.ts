import { Injectable } from '@nestjs/common';
import { isInsurerRole, type ComparisonDisplayRule, type ComparisonTaxonomyCategory, type ComparisonValueType, type CoverageDuration, type InspectionMethod, type InspectionRule, type InspectionTiming, type InsuranceType, type ProductVersionStatus } from '../common/domain/enums.js';
import { holds, type Permission } from '../common/auth/permissions.js';
import { AuditService } from '../common/audit/audit.service.js';
import { auditActor } from '../common/audit/audit.types.js';
import type { Principal } from '../common/auth/auth.types.js';
import { ApiException } from '../common/errors/api.exception.js';
import { InsurersService } from '../insurers/insurers.service.js';
import { PiaService } from '../pia/pia.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  ApproveProductVersionDto,
  type ComparisonItemInputDto,
  CreateProductDto,
  type ProductDirectoryQueryDto,
  type ProductEstimateQueryDto,
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
import { kwachaToNgwee, ngweeToKwacha } from '../common/money.js';
import { usageLoadingBps } from '../settings/domain/rules.js';
import { estimateProductPremiumMinor } from './domain/product-estimate.js';

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
  rateBps: number;
  showEstimate: boolean;
  allowedDurations: CoverageDuration[];
  comparisonItems: ProductComparisonItem[];
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
type ProductComparisonItem = {
  taxonomyItemId: string;
  taxonomyVersion: number;
  code: string;
  label: string;
  description: string | null;
  category: ComparisonTaxonomyCategory;
  dataType: ComparisonValueType;
  unit: string | null;
  allowedValues: string[];
  displayRule: ComparisonDisplayRule;
  included: boolean;
  valueText: string | null;
};
type VersionChanges = {
  name?: string;
  /** Present only when the durable product and its first version are created. */
  coverType?: InsuranceType;
  coverGuide?: Record<string, unknown>;
  inspectionRule?: InspectionRule;
  inspectionTiming?: InspectionTiming | null;
  inspectionMethod?: InspectionMethod | null;
  rateBps?: number;
  showEstimate?: boolean;
  allowedDurations?: CoverageDuration[];
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
  rateBps: number | undefined;
  showEstimate: boolean;
  allowedDurations: CoverageDuration[] | undefined;
  effectiveFrom: Date | undefined;
  effectiveUntil: Date | null;
};
type CompleteProductVersion = Omit<NormalisedVersion, 'name' | 'coverType' | 'inspectionRule' | 'effectiveFrom' | 'rateBps' | 'allowedDurations'> & {
  name: string;
  coverType: InsuranceType;
  inspectionRule: InspectionRule;
  effectiveFrom: Date;
  rateBps: number;
  allowedDurations: CoverageDuration[];
};

const PRODUCT_CODE_CONSTRAINT = 'insurer_products_insurerId_code_key';

@Injectable()
export class ProductsService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly insurers: InsurersService,
    private readonly audit: AuditService,
    private readonly pia: PiaService,
    private readonly settings: SettingsService,
  ) {}

  async listOwn(principal: Principal) {
    this.require(principal, 'product:read-own');
    const insurerId = this.insurerId(principal);
    const records = await this.products.listForInsurer(insurerId);
    const grouped = new Map<string, { id: string; code: string; coverType: InsuranceType; createdAt: string; updatedAt: string; versions: InternalVersion[] }>();
    const comparisons = await this.comparisonsFor(records);
    for (const record of records) {
      const product = grouped.get(record.product.id) ?? {
        id: record.product.id,
        code: record.product.code,
        coverType: record.product.coverType,
        createdAt: record.product.createdAt.toISOString(),
        updatedAt: record.product.updatedAt.toISOString(),
        versions: [],
      };
      if (record.version) product.versions.push(this.toInternalVersion(record.version, comparisons.get(record.version.id)));
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
    const comparisons = await this.comparisonsFor(records);
    return {
      id: product.id,
      code: product.code,
      coverType: product.coverType,
      createdAt: product.createdAt.toISOString(),
      updatedAt: product.updatedAt.toISOString(),
      versions: records.flatMap((row) => (row.version ? [this.toInternalVersion(row.version, comparisons.get(row.version.id))] : [])),
    };
  }

  /** Active, platform-owned terms an insurer can map into a product draft. */
  async activeComparisonTaxonomy(principal: Principal) {
    this.require(principal, 'product:read-own');
    this.insurerId(principal);
    return this.settings.activeTaxonomy();
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
        const comparisonItems = await this.saveComparisonItems(tx, version.id, dto.comparisonItems ?? []);
        await this.audit.write(tx, {
          actor: auditActor(principal),
          action: 'product.created',
          entityType: 'INSURER_PRODUCT',
          entityId: product.id,
          after: { code: product.code, versionNumber: version.versionNumber, status: version.status, coverType: version.coverType },
          note: 'Insurer administrator created a product draft.',
          correlationId: product.id,
        });
        return this.toInternalProductVersion(product, version, comparisonItems);
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
      const comparisonItems = dto.comparisonItems === undefined
        ? await this.comparisonItems(version.id, tx)
        : await this.saveComparisonItems(tx, version.id, dto.comparisonItems);
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
      return this.toInternalProductVersion(record.product, version, comparisonItems);
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
        rateBps: source.version.rateBps,
        showEstimate: source.version.showEstimate,
        allowedDurations: source.version.allowedDurations,
        effectiveFrom: source.version.effectiveFrom,
        effectiveUntil: source.version.effectiveUntil,
        createdByStaffId: principal.id,
      });
      await this.products.copyComparisonItems(tx, source.version.id, version.id);
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
      return this.toInternalProductVersion(product, version, await this.comparisonItems(version.id, tx));
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
      await this.assertSubmittable(record.version, tx);
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
      return this.toInternalProductVersion(record.product, version, await this.comparisonItems(version.id, tx));
    });
  }

  async reviewQueue(principal: Principal, status?: ProductVersionStatus) {
    this.require(principal, 'admin:product:read');
    const records = await this.products.listForReview(status);
    const comparisons = await this.comparisonsFor(records);
    return records.map((record) => this.toAdminVersion(record, comparisons.get(record.version.id)));
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
      await this.assertSubmittable(record.version, tx);
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
      return this.toAdminVersion({ ...record, version }, await this.comparisonItems(version.id, tx));
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
      return this.toAdminVersion({ ...record, version }, await this.comparisonItems(version.id, tx));
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
      return this.toAdminVersion({ ...record, version }, await this.comparisonItems(version.id, tx));
    });
  }

  async directory(query: ProductDirectoryQueryDto) {
    const records = await this.products.directory(new Date(), query.coverType, query.limit ?? 100);
    const comparisons = await this.comparisonsFor(records);
    return records.map((record) => this.toPublicVersion(record, comparisons.get(record.version.id)));
  }

  async estimate(productId: string, versionId: string, query: ProductEstimateQueryDto) {
    const [record, usage] = await Promise.all([
      this.products.directory(new Date(), undefined, 1, productId, versionId).then((records) => records[0]),
      this.settings.effective('USAGE_LOADINGS'),
    ]);
    if (!record) throw ApiException.notFound('Product version', versionId);
    if (!record.version.showEstimate) {
      throw ApiException.conflict('PRODUCT_ESTIMATE_UNAVAILABLE', 'This insurer has not enabled an estimate for this product.');
    }
    if (!record.version.allowedDurations.includes(query.coverageDuration)) {
      throw new ApiException('PRODUCT_DURATION_UNAVAILABLE', 'This product is not offered for the selected cover period.', 400, { coverageDuration: query.coverageDuration });
    }
    let vehicleValueMinor: number;
    try {
      vehicleValueMinor = kwachaToNgwee(query.vehicleValue);
    } catch {
      throw new ApiException('ESTIMATE_VALUE_INVALID', 'Enter a valid vehicle value for an estimate.', 400, { vehicleValue: 'Enter a valid amount.' });
    }
    const piaRateBps = await this.pia.currentRateBps();
    const loadingBps = usageLoadingBps(usage.value, query.vehicleUsage);
    const calculation = estimateProductPremiumMinor(
      vehicleValueMinor,
      record.version.rateBps,
      loadingBps,
      piaRateBps,
      query.coverageDuration,
    );
    return {
      insurer: record.insurer,
      product: { id: record.product.id, code: record.product.code, name: record.version.name, coverType: record.version.coverType },
      versionId: record.version.id,
      coverageDuration: query.coverageDuration,
      vehicleValue: query.vehicleValue,
      vehicleUsage: query.vehicleUsage,
      estimatedPremium: ngweeToKwacha(calculation.premiumMinor),
      currency: 'ZMW',
      floorApplied: calculation.floorApplied,
      provisionalInputs: usage.provisional,
      notice: 'This is an estimate. The insurer confirms the final premium after reviewing your request.',
    };
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
      rateBps: dto.rateBps ?? existing?.rateBps,
      showEstimate: dto.showEstimate ?? existing?.showEstimate ?? false,
      allowedDurations: dto.allowedDurations ?? existing?.allowedDurations,
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
    if (candidate.rateBps === undefined) errors.rateBps = 'Enter the product rate.';
    if (!candidate.allowedDurations?.length) errors.allowedDurations = 'Choose at least one available cover period.';
    if (!candidate.effectiveFrom) errors.effectiveFrom = 'Choose an effective-from date.';
    Object.assign(errors, candidate.inspectionRule ? inspectionErrors(candidate.inspectionRule, candidate.inspectionTiming, candidate.inspectionMethod) : {});
    if (candidate.effectiveFrom && candidate.effectiveUntil && candidate.effectiveUntil < candidate.effectiveFrom) {
      errors.effectiveUntil = 'The end date cannot be before the start date.';
    }
    if (Object.keys(errors).length) throw new ApiException('PRODUCT_DRAFT_INVALID', 'Correct the highlighted product fields.', 400, errors);
  }

  private async assertSubmittable(version: Pick<ProductVersionRow, 'id' | 'name' | 'coverType' | 'coverGuide' | 'inspectionRule' | 'inspectionTiming' | 'inspectionMethod' | 'rateBps' | 'allowedDurations' | 'effectiveFrom' | 'effectiveUntil'> | CompleteProductVersion, tx: Transaction) {
    const checked = checkCoverGuide(version.coverGuide, true);
    const errors: Record<string, string> = {
      ...checked.errors,
      ...inspectionErrors(version.inspectionRule, version.inspectionTiming, version.inspectionMethod),
    };
    if (version.effectiveUntil && version.effectiveUntil < version.effectiveFrom) errors.effectiveUntil = 'The end date cannot be before the start date.';
    if (!version.allowedDurations.length) errors.allowedDurations = 'Choose at least one available cover period.';
    if ('id' in version) {
      const [activeTaxonomy, mappings] = await Promise.all([this.settings.activeTaxonomy(tx), this.comparisonItems(version.id, tx)]);
      const mapped = new Set(mappings.map((item) => item.taxonomyItemId));
      const missing = activeTaxonomy.filter((item) => !mapped.has(item.id));
      if (missing.length) errors.comparisonItems = `Map every active comparison term before submission: ${missing.map((item) => item.label).join(', ')}.`;
    }
    if (Object.keys(errors).length) throw new ApiException('PRODUCT_VERSION_INCOMPLETE', 'Complete the product terms before submitting them for review.', 400, errors);
  }

  private toInternalProductVersion(product: ProductRow, version: ProductVersionRow, comparisonItems: ProductComparisonItem[] = []) {
    return { product: { id: product.id, code: product.code, coverType: product.coverType }, ...this.toInternalVersion(version, comparisonItems) };
  }

  private toInternalVersion(version: ProductVersionRow, comparisonItems: ProductComparisonItem[] = []): InternalVersion {
    return {
      id: version.id,
      versionNumber: version.versionNumber,
      status: version.status,
      name: version.name,
      coverType: version.coverType,
      coverGuide: checkCoverGuide(version.coverGuide, false).guide,
      inspection: { rule: version.inspectionRule, timing: version.inspectionTiming, method: version.inspectionMethod },
      rateBps: version.rateBps,
      showEstimate: version.showEstimate,
      allowedDurations: version.allowedDurations,
      comparisonItems,
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

  private toAdminVersion(record: VersionRecord, comparisonItems: ProductComparisonItem[] = []) {
    return {
      insurer: record.insurer,
      ...this.toInternalProductVersion(record.product, record.version, comparisonItems),
      createdByStaffId: record.version.createdByStaffId,
      submittedByStaffId: record.version.submittedByStaffId,
      reviewedByStaffId: record.version.reviewedByStaffId,
      withdrawnByStaffId: record.version.withdrawnByStaffId,
    };
  }

  private toPublicVersion(record: VersionRecord, comparisonItems: ProductComparisonItem[] = []) {
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
        showEstimate: record.version.showEstimate,
        allowedDurations: record.version.allowedDurations,
        comparisonItems,
        effectiveFrom: asDay(record.version.effectiveFrom),
        effectiveUntil: asDay(record.version.effectiveUntil),
      },
    };
  }

  private isUniqueProductCode(error: unknown) {
    return isUniqueViolation(error, PRODUCT_CODE_CONSTRAINT);
  }

  private async comparisonsFor(records: Array<{ version: ProductVersionRow | null }>): Promise<Map<string, ProductComparisonItem[]>> {
    const rows = await this.products.comparisonItemsForVersions(records.flatMap((record) => record.version ? [record.version.id] : []));
    const result = new Map<string, ProductComparisonItem[]>();
    for (const { mapping } of rows) {
      const items = result.get(mapping.productVersionId) ?? [];
      items.push(this.toComparisonItem(mapping));
      result.set(mapping.productVersionId, items);
    }
    return result;
  }

  private async comparisonItems(versionId: string, tx: Transaction): Promise<ProductComparisonItem[]> {
    const rows = await this.products.comparisonItemsForVersions([versionId], tx);
    return rows.map(({ mapping }) => this.toComparisonItem(mapping));
  }

  private async saveComparisonItems(tx: Transaction, versionId: string, inputs: ComparisonItemInputDto[]): Promise<ProductComparisonItem[]> {
    const ids = inputs.map((item) => item.taxonomyItemId);
    if (new Set(ids).size !== ids.length) throw new ApiException('PRODUCT_COMPARISON_DUPLICATE', 'Use each comparison item only once.');
    const taxonomy = await this.products.activeTaxonomyForIds(tx, ids);
    if (taxonomy.length !== ids.length) throw new ApiException('PRODUCT_COMPARISON_ITEM_UNAVAILABLE', 'One or more comparison items are no longer available.');
    const byId = new Map(taxonomy.map((item) => [item.id, item]));
    await this.products.replaceComparisonItems(tx, versionId, inputs.map((item) => {
      const term = byId.get(item.taxonomyItemId)!;
      const valueText = item.valueText?.trim() || null;
      this.assertComparisonValue(term, valueText);
      return {
        taxonomyItemId: term.id,
        taxonomyVersion: term.versionNumber,
        taxonomyCode: term.code,
        taxonomyLabel: term.label,
        taxonomyDescription: term.description,
        taxonomyCategory: term.category,
        taxonomyDataType: term.dataType,
        taxonomyUnit: term.unit,
        taxonomyAllowedValues: term.allowedValues,
        taxonomyDisplayRule: term.displayRule,
        included: item.included ?? true,
        valueText,
      };
    }));
    return this.comparisonItems(versionId, tx);
  }

  private toComparisonItem(mapping: Awaited<ReturnType<ProductsRepository['comparisonItemsForVersions']>>[number]['mapping']): ProductComparisonItem {
    return {
      taxonomyItemId: mapping.taxonomyItemId,
      taxonomyVersion: mapping.taxonomyVersion,
      code: mapping.taxonomyCode,
      label: mapping.taxonomyLabel,
      description: mapping.taxonomyDescription,
      category: mapping.taxonomyCategory,
      dataType: mapping.taxonomyDataType,
      unit: mapping.taxonomyUnit,
      allowedValues: mapping.taxonomyAllowedValues,
      displayRule: mapping.taxonomyDisplayRule,
      included: mapping.included,
      valueText: mapping.valueText,
    };
  }

  private assertComparisonValue(
    term: Awaited<ReturnType<ProductsRepository['activeTaxonomyForIds']>>[number],
    valueText: string | null,
  ) {
    if (!valueText) return;
    if ((term.dataType === 'NUMBER' || term.dataType === 'CURRENCY') && !/^\d+(?:\.\d{1,2})?$/.test(valueText)) {
      throw new ApiException('PRODUCT_COMPARISON_VALUE_INVALID', `${term.label} needs a numeric value.`);
    }
    if (term.dataType === 'BOOLEAN' && !/^(yes|no|true|false)$/i.test(valueText)) {
      throw new ApiException('PRODUCT_COMPARISON_VALUE_INVALID', `${term.label} must be Yes or No.`);
    }
    if (term.dataType === 'LIST' && !term.allowedValues.some((value) => value.localeCompare(valueText, 'en-ZM', { sensitivity: 'accent' }) === 0)) {
      throw new ApiException('PRODUCT_COMPARISON_VALUE_INVALID', `${term.label} must use one of the platform's allowed values.`);
    }
  }
}
