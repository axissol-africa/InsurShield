import { Transform, Type } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';
import type { ProfileContent } from './insurer-profiles.contract.js';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
const urlOptions = { protocols: ['https'], require_protocol: true, require_valid_protocol: true, disallow_auth: true };

export class SubmitInsurerProfileDto implements ProfileContent {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) brandName!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) description!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) serviceInformation!: string;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) contactEmail: string | null = null;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(40) contactPhone: string | null = null;
  @IsOptional() @Transform(trim) @IsUrl(urlOptions) @MaxLength(2048) websiteUrl: string | null = null;
  @IsOptional() @Transform(trim) @IsUrl(urlOptions) @MaxLength(2048) logoUrl: string | null = null;
}

export class DecideInsurerProfileDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(2000) reason!: string;
}

export class InsurerProfileHistoryQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) beforeVersion?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}
