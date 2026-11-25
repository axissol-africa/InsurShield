import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import {
  RECONCILIATION_KINDS,
  RECONCILIATION_OUTCOMES,
  RECONCILIATION_STATUSES,
  REFUND_REASONS,
  type ReconciliationKind,
  type ReconciliationOutcome,
  type ReconciliationStatus,
  type RefundReason,
} from '../../common/domain/enums.js';
import { MAX_KWACHA } from '../../common/domain/money-limits.js';

export class ProposeRefundDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter the amount in kwacha, to the ngwee.' })
  @Min(0.01) @Max(MAX_KWACHA)
  amount!: number;

  @IsIn(REFUND_REASONS, { message: 'Choose why the money is going back.' })
  reasonCode!: RefundReason;

  /** The approver reads this, so it says what happened. */
  @IsString() @MinLength(10, { message: 'Explain the refund in at least 10 characters.' }) @MaxLength(1000)
  reason!: string;

  @IsOptional() @IsUUID('4') reconciliationItemId?: string;
}

export class ListItemsQuery {
  @IsOptional() @IsIn(RECONCILIATION_STATUSES) status?: ReconciliationStatus;
  @IsOptional() @IsIn(RECONCILIATION_KINDS) kind?: ReconciliationKind;
  @IsOptional() @IsUUID('4') insurerId?: string;
  /** 'me' for the caller's own items. */
  @IsOptional() @IsString() @MaxLength(40) owner?: string;
  /** The `next` value of the previous page. */
  @IsOptional() @IsString() @MaxLength(120) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AssignItemDto {
  /** Null takes the item back off everyone. */
  @ValidateIf((_dto, value) => value !== null) @IsUUID('4') staffId!: string | null;
}

export class ResolveItemDto {
  @IsIn(RECONCILIATION_OUTCOMES, { message: 'Choose how the item ended.' })
  outcome!: ReconciliationOutcome;

  @IsString() @MinLength(10, { message: 'Say what was done, in at least 10 characters.' }) @MaxLength(2000)
  note!: string;
}

export class ImportStatementDto {
  @IsString() @MaxLength(200) fileName!: string;
  @IsISO8601() periodStart!: string;
  @IsISO8601() periodEnd!: string;
  /** The statement file's text, in the provider-neutral CSV. */
  @IsString() @MinLength(1) @MaxLength(2_000_000) csv!: string;
}

export class StatementPeriodQuery {
  @IsISO8601() from!: string;
  @IsISO8601() to!: string;
}
