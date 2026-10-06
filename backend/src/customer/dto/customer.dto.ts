import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CONTRACT_VALUES } from '../../common/contract.js';

/** The vehicle as the customer confirmed it, from RTSA or typed by hand. */
export class VehicleDetailsDto {
  @IsString() @MinLength(3) @MaxLength(16) plateNumber!: string;
  @IsString() @MinLength(1) @MaxLength(60) make!: string;
  @IsString() @MinLength(1) @MaxLength(60) model!: string;
  @IsString() @MinLength(4) @MaxLength(4) year!: string;

  @IsOptional() @IsString() @MaxLength(40) color?: string;
  /** Where the plate was issued. Absent on vehicles recorded before this was asked for. */
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) registrationCountry?: string;
  @IsOptional() @IsString() @MaxLength(40) chassisNumber?: string;
  @IsOptional() @IsString() @MaxLength(40) engineNumber?: string;
  @IsOptional() @IsDateString() registrationDate?: string;
  @IsOptional() @IsDateString() rtsaAnniversaryDate?: string;
}

/** One of the seven live shots, already uploaded through POST /documents. */
export class InspectionShotDto {
  @IsString() @MinLength(1) @MaxLength(40) shotKey!: string;
  @IsUUID('4') documentId!: string;
}

/** Cover dates the client calculated; the server recomputes the day count. */
export class PolicyDatesDto {
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
}

export class SubmitQuoteRequestDto {
  @ValidateNested() @Type(() => VehicleDetailsDto) vehicleDetails!: VehicleDetailsDto;

  /** Declared market value in ZMW; the premium is a percentage of it. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1, { message: 'Enter the current market value of the vehicle.' })
  vehicleValue!: number;

  @IsString() @MinLength(1) @MaxLength(60) vehicleUsage!: string;

  @IsIn(CONTRACT_VALUES.insuranceType, { message: 'Choose Comprehensive or Third Party cover.' })
  insuranceType!: string;

  @IsIn(CONTRACT_VALUES.coverageDuration, { message: 'Choose a cover period of 1 to 4 quarters.' })
  coverageDurationId!: string;

  @IsOptional() @IsBoolean() matchRtsaAnniversary?: boolean;
  @IsOptional() @IsDateString() rtsaRegistrationDate?: string;

  @IsOptional() @ValidateNested() @Type(() => PolicyDatesDto) policyDates?: PolicyDatesDto;

  /** The live photos captured for this request. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => InspectionShotDto)
  inspectionShots?: InspectionShotDto[];

  @IsOptional() @IsDateString() photosCapturedAt?: string;

  /** A code the customer holds; it only discounts its own insurer's quote. */
  @IsOptional() @IsString() @MaxLength(40) ncdCode?: string;
}

export class NotifyClaimDto {
  /** The insurer that carries the policy, by id. */
  @IsUUID('4', { message: 'Choose the insurer that carries this policy.' })
  insurerId!: string;

  @IsOptional() @IsString() @MaxLength(40) policyNumber?: string;

  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsString() @MinLength(6) @MaxLength(24) phone!: string;
  @IsOptional() @IsString() @MaxLength(160) email?: string;

  @IsString() @MinLength(3) @MaxLength(16) plate!: string;
  @IsString() @MinLength(1) @MaxLength(120) vehicle!: string;

  @IsString() @MinLength(2) @MaxLength(60) type!: string;
  @IsDateString() incidentDate!: string;
  @IsString() @MinLength(2) @MaxLength(200) location!: string;
  @IsString() @MinLength(10) @MaxLength(4000) description!: string;

  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) estimatedLoss?: number;
  @IsOptional() @IsBoolean() policeReport?: boolean;
  @IsOptional() @IsString() @MaxLength(60) policeReportNumber?: string;
  /** Required by the client when the incident falls outside the window. */
  @IsOptional() @IsString() @MaxLength(1000) lateReason?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  supportingDocumentIds?: string[];
}

export class ApplyForNcdDto {
  @IsUUID('4', { message: 'Choose the insurer that held the claim-free policy.' })
  insurerId!: string;

  @IsString() @MinLength(2) @MaxLength(40) policyNumber!: string;
  @IsString() @MinLength(2) @MaxLength(120) fullName!: string;
  @IsString() @MinLength(6) @MaxLength(24) phone!: string;

  @IsInt()
  @Min(1, { message: 'Enter at least one claim-free year.' })
  @Max(20)
  yearsClaimFree!: number;
}

export class ValidateNcdCodeDto {
  @IsString() @MinLength(3) @MaxLength(40) code!: string;
}

export class RequestInspectionDto {
  @IsString() @MinLength(3) @MaxLength(16) vehiclePlate!: string;
  @IsString() @MinLength(1) @MaxLength(120) vehicleLabel!: string;

  @IsOptional() @IsUUID('4') insurerId?: string;
  @IsOptional() @IsDateString() preferredDate?: string;
  @IsOptional() @IsString() @MaxLength(40) preferredTime?: string;
  @IsOptional() @IsString() @MaxLength(200) preferredLocation?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

/** Only the customer-owned parts of an inspection; staff have their own route. */
export class UpdateInspectionDto {
  @IsOptional() @IsDateString() preferredDate?: string;
  @IsOptional() @IsString() @MaxLength(40) preferredTime?: string;
  @IsOptional() @IsString() @MaxLength(200) preferredLocation?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
