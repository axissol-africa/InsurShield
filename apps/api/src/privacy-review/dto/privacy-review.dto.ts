import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  REQUEST_KINDS,
  REQUEST_STATUSES,
  REVIEW_ACTIONS,
  type ReviewAction,
} from '../domain/privacy-review.js';
export class CreatePrivacyRequestDto {
  @IsIn(REQUEST_KINDS) kind!: (typeof REQUEST_KINDS)[number];
}
export class StaffCreatePrivacyRequestDto extends CreatePrivacyRequestDto {
  @IsUUID() customerId!: string;
}
export class PrivacyListDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(10000) page?: number;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(REQUEST_STATUSES) status?: string;
}
export class AffectedRecordDto {
  @IsIn([
    'CUSTOMER',
    'DOCUMENT',
    'POLICY',
    'CLAIM',
    'PAYMENT',
    'REVIEW',
    'SERVICE_REQUEST',
  ])
  type!: string;
  @IsString() @MinLength(1) @MaxLength(100) id!: string;
}
export class PrivacyTransitionDto {
  @IsInt() @Min(1) version!: number;
  @IsIn(REVIEW_ACTIONS) action!: ReviewAction;
  @IsOptional() @IsUUID() ownerStaffId?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  decisionReference?: string;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) rationale?: string;
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  evidenceReference?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AffectedRecordDto)
  affectedRecords?: AffectedRecordDto[];
}
export class PrivacyHoldDto {
  @IsInt() @Min(1) version!: number;
  @IsBoolean() held!: boolean;
  @IsString() @MinLength(1) @MaxLength(200) decisionReference!: string;
  @IsString() @MinLength(1) @MaxLength(2000) rationale!: string;
  @IsString() @MinLength(1) @MaxLength(200) evidenceReference!: string;
}
