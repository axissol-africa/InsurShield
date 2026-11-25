import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  SERVICE_REQUEST_STATUSES,
  SERVICE_REQUEST_TYPES,
  type ServiceRequestStatus,
  type ServiceRequestType,
} from '../../common/domain/enums.js';
import { MAX_KWACHA } from '../../common/domain/money-limits.js';

/** Enough to attach a few photos or letters, not an archive. */
export const MAX_SERVICE_REQUEST_DOCUMENTS = 5;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

class WithDocuments {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SERVICE_REQUEST_DOCUMENTS, { message: `Attach at most ${MAX_SERVICE_REQUEST_DOCUMENTS} documents.` })
  @IsUUID('4', { each: true, message: 'One attached document is invalid. Upload it again.' })
  documentIds?: string[];
}

export class SubmitServiceRequestDto extends WithDocuments {
  @IsString() @MinLength(3) @MaxLength(40) policyNumber!: string;

  @IsIn(SERVICE_REQUEST_TYPES, { message: 'Choose what you need: a change, a replacement document, a cancellation or help.' })
  type!: ServiceRequestType;

  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MinLength(10, { message: 'Tell the insurer what you need in at least 10 characters.' })
  @MaxLength(2000)
  reason!: string;

  /** The day a cancellation should take effect; asked for a cancellation only. */
  @ValidateIf((dto: SubmitServiceRequestDto) => dto.type === 'CANCELLATION')
  @IsString({ message: 'Choose the day you want the cover to end.' })
  @Matches(DAY, { message: 'Choose the day you want the cover to end.' })
  requestedEffectiveDate?: string;
}

export class ReplyDto extends WithDocuments {
  @IsString() @MinLength(2, { message: 'Write your answer.' }) @MaxLength(2000) message!: string;
}

export class WithdrawDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

export class InsurerUpdateDto extends WithDocuments {
  @IsString() @MinLength(2, { message: 'Write the update.' }) @MaxLength(2000) message!: string;

  /** An internal note stays with the insurer and InsurShield. */
  @IsBoolean() visibleToCustomer!: boolean;
}

export class InformationRequestDto {
  @IsString() @MinLength(10, { message: 'Ask the customer in at least 10 characters.' }) @MaxLength(2000) message!: string;
}

export class DeclineServiceRequestDto {
  /** Shown to the customer as written. */
  @IsString() @MinLength(10, { message: 'Tell the customer why, in at least 10 characters.' }) @MaxLength(2000) reason!: string;
}

export class ApproveServiceRequestDto {
  @IsString() @MinLength(2, { message: 'Tell the customer what you approved.' }) @MaxLength(2000) note!: string;

  /** A cancellation's refund, worked out by the insurer; zero when nothing is due. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the refund in kwacha, with at most two decimals.' })
  @Min(0)
  @Max(MAX_KWACHA)
  refundAmount?: number;

  /** The day cover ends on a cancellation. */
  @IsOptional() @IsString() @Matches(DAY, { message: 'Choose the day the cover ends.' }) effectiveDate?: string;
}

export class CompleteServiceRequestDto extends WithDocuments {
  @IsString() @MinLength(2, { message: 'Tell the customer what was done.' }) @MaxLength(2000) note!: string;
}

export class ServiceRequestQuery {
  @IsOptional() @IsIn(SERVICE_REQUEST_STATUSES) status?: ServiceRequestStatus;
}

export class AdminServiceRequestQuery extends ServiceRequestQuery {
  @IsOptional() @IsUUID('4') insurerId?: string;
}
