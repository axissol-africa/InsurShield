import { IsEmail, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { MIN_PASSWORD_LENGTH } from '../../common/auth/password.js';

/**
 * Credentials accepted by the auth endpoints.
 *
 * Passwords carry a length floor and nothing else. Composition rules ("one
 * capital, one symbol") push people towards shorter, more predictable
 * passwords, so the only thing demanded here is enough length to be worth
 * hashing. The upper bound stops anyone making the server chew through a
 * megabyte of scrypt input.
 */
const TOO_SHORT = `Your password must be at least ${MIN_PASSWORD_LENGTH} characters.`;

export class RegisterDto {
  @IsString()
  @MinLength(2, { message: 'Please give your full name.' })
  @MaxLength(120)
  fullName!: string;

  @IsEmail({}, { message: 'Please give a valid email address.' })
  email!: string;

  /** Zambian mobile numbers, with or without the +260 country code. */
  @IsString()
  @Matches(/^\+?[0-9][0-9 ()-]{7,19}$/, { message: 'Please give a valid mobile number.' })
  phone!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: TOO_SHORT })
  @MaxLength(200, { message: 'That password is too long.' })
  password!: string;
}

export class LoginDto {
  /** Email address or mobile number — customers remember one or the other. */
  @IsString()
  @MinLength(1, { message: 'Enter your email address or mobile number.' })
  identifier!: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  password!: string;
}

export class StaffLoginDto {
  @IsEmail({}, { message: 'Please give a valid email address.' })
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Enter your password.' })
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(1, { message: 'Enter your current password.' })
  currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, { message: TOO_SHORT })
  @MaxLength(200, { message: 'That password is too long.' })
  newPassword!: string;
}
