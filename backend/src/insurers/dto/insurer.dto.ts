import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { InspectionMethod, InspectionRule, InspectionTiming, InsurerStatus } from '../../generated/prisma/enums.js';

export class InsurerContactDto {
  @IsOptional() @IsString() tagline?: string;
  @IsString() @MinLength(1) contactPerson!: string;
  @IsString() @MinLength(1) role!: string;
  @IsString() @MinLength(1) phone!: string;
  @IsOptional() @IsString() mobile?: string;
  @IsOptional() @IsString() whatsapp?: string;
  @IsString() @MinLength(1) email!: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() hours?: string;
}

export class CreateInsurerDto {
  @IsString() @MinLength(2) name!: string;
  @IsOptional() @IsString() tradingName?: string;

  /** Annual rate as a percentage of declared vehicle value. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Enter the insurer rate as a percentage above zero.' })
  @Max(100)
  ratePercentage!: number;

  @IsInt() @Min(1) @Max(365) quoteValidityDays!: number;
  @IsString() @MinLength(1) coverage!: string;

  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsString() licenceNumber?: string;
  @IsOptional() @IsString() licenceExpiry?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() tpin?: string;
  @IsOptional() @IsUrl({}, { message: 'Enter a valid website address.' }) website?: string;
  @IsOptional() @IsUrl({}, { message: 'Enter a valid logo URL.' }) logoUrl?: string;

  @IsOptional() @IsBoolean() ncdAccepted?: boolean;
  @IsOptional() @IsEnum(InspectionRule) inspectionRule?: InspectionRule;
  @IsOptional() @IsEnum(InspectionTiming) inspectionTiming?: InspectionTiming;
  @IsOptional() @IsEnum(InspectionMethod) inspectionMethod?: InspectionMethod;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsBoolean() isBestValue?: boolean;

  @IsOptional() @IsArray() @IsString({ each: true }) benefits?: string[];

  @ValidateNested()
  @Type(() => InsurerContactDto)
  contact!: InsurerContactDto;
}

/** Every field optional; `contact` is merged rather than replaced. */
export class UpdateInsurerDto {
  @IsOptional() @IsString() @MinLength(2) name?: string;
  @IsOptional() @IsString() tradingName?: string;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(100) ratePercentage?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) quoteValidityDays?: number;
  @IsOptional() @IsString() coverage?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsString() licenceNumber?: string;
  @IsOptional() @IsString() licenceExpiry?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() tpin?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsBoolean() ncdAccepted?: boolean;
  @IsOptional() @IsEnum(InspectionRule) inspectionRule?: InspectionRule;
  @IsOptional() @IsEnum(InspectionTiming) inspectionTiming?: InspectionTiming;
  @IsOptional() @IsEnum(InspectionMethod) inspectionMethod?: InspectionMethod;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsBoolean() isBestValue?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) benefits?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => InsurerContactDto)
  contact?: InsurerContactDto;
}

export class SetInsurerStatusDto {
  @IsEnum(InsurerStatus, { message: 'Status must be Active, Inactive or Deleted.' })
  status!: InsurerStatus;
}
