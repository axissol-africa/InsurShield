import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { NcdStatus } from '../../generated/prisma/enums.js';

export class SubmitQuoteDto {
  /** Must equal the premium printed on the uploaded quotation. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Enter the premium exactly as it appears on your quotation.' })
  premium!: number;

  /** The quotation the insurer prepared in its own system. */
  @IsUUID('4', { message: 'Attach the quotation before sending it.' })
  documentId!: string;

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  /** The insurer's own reference, shown to the customer. */
  @IsOptional() @IsString() @MaxLength(120) insurerReference?: string;

  @IsOptional() @IsInt() @Min(1) @Max(30) validityDays?: number;
}

export class ExtendQuoteDto {
  @IsInt()
  @Min(1, { message: 'Extend by at least one day.' })
  @Max(30, { message: 'A quote cannot be extended by more than 30 days at a time.' })
  extraDays!: number;
}

export class IssueCertificateDto {
  /** The official certificate; its arrival is what activates the policy. */
  @IsUUID('4', { message: 'Upload the official policy certificate.' })
  certificateDocumentId!: string;

  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) insurerPolicyNumber?: string;
}

export class AcknowledgeClaimDto {
  /** The insurer's own claim reference, shown to the customer alongside ours. */
  @IsOptional() @IsString() @MaxLength(120) insurerClaimReference?: string;
}

export class NcdDecisionDto {
  @IsEnum(NcdStatus, { message: 'Decision must be Under Review, Approved or Rejected.' })
  status!: NcdStatus;

  /** Set when approving to override the automatic percentage. */
  @IsOptional() @IsInt() @Min(0) @Max(100) percentage?: number;

  @IsOptional() @IsBoolean() notifyCustomer?: boolean;
}
