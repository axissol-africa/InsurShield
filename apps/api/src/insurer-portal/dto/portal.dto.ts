import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  Matches,
  ValidateNested,
  IsInt,
  IsISO8601,
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
import { ISSUANCE_FAILURE_REASONS, QUOTE_PRIORITIES, type IssuanceFailureReason, type QuotePriority } from '../../common/domain/enums.js';

const CODE = /^[A-Z][A-Z0-9_]{1,79}$/;
const CODE_MESSAGE = 'Codes are capital letters, digits and underscores, starting with a letter.';

export class QuoteComponentDto {
  @Matches(CODE, { message: CODE_MESSAGE }) code!: string;
  @IsString() @MinLength(2) @MaxLength(120) label!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(-MAX_KWACHA) @Max(MAX_KWACHA) amount!: number;
}

export class QuoteAddOnDto {
  @Matches(CODE, { message: CODE_MESSAGE }) code!: string;
  @IsOptional() @IsString() @MaxLength(120) label?: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_KWACHA) price!: number;
  @IsBoolean() included!: boolean;
  @IsOptional() @IsString() @MaxLength(1000) terms?: string;
}

export class QuoteConditionDto {
  @Matches(CODE, { message: CODE_MESSAGE }) code!: string;
  @IsString() @MinLength(2) @MaxLength(1000) text!: string;
  @IsBoolean() purchaseCritical!: boolean;
}

export class SubmitQuoteDto {
  /** Record an explicitly applied, server-validated NCD without changing the manual premium. */
  @IsOptional() @IsBoolean() applyNcd?: boolean;

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

  /** How the premium is made up; when given, the lines add up to the premium. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => QuoteComponentDto)
  components?: QuoteComponentDto[];

  /** The excess the customer pays on a claim, in kwacha. */
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(MAX_KWACHA) excess?: number;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => QuoteAddOnDto)
  addOns?: QuoteAddOnDto[];

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => QuoteConditionDto)
  conditions?: QuoteConditionDto[];
}

export class WithdrawQuoteDto {
  /** Kept on the quote and in the audit trail. */
  @IsString()
  @MinLength(3, { message: 'Say why you are withdrawing this quote.' })
  @MaxLength(1000)
  reason!: string;
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

export class ScheduleInspectionDto {
  @IsISO8601({}, { message: 'Choose the date and time of the inspection.' })
  scheduledDate!: string;

  @IsOptional() @IsString() @MaxLength(300) location?: string;
}

export class AssignInspectorDto {
  @IsString() @MinLength(2, { message: 'Name the inspector.' }) @MaxLength(120) inspectorName!: string;

  /** Shown to the customer, so they can reach the inspector on the day. */
  @IsOptional() @IsString() @MaxLength(40) inspectorPhone?: string;
}

export class InspectionReasonDto {
  /** Shown to the customer as written. */
  @IsString() @MinLength(3, { message: 'Say why.' }) @MaxLength(1000) reason!: string;
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

export class AcceptIssuanceDto {
  /** The insurer's own policy number, when it has one already. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(120) insurerPolicyNumber?: string;
}

export class IssuanceFailureDto {
  @IsIn(ISSUANCE_FAILURE_REASONS, { message: 'Choose why the policy cannot be issued.' })
  reasonCode!: IssuanceFailureReason;

  /** Shown to the customer as written, so it is plain and specific. */
  @IsString() @MinLength(10, { message: 'Tell the customer why, in at least 10 characters.' }) @MaxLength(1000)
  customerMessage!: string;
}

export class AcknowledgeClaimDto {
  /** The insurer's own claim reference, shown to the customer alongside ours. */
  @IsOptional() @IsString() @MaxLength(120) insurerClaimReference?: string;
}

export class NcdDecisionDto {
  /** The current revision displayed with the application, not the next revision. */
  @IsOptional() @IsInt() @Min(0) verificationRevision?: number;

  @Transform(({ value }) => (typeof value === 'string' ? (fromContract.ncdDecision(value) ?? value) : value))
  @IsIn(CONTRACT_VALUES.ncdDecision, { message: 'Decision must be Under Review, Verification Required, Approved or Rejected.' })
  status!: NcdDecisionStatus;

  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MinLength(1) @MaxLength(2000)
  note!: string;

  /** If supplied, must equal the configured eligible tier. */
  @IsOptional() @IsInt() @Min(0) @Max(100) percentage?: number;
}
