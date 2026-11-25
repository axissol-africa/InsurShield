import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ADJUSTMENT_KINDS, type AdjustmentKind } from '../../common/domain/enums.js';
import { MAX_KWACHA } from '../../common/domain/money-limits.js';

export class DraftSettlementDto {
  @IsUUID('4') insurerId!: string;
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'Choose a month as YYYY-MM.' }) period!: string;
}

export class FinaliseSettlementDto {
  @IsString() @MinLength(10, { message: 'Say what was checked, in at least 10 characters.' }) @MaxLength(1000) reason!: string;
}

export class ListSettlementsQuery {
  @IsOptional() @IsUUID('4') insurerId?: string;
}

export class ProposeAdjustmentDto {
  @IsUUID('4') insurerId!: string;

  /** Signed kwacha: positive pays the insurer more, negative takes money back. */
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(-MAX_KWACHA) @Max(MAX_KWACHA) amount!: number;

  @IsIn(ADJUSTMENT_KINDS, { message: 'Choose what kind of adjustment this is.' }) kind!: AdjustmentKind;

  @IsString() @MinLength(10, { message: 'Explain the adjustment in at least 10 characters.' }) @MaxLength(1000) reason!: string;

  @IsOptional() @IsUUID('4') reconciliationItemId?: string;
}
