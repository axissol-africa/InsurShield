import { Transform } from 'class-transformer';
import { ArrayUnique, IsArray, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateBy } from 'class-validator';
import { isISO8601 } from 'class-validator';
import { COMPARISON_DISPLAY_RULES, COMPARISON_TAXONOMY_CATEGORIES, COMPARISON_TAXONOMY_STATUSES, COMPARISON_VALUE_TYPES, RULE_SETTING_KEYS } from '../../common/domain/enums.js';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CalendarDay = (label: string) => ValidateBy({
  name: 'calendarDay',
  validator: {
    validate: (value: unknown) => typeof value === 'string' && CALENDAR_DAY.test(value) && isISO8601(value, { strict: true }),
    defaultMessage: () => `${label} must be a calendar date such as 2026-12-01.`,
  },
});
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRuleVersionDto {
  @IsObject() value!: Record<string, unknown>;
  @CalendarDay('Effective from') effectiveFrom!: string;
  @IsOptional() @CalendarDay('Effective until') effectiveUntil?: string;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(2_000) note?: string;
}

export class RuleKeyParamDto {
  @IsIn(RULE_SETTING_KEYS) key!: string;
}

export class CreateTaxonomyItemDto {
  @IsString() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  code!: string;
  @IsString() @IsNotEmpty() @Transform(trim) @MaxLength(160) label!: string;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(1_000) description?: string;
  @IsIn(COMPARISON_TAXONOMY_CATEGORIES) category!: string;
  @IsIn(COMPARISON_VALUE_TYPES) dataType!: string;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(80) unit?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) @MaxLength(120, { each: true }) allowedValues?: string[];
  @IsOptional() @IsIn(COMPARISON_DISPLAY_RULES) displayRule?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
}

export class UpdateTaxonomyItemDto {
  @IsOptional() @IsString() @IsNotEmpty() @Transform(trim) @MaxLength(160) label?: string;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(1_000) description?: string | null;
  @IsOptional() @IsIn(COMPARISON_TAXONOMY_CATEGORIES) category?: string;
  @IsOptional() @IsIn(COMPARISON_VALUE_TYPES) dataType?: string;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(80) unit?: string | null;
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) @MaxLength(120, { each: true }) allowedValues?: string[];
  @IsOptional() @IsIn(COMPARISON_DISPLAY_RULES) displayRule?: string;
  @IsOptional() @IsIn(COMPARISON_TAXONOMY_STATUSES) status?: string;
  @IsOptional() @IsInt() @Min(0) @Max(10_000) displayOrder?: number;
}
