import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { CONTRACT_VALUES, fromContract } from '../../common/contract.js';
import type { StaffRole } from '../../common/domain/enums.js';

const Reason = () =>
  applyDecorators(
    IsString(),
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    MinLength(3),
    MaxLength(1000),
  );

const TeamName = () =>
  applyDecorators(
    IsString(),
    Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)),
    MinLength(2),
    MaxLength(120),
  );

/** A new staff account receives a password-set link; no password crosses this API. */
export class CreateStaffUserDto {
  @IsString() @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value)) @MinLength(2) @MaxLength(160)
  fullName!: string;

  @IsEmail() @MaxLength(254) email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? (fromContract.staffRole(value) ?? value) : value))
  @IsIn(CONTRACT_VALUES.staffRole)
  role!: StaffRole;

  /** Required for an insurer role and forbidden for an InsurShield role. */
  @IsOptional() @IsUUID('4') insurerId?: string;
  @IsOptional() @IsUUID('4') teamId?: string;

  @Reason() reason!: string;
}

/** The email and name stay with the identity account, not a mutable staff copy. */
export class UpdateStaffUserDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? (fromContract.staffRole(value) ?? value) : value))
  @IsIn(CONTRACT_VALUES.staffRole)
  role?: StaffRole;

  @IsOptional() @IsUUID('4') insurerId?: string | null;
  @IsOptional() @IsUUID('4') teamId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;

  @Reason() reason!: string;
}

export class CreateStaffTeamDto {
  /** A platform administrator supplies the insurer; an insurer administrator cannot change it. */
  @IsOptional() @IsUUID('4') insurerId?: string;
  @TeamName() name!: string;
  @Reason() reason!: string;
}

export class UpdateStaffTeamDto {
  @TeamName() name!: string;
  @Reason() reason!: string;
}

export class ReasonDto {
  @Reason() reason!: string;
}
