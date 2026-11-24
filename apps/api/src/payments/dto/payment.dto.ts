import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CONTRACT_VALUES } from '../../common/contract.js';
import { MAX_KWACHA } from '../../common/domain/money-limits.js';

export const CHOOSE_A_PAYMENT_METHOD = 'Choose mobile money or card.';

export class PayDto {
  /** The request being paid for; the quote must belong to it. */
  @IsString() @MinLength(3) @MaxLength(60) quoteRequestId!: string;

  /**
   * The exact quote the customer accepted. Names are not a stable payment
   * identity: one insurer may return several product quotes for one request.
   */
  @IsOptional() @IsUUID('4') insurerQuoteId?: string;

  /**
   * Accepted only so a stale client reaches the explicit reload response in
   * the service. It is never used to choose a quote and can be removed after
   * all supported clients send `insurerQuoteId`.
   */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(160) insurer?: string;

  /** What the customer authorised; the server derives every applicable fee. */
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'The amount to pay must be greater than zero.' })
  @Max(MAX_KWACHA, { message: `The amount to pay must be at most ${MAX_KWACHA}.` })
  amount!: number;

  @IsIn(CONTRACT_VALUES.paymentMethod, { message: CHOOSE_A_PAYMENT_METHOD })
  method!: string;

  /** Mobile-money wallet, when that is the method. Only its last three digits are kept. */
  @IsOptional() @IsString() @MaxLength(24) mobileNumber?: string;

  /** Card only: the InsurShield page the provider's checkout sends the customer back to. */
  @IsOptional() @IsString() @MaxLength(500) returnUrl?: string;
}
