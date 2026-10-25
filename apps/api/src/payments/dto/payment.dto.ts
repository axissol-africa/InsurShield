import { IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CONTRACT_VALUES } from '../../common/contract.js';
import { MAX_KWACHA } from '../../common/domain/money-limits.js';

export const CHOOSE_A_PAYMENT_METHOD = 'Choose mobile money or card.';

export class PayDto {
  /** The request being paid for; the quote must belong to it. */
  @IsString() @MinLength(3) @MaxLength(60) quoteRequestId!: string;

  /** The insurer whose quote the customer accepted, by name as shown. */
  @IsString() @MinLength(1) @MaxLength(160) insurer!: string;

  /**
   * What the customer authorised, including the RTSA fee where chosen. It is
   * checked against the insurer's quote before anything is charged.
   */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'The amount to pay must be greater than zero.' })
  @Max(MAX_KWACHA, { message: `The amount to pay must be at most ${MAX_KWACHA}.` })
  amount!: number;

  @IsIn(CONTRACT_VALUES.paymentMethod, { message: CHOOSE_A_PAYMENT_METHOD })
  method!: string;

  /** Mobile-money wallet, when that is the method. */
  @IsOptional() @IsString() @MaxLength(24) mobileNumber?: string;

  /** Added to the premium when the customer aligns cover to the RTSA anniversary. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(MAX_KWACHA, { message: `The RTSA anniversary fee must be at most ${MAX_KWACHA}.` })
  rtsaAnniversaryFee?: number;
}
