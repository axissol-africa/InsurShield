import { Transform } from 'class-transformer';
import { IsEmail, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * The administrator must re-enter the recorded email rather than merely
 * clicking a reset button beside a lookup result. That makes an accidental
 * reset materially harder without sending a contact identifier back to a form.
 */
export class SupportPasswordResetDto {
  @IsUUID('4')
  customerId!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(254)
  confirmationEmail!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}
