import { Transform } from 'class-transformer';
import {
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
} from 'class-validator';
import { CONTRACT_VALUES, fromContract, type NcdDecisionStatus } from '../../common/contract.js';
import { MAX_KWACHA } from '../../common/domain/money-limits.js';
import { QUOTE_PRIORITIES, type QuotePriority } from '../../common/domain/enums.js';

export class SubmitQuoteDto {
  /** Required when this request contains customer-selected product versions. */
  @IsOptional()
  @IsUUID('4', { message: 'Choose the product version this quote answers.' })
  productVersionId?: string;

  /** Must equal the premium printed on the uploaded quotation. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Enter the premium exactly as it appears on your quotation.' })
  @Max(MAX_KWACHA, { message: `The premium must be at most ${MAX_KWACHA}.` })
  premium!: number;

  /** The quotation the insurer prepared in its own system. */
  @IsUUID('4', { message: 'Attach the quotation before sending it.' })
  documentId!: string;

  @IsOptional() @IsString() @MaxLength(2000) notes?: string;

  /** The insurer's own reference, shown to the customer. */
  @IsOptional() @IsString() @MaxLength(120) insurerReference?: string;

  @IsOptional() @IsInt() @Min(1) @Max(30) validityDays?: number;
}

export class DeclineProductDto {
  /** A code from the approved QUOTE_DECLINE_REASONS list. */
  @IsString({ message: 'Choose a reason for declining.' })
  @MinLength(2, { message: 'Choose a reason for declining.' })
  @MaxLength(80)
  reasonCode!: string;

  /** Shown to the customer under the reason's approved wording. */
  @IsOptional() @IsString() @MaxLength(1000) customerNote?: string;

  /** Kept as an internal note; never shown to the customer. */
  @IsOptional() @IsString() @MaxLength(4000) internalNote?: string;
}

export class RequestInformationDto {
  /** What the customer is asked, shown to them as written. */
  @IsString()
  @MinLength(5, { message: 'Write what you need from the customer.' })
  @MaxLength(2000, { message: 'Keep the question under 2,000 characters.' })
  message!: string;

  /** How many days the customer has to answer. */
  @IsInt()
  @Min(1, { message: 'Give the customer at least one day to answer.' })
  @Max(14, { message: 'Give the customer at most 14 days to answer.' })
  dueInDays!: number;
}

export class InternalNoteDto {
  @IsString()
  @MinLength(1, { message: 'Write the note before saving it.' })
  @MaxLength(4000, { message: 'Keep the note under 4,000 characters.' })
  body!: string;
}

export class AssignProductDto {
  /** The staff member who will own this product, or null to leave it unassigned. */
  @IsOptional()
  @IsUUID('4', { message: 'Choose a member of your team.' })
  staffId!: string | null;
}

export class ProductPriorityDto {
  @IsIn(QUOTE_PRIORITIES, { message: 'Priority must be NORMAL or HIGH.' })
  priority!: QuotePriority;
}

export class QueueQueryDto {
  /** One state, or several separated by commas. */
  @IsOptional() @IsString() @MaxLength(200) status?: string;

  @IsOptional() @IsIn(['me', 'unassigned', 'any']) owner?: 'me' | 'unassigned' | 'any';

  @IsOptional() @IsIn(QUOTE_PRIORITIES) priority?: QuotePriority;

  @IsOptional() @IsIn(['ON_TRACK', 'DUE_SOON', 'BREACHED', 'PAUSED']) sla?: 'ON_TRACK' | 'DUE_SOON' | 'BREACHED' | 'PAUSED';

  /** Part of a request reference or a number plate. */
  @IsOptional() @IsString() @MaxLength(60) search?: string;
}

export class ExtendQuoteDto {
  /** Required when extending a quote for a customer-selected product version. */
  @IsOptional()
  @IsUUID('4', { message: 'Choose the product version whose quote you are extending.' })
  productVersionId?: string;

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
  @Transform(({ value }) => (typeof value === 'string' ? (fromContract.ncdDecision(value) ?? value) : value))
  @IsIn(CONTRACT_VALUES.ncdDecision, { message: 'Decision must be Under Review, Approved or Rejected.' })
  status!: NcdDecisionStatus;

  /** Set when approving to override the automatic percentage. */
  @IsOptional() @IsInt() @Min(0) @Max(50, { message: 'NCD percentage cannot exceed 50%.' }) percentage?: number;
}
