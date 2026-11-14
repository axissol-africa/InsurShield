import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  isISO8601,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
} from 'class-validator';
import {
  INSPECTION_METHODS,
  INSPECTION_RULES,
  INSPECTION_TIMINGS,
  INSURANCE_TYPES,
  type InspectionMethod,
  type InspectionRule,
  type InspectionTiming,
  type InsuranceType,
} from '../../common/domain/enums.js';

const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;
const CalendarDay = (what: string) =>
  ValidateBy({
    name: 'calendarDay',
    validator: {
      validate: (value: unknown) => typeof value === 'string' && CALENDAR_DAY.test(value) && isISO8601(value, { strict: true }),
      defaultMessage: () => `${what} must be a date such as 2026-12-01.`,
    },
  });

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Terms held by a version. The service validates the fixed cover-guide shape. */
export class ProductVersionInputDto {
  @IsString() @Transform(trim) @MinLength(2) @MaxLength(120) name!: string;
  @IsIn(INSURANCE_TYPES) coverType!: InsuranceType;
  @IsObject() coverGuide!: Record<string, unknown>;
  @IsIn(INSPECTION_RULES) inspectionRule!: InspectionRule;
  @IsOptional() @IsIn(INSPECTION_TIMINGS) inspectionTiming?: InspectionTiming;
  @IsOptional() @IsIn(INSPECTION_METHODS) inspectionMethod?: InspectionMethod;
  @CalendarDay('An effective-from date') effectiveFrom!: string;
  @IsOptional() @CalendarDay('An effective-until date') effectiveUntil?: string;
}

/** A new product starts with its first editable version. */
export class CreateProductDto extends ProductVersionInputDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9][A-Z0-9_-]{1,79}$/, { message: 'Use 2–80 uppercase letters, numbers, hyphens or underscores for the product code.' })
  code!: string;
}

/** Draft-only patch. A reviewed version must first be cloned into a new draft. */
export class UpdateDraftProductVersionDto {
  @IsOptional() @IsString() @Transform(trim) @MinLength(2) @MaxLength(120) name?: string;
  @IsOptional() @IsObject() coverGuide?: Record<string, unknown>;
  @IsOptional() @IsIn(INSPECTION_RULES) inspectionRule?: InspectionRule;
  @IsOptional() @IsIn(INSPECTION_TIMINGS) inspectionTiming?: InspectionTiming | null;
  @IsOptional() @IsIn(INSPECTION_METHODS) inspectionMethod?: InspectionMethod | null;
  // `IsOptional` treats null as absent; an omitted start is fine for a patch,
  // but an explicit null must never become an accidental 1970 publication.
  @ValidateIf((_, value) => value !== undefined) @CalendarDay('An effective-from date') effectiveFrom?: string;
  @ValidateIf((_, value) => value !== undefined && value !== null) @CalendarDay('An effective-until date') effectiveUntil?: string | null;
}

export class ApproveProductVersionDto {
  /** Reviewers may correct a business effective date without editing the cover terms. */
  @ValidateIf((_, value) => value !== undefined) @CalendarDay('An effective-from date') effectiveFrom?: string;
  @ValidateIf((_, value) => value !== undefined && value !== null) @CalendarDay('An effective-until date') effectiveUntil?: string | null;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(2000) comment?: string;
}

export class RejectProductVersionDto {
  @IsString() @IsNotEmpty() @Transform(trim) @MinLength(3) @MaxLength(2000) comment!: string;
}

export class WithdrawProductVersionDto {
  @IsString() @IsNotEmpty() @Transform(trim) @MinLength(3) @MaxLength(2000) reason!: string;
}

/** A small public filter now; B12 will add customer product selection on top. */
export class ProductDirectoryQueryDto {
  @IsOptional() @IsIn(INSURANCE_TYPES) coverType?: InsuranceType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
