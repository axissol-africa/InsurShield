import { Injectable } from '@nestjs/common';
import type { Principal } from '../common/auth/auth.types.js';
import { holds, type Permission } from '../common/auth/permissions.js';
import { auditActor } from '../common/audit/audit.types.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { isUniqueViolation } from '../db/errors.js';
import type { Transaction } from '../db/database.module.js';
import { lusakaDay } from '../common/domain/lusaka.js';
import type { ComparisonDisplayRule, ComparisonTaxonomyCategory, ComparisonTaxonomyStatus, ComparisonValueType, RuleSettingKey } from '../common/domain/enums.js';
import { COMPARISON_DISPLAY_RULES, COMPARISON_TAXONOMY_CATEGORIES, COMPARISON_TAXONOMY_STATUSES, COMPARISON_VALUE_TYPES } from '../common/domain/enums.js';
import { calendarDay, defaultRuleValue, isRuleSettingKey, parseRuleValue, type RuleValueFor } from './domain/rules.js';
import { SettingsRepository, type RuleVersionRow } from './settings.repository.js';
import type { CreateRuleVersionDto, CreateTaxonomyItemDto, UpdateTaxonomyItemDto } from './dto/settings.dto.js';

type StaffPrincipal = Extract<Principal, { kind: 'staff' }>;

@Injectable()
export class SettingsService {
  constructor(private readonly settings: SettingsRepository, private readonly audit: AuditService) {}

  async listRules(principal: Principal) {
    this.require(principal, 'admin:rule:read');
    return (await this.settings.listRuleVersions()).map((row) => this.toRule(row));
  }

  async ruleHistory(keyText: string, principal: Principal) {
    this.require(principal, 'admin:rule:read');
    const key = this.key(keyText);
    return (await this.settings.listRuleVersions(key)).map((row) => this.toRule(row));
  }

  async addProvisional(keyText: string, dto: CreateRuleVersionDto, principal: StaffPrincipal) {
    this.require(principal, 'admin:rule:manage');
    const key = this.key(keyText);
    this.assertNotPiaDirectEdit(key);
    const value = this.value(key, dto.value);
    const effectiveFrom = this.date(dto.effectiveFrom, 'effectiveFrom');
    const effectiveUntil = dto.effectiveUntil === undefined ? null : this.date(dto.effectiveUntil, 'effectiveUntil');
    this.assertWindow(effectiveFrom, effectiveUntil);
    return this.settings.transaction(async (tx) => {
      const prior = await this.settings.lockRuleVersions(tx, key);
      const version = await this.settings.createRuleVersion(tx, {
        key,
        versionNumber: (prior[0]?.versionNumber ?? 0) + 1,
        state: 'PROVISIONAL',
        value,
        effectiveFrom,
        effectiveUntil,
        createdByStaffId: principal.id,
      });
      await this.audit.write(tx, {
        actor: auditActor(principal), action: 'rule_version.provisional_created', entityType: 'PLATFORM_RULE', entityId: version.id,
        after: { key, versionNumber: version.versionNumber, state: version.state, effectiveFrom: dto.effectiveFrom, effectiveUntil: dto.effectiveUntil ?? null },
        note: dto.note ?? 'Administrator added a provisional platform rule.', correlationId: key,
      });
      return this.toRule(version);
    });
  }

  /** Confirmation copies the immutable payload into its own confirmed version. */
  async confirm(keyText: string, versionId: string, principal: StaffPrincipal) {
    this.require(principal, 'admin:rule:confirm');
    const key = this.key(keyText);
    this.assertNotPiaDirectEdit(key);
    return this.settings.transaction(async (tx) => {
      const prior = await this.settings.lockRuleVersions(tx, key);
      const candidate = await this.settings.findRuleVersion(tx, key, versionId);
      if (!candidate) throw ApiException.notFound('Rule version', versionId);
      if (candidate.state !== 'PROVISIONAL') {
        throw ApiException.conflict('RULE_VERSION_NOT_PROVISIONAL', 'Only a provisional rule version can be confirmed.');
      }
      const version = await this.settings.createRuleVersion(tx, {
        key,
        versionNumber: (prior[0]?.versionNumber ?? 0) + 1,
        state: 'CONFIRMED',
        value: candidate.value,
        effectiveFrom: candidate.effectiveFrom,
        effectiveUntil: candidate.effectiveUntil,
        createdByStaffId: candidate.createdByStaffId,
        confirmedByStaffId: principal.id,
        confirmedAt: new Date(),
      });
      await this.audit.write(tx, {
        actor: auditActor(principal), action: 'rule_version.confirmed', entityType: 'PLATFORM_RULE', entityId: version.id,
        before: { sourceVersionId: candidate.id, sourceVersionNumber: candidate.versionNumber, state: candidate.state },
        after: { key, versionNumber: version.versionNumber, state: version.state },
        note: 'Administrator confirmed a provisional platform rule.', correlationId: key,
      });
      return this.toRule(version);
    });
  }

