import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
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
  ValidateNested,
} from 'class-validator';
import {
  INSPECTION_METHODS,
  INSPECTION_RULES,
  INSPECTION_TIMINGS,
  INSURANCE_TYPES,
  COVERAGE_DURATIONS,
  type InspectionMethod,
  type InspectionRule,
  type InspectionTiming,
  type InsuranceType,
  type CoverageDuration,
} from '../../common/domain/enums.js';
import { MAX_KWACHA, MAX_RATE_BPS, MIN_RATE_BPS } from '../../common/domain/money-limits.js';
import { PRODUCT_REQUIREMENT_KINDS } from '../domain/product-requirements.js';

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
  /** Whether a failed inspection may be repeated rather than declining the product. */
  @IsOptional() @IsBoolean() reinspectionAllowed?: boolean;
  /** Percentage expressed as basis points; 450 means 4.50%. */
  @IsInt() @Min(MIN_RATE_BPS) @Max(MAX_RATE_BPS) rateBps!: number;
  @IsOptional() @IsBoolean() showEstimate?: boolean;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsIn(COVERAGE_DURATIONS, { each: true }) allowedDurations!: CoverageDuration[];
  @IsOptional() @IsArray() @ArrayUnique((item: ComparisonItemInputDto) => item.taxonomyItemId) comparisonItems?: ComparisonItemInputDto[];
  @IsOptional() @IsArray() @ArrayUnique((item: ProductRequirementInputDto) => item.key) @ValidateNested({ each: true }) @Type(() => ProductRequirementInputDto) requirements?: ProductRequirementInputDto[];
  @CalendarDay('An effective-from date') effectiveFrom!: string;
  @IsOptional() @CalendarDay('An effective-until date') effectiveUntil?: string;
}

/** A versioned, insurer-controlled question, document, or declaration. */
export class ProductRequirementInputDto {
  @IsString() @Transform(trim) @Matches(/^[a-z][a-z0-9_]{1,79}$/) key!: string;
  @IsIn(PRODUCT_REQUIREMENT_KINDS) kind!: string;
  @IsString() @Transform(trim) @MinLength(1) @MaxLength(160) label!: string;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(500) helpText?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsObject() config!: Record<string, unknown>;
  @IsOptional() @IsInt() @Min(0) @Max(999) displayOrder?: number;
}

export class ComparisonItemInputDto {
  @IsString() @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i) taxonomyItemId!: string;
  @IsOptional() @IsBoolean() included?: boolean;
  @IsOptional() @IsString() @Transform(trim) @MaxLength(2_000) valueText?: string;
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
  @IsOptional() @IsBoolean() reinspectionAllowed?: boolean;
  @IsOptional() @IsInt() @Min(MIN_RATE_BPS) @Max(MAX_RATE_BPS) rateBps?: number;
  @IsOptional() @IsBoolean() showEstimate?: boolean;
  @IsOptional() @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsIn(COVERAGE_DURATIONS, { each: true }) allowedDurations?: CoverageDuration[];
  @IsOptional() @IsArray() @ArrayUnique((item: ComparisonItemInputDto) => item.taxonomyItemId) comparisonItems?: ComparisonItemInputDto[];
  @IsOptional() @IsArray() @ArrayUnique((item: ProductRequirementInputDto) => item.key) @ValidateNested({ each: true }) @Type(() => ProductRequirementInputDto) requirements?: ProductRequirementInputDto[];
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

/** Inputs are deliberately limited to the pre-quote information a customer has. */
export class ProductEstimateQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(MAX_KWACHA) vehicleValue!: number;
  @IsString() @Transform(trim) @MinLength(2) @MaxLength(120) vehicleUsage!: string;
  @IsIn(COVERAGE_DURATIONS) coverageDuration!: CoverageDuration;
}
