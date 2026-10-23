import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { StaffRole } from '../../generated/prisma/enums.js';
import { MIN_PASSWORD_LENGTH } from '../../common/auth/password.js';

export class CreateStaffDto {
  @IsEmail({}, { message: 'Please give a valid email address.' })
  email!: string;

  @IsString()
  @MinLength(2, { message: 'Please give the person’s full name.' })
  @MaxLength(120)
  fullName!: string;

  @IsEnum(StaffRole, { message: 'Choose a role for this account.' })
  role!: StaffRole;

  /** Required for an insurer portal login; ignored for the other roles. */
  @IsOptional()
  @IsUUID('4', { message: 'Choose the insurer this account belongs to.' })
  insurerId?: string;

  /** Left out, a temporary password is generated and returned once. */
  @IsOptional()
  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: `A password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
  })
  @MaxLength(200)
  password?: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Please give the person’s full name.' })
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsEnum(StaffRole, { message: 'Choose a role for this account.' })
  role?: StaffRole;

  @IsOptional()
  @IsUUID('4', { message: 'Choose the insurer this account belongs to.' })
  insurerId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SuspendCustomerDto {
  @IsBoolean()
  suspended!: boolean;
}