  /** The PIA executor owns the maker/checker decision, then records this compatible settings snapshot. */
  async recordConfirmedPiaFloor(tx: Transaction, rateBps: number, principal: StaffPrincipal, correlationId: string) {
    const prior = await this.settings.lockRuleVersions(tx, 'PIA_FLOOR');
    const latest = prior[0];
    if (latest?.state === 'CONFIRMED' && this.value('PIA_FLOOR', latest.value).rateBps === rateBps) return latest;
    const today = this.date(lusakaDay(new Date()), 'effectiveFrom');
    const version = await this.settings.createRuleVersion(tx, {
      key: 'PIA_FLOOR', versionNumber: (latest?.versionNumber ?? 0) + 1, state: 'CONFIRMED', value: { rateBps },
      effectiveFrom: today, effectiveUntil: null, createdByStaffId: principal.id, confirmedByStaffId: principal.id, confirmedAt: new Date(),
    });
    await this.audit.write(tx, {
      actor: auditActor(principal), action: 'rule_version.pia_floor_confirmed', entityType: 'PLATFORM_RULE', entityId: version.id,
      after: { key: 'PIA_FLOOR', versionNumber: version.versionNumber, rateBps },
      note: 'The approved PIA floor was recorded as a confirmed platform rule.', correlationId,
    });
    return version;
  }

  async effective<Key extends RuleSettingKey>(key: Key, now = new Date(), tx?: Transaction): Promise<{ value: RuleValueFor<Key>; provisional: boolean; version: number | null }> {
    const day = this.date(lusakaDay(now), 'today');
    const confirmed = await this.settings.effectiveRule(key, day, 'CONFIRMED', tx);
    if (confirmed) return { value: this.value(key, confirmed.value), provisional: false, version: confirmed.versionNumber };
    const provisional = await this.settings.effectiveRule(key, day, 'PROVISIONAL', tx);
    if (provisional) return { value: this.value(key, provisional.value), provisional: true, version: provisional.versionNumber };
    return { value: defaultRuleValue(key) as RuleValueFor<Key>, provisional: true, version: null };
  }

  async listTaxonomy(principal: Principal, includeDisabled = true) {
    this.require(principal, 'admin:taxonomy:read');
    return (await this.settings.listTaxonomy()).filter((item) => includeDisabled || item.status === 'ACTIVE').map(this.toTaxonomy);
  }

  /**
   * Insurer product editors need the active vocabulary to create a mapping.
   * This deliberately does not expose disabled terms or staff audit fields.
   */
  async activeTaxonomy(tx?: Transaction) {
    return (await this.settings.listTaxonomy('ACTIVE', tx)).map(this.toTaxonomy);
  }

