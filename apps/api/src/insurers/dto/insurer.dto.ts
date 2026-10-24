import { applyDecorators } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  ValidateBy,
  ValidateIf,
  ValidateNested,
  isISO8601,
} from 'class-validator';
import {
  INSPECTION_METHODS,
  INSPECTION_RULES,
  INSPECTION_TIMINGS,
  INSURER_STATUSES,
  type InspectionMethod,
  type InspectionRule,
  type InspectionTiming,
  type InsurerStatus,
} from '../../common/domain/enums.js';
import { MAX_RATE_BPS } from '../../common/domain/money-limits.js';
import { percentToBps } from '../../common/money.js';
import type { InsurerChanges, NewContact, NewInsurer } from '../insurers.repository.js';

const MAX_RATE_PERCENT = MAX_RATE_BPS / 100;

// Week and ordinal dates are valid ISO 8601 but `new Date` cannot read them, and a time without a zone would be read
// in the server's zone.
const LICENCE_EXPIRY_FORM = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

/** A calendar date, or a date-time with its zone; an empty string clears the expiry. */
const LicenceExpiry = () =>
  applyDecorators(
    IsOptional(),
    ValidateIf((_, value) => value !== ''),
    ValidateBy({
      name: 'isLicenceExpiry',
      validator: {
        validate: (value) =>
          typeof value === 'string' && LICENCE_EXPIRY_FORM.test(value) && isISO8601(value, { strict: true }),
        defaultMessage: () => 'Enter the licence expiry as a date.',
      },
    }),
  );

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
  @Max(MAX_RATE_PERCENT)
  ratePercentage!: number;

  @IsInt() @Min(1) @Max(365) quoteValidityDays!: number;
  @IsString() @MinLength(1) coverage!: string;

  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsString() licenceNumber?: string;
  @LicenceExpiry() licenceExpiry?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() tpin?: string;
  @IsOptional() @IsUrl({}, { message: 'Enter a valid website address.' }) website?: string;
  @IsOptional() @IsUrl({}, { message: 'Enter a valid logo URL.' }) logoUrl?: string;

  @IsOptional() @IsBoolean() ncdAccepted?: boolean;
  @IsOptional() @IsIn(INSPECTION_RULES) inspectionRule?: InspectionRule;
  @IsOptional() @IsIn(INSPECTION_TIMINGS) inspectionTiming?: InspectionTiming;
  @IsOptional() @IsIn(INSPECTION_METHODS) inspectionMethod?: InspectionMethod;
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
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(MAX_RATE_PERCENT) ratePercentage?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) quoteValidityDays?: number;
  @IsOptional() @IsString() coverage?: string;
  @IsOptional() @IsString() plan?: string;
  @IsOptional() @IsString() licenceNumber?: string;
  @LicenceExpiry() licenceExpiry?: string;
  @IsOptional() @IsString() registrationNumber?: string;
  @IsOptional() @IsString() tpin?: string;
  @IsOptional() @IsString() website?: string;
  @IsOptional() @IsString() logoUrl?: string;
  @IsOptional() @IsBoolean() ncdAccepted?: boolean;
  @IsOptional() @IsIn(INSPECTION_RULES) inspectionRule?: InspectionRule;
  @IsOptional() @IsIn(INSPECTION_TIMINGS) inspectionTiming?: InspectionTiming;
  @IsOptional() @IsIn(INSPECTION_METHODS) inspectionMethod?: InspectionMethod;
  @IsOptional() @IsString() icon?: string;
  @IsOptional() @IsBoolean() isBestValue?: boolean;
  @IsOptional() @IsArray() @IsString({ each: true }) benefits?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => InsurerContactDto)
  contact?: InsurerContactDto;
}

export class SetInsurerStatusDto {
  @IsIn(INSURER_STATUSES, { message: 'Status must be Active, Inactive or Deleted.' })
  status!: InsurerStatus;
}

const licenceExpiry = (value: string | undefined) => (value === undefined ? undefined : value ? new Date(value) : null);

/** The stored fields a change sends; a field left out stays as it is. */
export function toInsurerChanges(dto: UpdateInsurerDto): InsurerChanges {
  return {
    name: dto.name,
    tradingName: dto.tradingName,
    rateBps: dto.ratePercentage === undefined ? undefined : percentToBps(dto.ratePercentage),
    quoteValidityDays: dto.quoteValidityDays,
    coverage: dto.coverage,
    plan: dto.plan,
    licenceNumber: dto.licenceNumber,
    licenceExpiry: licenceExpiry(dto.licenceExpiry),
    registrationNumber: dto.registrationNumber,
    tpin: dto.tpin,
    website: dto.website,
    logoUrl: dto.logoUrl,
    ncdAccepted: dto.ncdAccepted,
    inspectionRule: dto.inspectionRule,
    inspectionTiming: dto.inspectionTiming,
    inspectionMethod: dto.inspectionMethod,
    icon: dto.icon,
    isBestValue: dto.isBestValue,
    benefits: dto.benefits,
  };
}

export function toNewInsurer(dto: CreateInsurerDto): NewInsurer {
  return {
    ...toInsurerChanges(dto),
    name: dto.name,
    rateBps: percentToBps(dto.ratePercentage),
    quoteValidityDays: dto.quoteValidityDays,
    coverage: dto.coverage,
    licenceExpiry: licenceExpiry(dto.licenceExpiry) ?? null,
    benefits: dto.benefits ?? [],
  };
}

export function toNewContact(dto: InsurerContactDto): NewContact {
  return {
    tagline: dto.tagline,
    contactPerson: dto.contactPerson,
    role: dto.role,
    phone: dto.phone,
    mobile: dto.mobile,
    whatsapp: dto.whatsapp,
    email: dto.email,
    address: dto.address,
    hours: dto.hours,
  };
}
