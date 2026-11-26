import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsNotEmpty, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import type { ContentType } from './domain/content.js';
const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class ContentSlugDto {
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/) @MaxLength(100) slug!: string;
}
export class CreateContentDto {
  @IsIn(['FAQ', 'NOTICE', 'LEGAL']) type!: ContentType;
  @IsString() @Transform(trim) @IsNotEmpty() @MaxLength(200) title!: string;
  @IsString() @Transform(trim) @IsNotEmpty() @MaxLength(20000) body!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) effectiveFrom!: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) expiresOn?: string;
  @IsInt() @Min(0) @Max(2147483646) expectedVersion!: number;
}
export class WithdrawContentDto {
  @IsString() @Transform(trim) @IsNotEmpty() @MaxLength(2000) reason!: string;
}
export class ContentPageDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
}