  async createTaxonomy(dto: CreateTaxonomyItemDto, principal: StaffPrincipal) {
    this.require(principal, 'admin:taxonomy:manage');
    const category = this.taxonomyCategory(dto.category);
    const dataType = this.taxonomyDataType(dto.dataType);
    const allowedValues = this.allowedValues(dto.allowedValues);
    const displayRule = this.displayRule(dto.displayRule);
    this.assertTaxonomyShape(dataType, dto.unit, allowedValues);
    const code = dto.code.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(code)) throw new ApiException('TAXONOMY_CODE_INVALID', 'Use 2–80 uppercase letters, numbers or underscores for the comparison code.');
    if (!dto.label.trim()) throw new ApiException('TAXONOMY_LABEL_REQUIRED', 'Enter a comparison label.');
    try {
      return await this.settings.transaction(async (tx) => {
        const item = await this.settings.createTaxonomy(tx, {
          code, label: dto.label.trim(), description: dto.description?.trim() || null, category, dataType,
          unit: dto.unit?.trim() || null, allowedValues, displayRule,
          displayOrder: Number.isInteger(dto.displayOrder) ? dto.displayOrder : 0, createdByStaffId: principal.id,
        });
        await this.audit.write(tx, {
          actor: auditActor(principal), action: 'comparison_taxonomy.created', entityType: 'COMPARISON_TAXONOMY', entityId: item.id,
          after: { code: item.code, category: item.category, dataType: item.dataType, status: item.status, versionNumber: item.versionNumber }, note: 'Administrator created a comparison taxonomy item.', correlationId: item.id,
        });
        return this.toTaxonomy(item);
      });
    } catch (error) {
      if (isUniqueViolation(error, 'comparison_taxonomy_items_code_key')) throw ApiException.conflict('TAXONOMY_CODE_EXISTS', 'That comparison code already exists.');
      throw error;
    }
  }

  async updateTaxonomy(id: string, dto: UpdateTaxonomyItemDto, principal: StaffPrincipal) {
    this.require(principal, 'admin:taxonomy:manage');
    return this.settings.transaction(async (tx) => {
      const existing = await this.settings.lockTaxonomy(tx, id);
      if (!existing) throw ApiException.notFound('Comparison taxonomy item', id);
      const category = dto.category === undefined ? existing.category : this.taxonomyCategory(dto.category);
      const dataType = dto.dataType === undefined ? existing.dataType : this.taxonomyDataType(dto.dataType);
      const allowedValues = dto.allowedValues === undefined ? existing.allowedValues : this.allowedValues(dto.allowedValues);
      const unit = dto.unit === undefined ? existing.unit : dto.unit?.trim() || null;
      const displayRule = dto.displayRule === undefined ? existing.displayRule : this.displayRule(dto.displayRule);
      const status = dto.status === undefined ? existing.status : this.taxonomyStatus(dto.status);
      this.assertTaxonomyShape(dataType, unit, allowedValues);
      const item = await this.settings.updateTaxonomy(tx, id, {
        label: dto.label === undefined ? existing.label : dto.label.trim(),
        description: dto.description === undefined ? existing.description : dto.description?.trim() || null,
        category, dataType, unit, allowedValues, displayRule, status,
        versionNumber: existing.versionNumber + 1,
        displayOrder: dto.displayOrder === undefined ? existing.displayOrder : dto.displayOrder,
        updatedByStaffId: principal.id,
      });
      if (!item) throw ApiException.notFound('Comparison taxonomy item', id);
      await this.audit.write(tx, {
        actor: auditActor(principal), action: 'comparison_taxonomy.updated', entityType: 'COMPARISON_TAXONOMY', entityId: item.id,
        before: { category: existing.category, dataType: existing.dataType, status: existing.status, versionNumber: existing.versionNumber, displayOrder: existing.displayOrder },
        after: { category: item.category, dataType: item.dataType, status: item.status, versionNumber: item.versionNumber, displayOrder: item.displayOrder }, note: 'Administrator updated a comparison taxonomy item.', correlationId: item.id,
      });
      return this.toTaxonomy(item);
    });
  }

  private key(value: string): RuleSettingKey {
    if (!isRuleSettingKey(value)) throw ApiException.notFound('Rule setting', value);
    return value;
  }

  private assertNotPiaDirectEdit(key: RuleSettingKey) {
    if (key === 'PIA_FLOOR') {
      throw ApiException.conflict('PIA_FLOOR_REQUIRES_APPROVAL', 'Use the PIA rate approval process for a minimum-rate change.');
    }
  }

  private value<Key extends RuleSettingKey>(key: Key, value: unknown): RuleValueFor<Key> {
    const parsed = parseRuleValue(key, value);
    if ('errors' in parsed) throw new ApiException('RULE_VALUE_INVALID', 'Correct the rule value before saving it.', 400, parsed.errors);
    return parsed.value as RuleValueFor<Key>;
  }

  private date(value: string, field: string): Date {
    const date = calendarDay(value);
    if (!date) throw new ApiException('RULE_DATE_INVALID', `${field} must be a calendar date.`, 400, { [field]: 'Enter a valid calendar date.' });
    return date;
  }

  private assertWindow(from: Date, until: Date | null) {
    if (until && until < from) throw new ApiException('RULE_DATE_RANGE_INVALID', 'The end date cannot be before the start date.', 400, { effectiveUntil: 'Choose a date on or after the start date.' });
  }

  private require(principal: Principal, permission: Permission) {
    if (!holds(principal, permission)) throw ApiException.forbidden();
  }

  private taxonomyCategory(value: string): ComparisonTaxonomyCategory {
    if (!(COMPARISON_TAXONOMY_CATEGORIES as readonly string[]).includes(value)) throw new ApiException('TAXONOMY_CATEGORY_INVALID', 'Choose a valid comparison category.');
    return value as ComparisonTaxonomyCategory;
  }

  private taxonomyStatus(value: string): ComparisonTaxonomyStatus {
    if (!(COMPARISON_TAXONOMY_STATUSES as readonly string[]).includes(value)) throw new ApiException('TAXONOMY_STATUS_INVALID', 'Choose a valid comparison status.');
    return value as ComparisonTaxonomyStatus;
  }

  private taxonomyDataType(value: string): ComparisonValueType {
    if (!(COMPARISON_VALUE_TYPES as readonly string[]).includes(value)) throw new ApiException('TAXONOMY_DATA_TYPE_INVALID', 'Choose a valid comparison value type.');
    return value as ComparisonValueType;
  }

  private displayRule(value: string | undefined): ComparisonDisplayRule {
    const candidate = value ?? 'SHOW_WHEN_PROVIDED';
    if (!(COMPARISON_DISPLAY_RULES as readonly string[]).includes(candidate)) throw new ApiException('TAXONOMY_DISPLAY_RULE_INVALID', 'Choose a valid comparison display rule.');
    return candidate as ComparisonDisplayRule;
  }

  private allowedValues(values: string[] | undefined) {
    const normalised = (values ?? []).map((value) => value.trim()).filter(Boolean);
    if (new Set(normalised.map((value) => value.toLocaleLowerCase('en-ZM'))).size !== normalised.length) {
      throw new ApiException('TAXONOMY_ALLOWED_VALUES_DUPLICATE', 'Each allowed comparison value must be unique.');
    }
    return normalised;
  }

  private assertTaxonomyShape(dataType: ComparisonValueType, unit: string | null | undefined, allowedValues: string[]) {
    if (dataType !== 'LIST' && allowedValues.length) throw new ApiException('TAXONOMY_ALLOWED_VALUES_UNSUPPORTED', 'Allowed values are only used for a list comparison field.');
    if (dataType === 'LIST' && allowedValues.length === 0) throw new ApiException('TAXONOMY_ALLOWED_VALUES_REQUIRED', 'Add at least one allowed value for a list comparison field.');
    if (dataType === 'BOOLEAN' && unit) throw new ApiException('TAXONOMY_UNIT_UNSUPPORTED', 'A yes/no comparison field cannot have a unit.');
  }

  private toRule(row: RuleVersionRow) {
    return {
      id: row.id, key: row.key, versionNumber: row.versionNumber, state: row.state, value: this.value(row.key, row.value),
      effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10), effectiveUntil: row.effectiveUntil?.toISOString().slice(0, 10) ?? null,
      createdByStaffId: row.createdByStaffId, confirmedByStaffId: row.confirmedByStaffId, confirmedAt: row.confirmedAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString(),
    };
  }

  private toTaxonomy = (row: Awaited<ReturnType<SettingsRepository['listTaxonomy']>>[number]) => ({
    id: row.id, code: row.code, label: row.label, description: row.description, category: row.category,
    versionNumber: row.versionNumber, dataType: row.dataType, unit: row.unit, allowedValues: row.allowedValues, displayRule: row.displayRule, status: row.status,
    displayOrder: row.displayOrder, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  });
}
